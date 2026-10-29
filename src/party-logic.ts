import { runTransaction, type Firestore, type DocumentReference } from "firebase/firestore";
import { makeRound, pickSpectrumIndex, pointsFor, poolFor, type Player, type RoomData } from "./game-logic.js";

export type ScoringMode = "cooperative" | "competitive";
export interface PartyState {
  order: string[];
  n: number;
  round: ReturnType<typeof makeRound> & { guesses: Record<string, number> };
  scores: Record<string, number>;
  awards: Record<string, number>;
}

export const usesPartyFlow = (room: RoomData): boolean => (room.maxPlayers ?? 2) > 2 || room.scoringMode === "competitive";
export const partyQuestionCount = (room: RoomData): number => (room.party?.order.length ?? Object.keys(room.players).length) * (room.questionsPerPlayer ?? 1);

export function scorePartyRound(order: string[], giver: string, target: number, guesses: Record<string, number>) {
  const guessers = order.filter((id) => id !== giver);
  if (!guessers.length || guessers.some((id) => !Number.isInteger(guesses[id]) || guesses[id] < 0 || guesses[id] > 100)) {
    throw new Error("Every guesser must lock a valid guess");
  }
  const awards = Object.fromEntries(guessers.map((id) => [id, pointsFor(target, guesses[id])]));
  const teamPoints = guessers.reduce((sum, id) => sum + awards[id], 0) / guessers.length;
  awards[giver] = teamPoints;
  return { awards, teamPoints };
}

export async function joinPlayerTransaction(db: Firestore, ref: DocumentReference, player: Player, previousId: string | null) {
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) return { error: "missing" } as const;
    const room = snap.data() as RoomData;
    if (previousId && room.players[previousId]) return { id: previousId } as const;
    if (room.phase !== "lobby") return { error: "started" } as const;
    if (Object.keys(room.players).length >= (room.maxPlayers ?? 2)) return { error: "full" } as const;
    tx.update(ref, { [`players.${player.id}`]: player });
    return { id: player.id } as const;
  });
}

export async function configurePartyTransaction(db: Firestore, ref: DocumentReference, pid: string, changes: { maxPlayers?: number; scoringMode?: ScoringMode; questionsPerPlayer?: number }) {
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) return false;
    const room = snap.data() as RoomData;
    if (room.phase !== "lobby" || room.host !== pid) return false;
    if (changes.maxPlayers !== undefined && (!Number.isInteger(changes.maxPlayers) || changes.maxPlayers < Math.max(2, Object.keys(room.players).length) || changes.maxPlayers > 6)) return false;
    if (changes.scoringMode !== undefined && !["cooperative", "competitive"].includes(changes.scoringMode)) return false;
    if (changes.scoringMode === "competitive" && (changes.maxPlayers ?? room.maxPlayers ?? 2) < 3) return false;
    if (changes.questionsPerPlayer !== undefined && (!Number.isInteger(changes.questionsPerPlayer) || changes.questionsPerPlayer < 1 || changes.questionsPerPlayer > 5)) return false;
    tx.update(ref, { ...changes, ...(changes.maxPlayers === 2 ? { scoringMode: "cooperative" } : {}) });
    return true;
  });
}

function freshPartyRound(room: RoomData, order: string[], n: number) {
  const pick = pickSpectrumIndex(room.usedSpectra ?? [], poolFor(room.categories));
  const giver = order[(n - 1) % order.length];
  return { round: { ...makeRound(n, giver, order.find((id) => id !== giver)!, pick.idx), guesses: {} }, used: pick.used };
}

export async function startPartyTransaction(db: Firestore, ref: DocumentReference, pid: string) {
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) return false;
    const room = snap.data() as RoomData;
    const order = [room.host, ...Object.keys(room.players).filter((id) => id !== room.host)];
    if (room.phase !== "lobby" || room.host !== pid || order.length < 2 || order.length > 6 || !usesPartyFlow(room)) return false;
    if (room.scoringMode === "competitive" && order.length < 3) return false;
    const fresh = freshPartyRound(room, order, 1);
    const party: PartyState = { order, n: 1, round: fresh.round, scores: Object.fromEntries(order.map((id) => [id, 0])), awards: {} };
    tx.update(ref, { party, phase: "clue", score: 0, roundScore: 0, usedSpectra: fresh.used });
    return true;
  });
}

export async function sendPartyClueTransaction(db: Firestore, ref: DocumentReference, pid: string, n: number, clue: string) {
  const value = clue.trim().slice(0, 60);
  if (!value) return false;
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) return false;
    const room = snap.data() as RoomData;
    if (room.phase !== "clue" || room.party?.n !== n || room.party.round.giver !== pid) return false;
    tx.update(ref, { "party.round.clue": value, phase: "guess" });
    return true;
  });
}

export async function lockPartyGuessTransaction(db: Firestore, ref: DocumentReference, pid: string, n: number, guess: number) {
  if (!Number.isInteger(guess) || guess < 0 || guess > 100) return false;
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) return false;
    const room = snap.data() as RoomData;
    const party = room.party;
    if (room.phase !== "guess" || !party || party.n !== n || !party.order.includes(pid) || party.round.giver === pid || party.round.guesses[pid] !== undefined) return false;
    const guesses = { ...party.round.guesses, [pid]: guess };
    const complete = party.order.filter((id) => id !== party.round.giver).every((id) => guesses[id] !== undefined);
    if (!complete) {
      tx.update(ref, { [`party.round.guesses.${pid}`]: guess });
      return true;
    }
    const { awards, teamPoints } = scorePartyRound(party.order, party.round.giver, party.round.target, guesses);
    const scores = Object.fromEntries(party.order.map((id) => [id, (party.scores[id] ?? 0) + awards[id]]));
    tx.update(ref, {
      "party.round.guesses": guesses, "party.awards": awards, "party.scores": scores,
      score: room.score + teamPoints, roundScore: (room.roundScore ?? 0) + teamPoints, phase: "reveal",
    });
    return true;
  });
}

export async function advancePartyTransaction(db: Firestore, ref: DocumentReference, pid: string, n: number, expectedPhase: "reveal" | "summary" = "reveal") {
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) return false;
    const room = snap.data() as RoomData;
    const party = room.party;
    if (room.host !== pid || !party || party.n !== n || room.phase !== expectedPhase) return false;
    if (room.phase === "reveal" && n % partyQuestionCount(room) === 0) {
      tx.update(ref, { phase: "summary" });
      return true;
    }
    const fresh = freshPartyRound(room, party.order, n + 1);
    tx.update(ref, {
      "party.n": n + 1, "party.round": fresh.round, "party.awards": {}, phase: "clue", usedSpectra: fresh.used,
      ...(room.phase === "summary" ? { roundScore: 0 } : {}),
    });
    return true;
  });
}
