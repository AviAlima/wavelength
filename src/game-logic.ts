import { runTransaction, type Firestore, type DocumentReference } from "firebase/firestore";
import { SPECTRA } from "./spectra.js";

export type RoomPhase = "lobby" | "clue" | "guess" | "reveal" | "summary";

export interface Player {
  id: string;
  name: string;
  color: string;
}

export interface Round {
  n: number;
  giver: string;
  guesser: string;
  left: string;
  right: string;
  target: number;
  clue: string;
  guess: number | null;
}

export interface RoomData {
  code: string;
  host: string;
  players: Record<string, Player>;
  phase: RoomPhase;
  score: number;
  round: Round | null;
  questionsPerRound?: number;
  roundScore?: number;
  usedSpectra?: number[];
}

export const DEFAULT_QUESTIONS_PER_ROUND = 6;

export const pointsFor = (target: number, guess: number): number => {
  const d = Math.abs(target - guess);
  if (d < 6) return 4;
  if (d < 12) return 3;
  if (d < 20) return 2;
  if (d < 30) return 1;
  return 0;
};

export const pickSpectrumIndex = (used: number[]): { idx: number; used: number[] } => {
  const all = SPECTRA.map((_, i) => i);
  const available = all.filter((i) => !used.includes(i));
  const pool = available.length ? available : all;
  const idx = pool[Math.floor(Math.random() * pool.length)];
  return { idx, used: [...used.filter((i) => i !== idx), idx] };
};

export const makeRound = (n: number, giver: string, guesser: string, spectrumIdx: number): Round => {
  const sp = SPECTRA[spectrumIdx];
  return {
    n,
    giver,
    guesser,
    left: sp[0],
    right: sp[1],
    target: 3 + Math.floor(Math.random() * 94),
    clue: "",
    guess: null,
  };
};

export const startGameTransaction = async (db: Firestore, roomRef: DocumentReference): Promise<Round | null> => {
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(roomRef);
    const data = snap.data() as RoomData | undefined;
    if (!snap.exists() || !data || data.phase !== "lobby") return null;
    const pids = Object.keys(data.players);
    if (pids.length < 2) return null;
    const giver = pids[Math.floor(Math.random() * pids.length)];
    const guesser = pids.find((p) => p !== giver)!;
    const pick = pickSpectrumIndex([]);
    const round = makeRound(1, giver, guesser, pick.idx);
    tx.update(roomRef, { phase: "clue", round, roundScore: 0, usedSpectra: pick.used });
    return round;
  });
};

export const nextRoundTransaction = async (
  db: Firestore,
  roomRef: DocumentReference,
  expectedN: number,
): Promise<{ points: number; round: Round; ended: boolean } | null> => {
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(roomRef);
    const data = snap.data() as RoomData | undefined;
    if (!snap.exists() || !data) return null;
    const r = data.round;
    if (!r || r.n !== expectedN || r.guess == null) return null;
    const pts = pointsFor(r.target, r.guess);
    const score = data.score + pts;
    const roundScore = (data.roundScore ?? 0) + pts;
    const qpr = data.questionsPerRound ?? DEFAULT_QUESTIONS_PER_ROUND;
    if (r.n % qpr === 0) {
      tx.update(roomRef, { score, roundScore, phase: "summary" });
      return { points: pts, round: r, ended: true };
    }
    const pick = pickSpectrumIndex(data.usedSpectra ?? []);
    const round = makeRound(r.n + 1, r.guesser, r.giver, pick.idx);
    tx.update(roomRef, { score, roundScore, usedSpectra: pick.used, phase: "clue", round });
    return { points: pts, round, ended: false };
  });
};

export const continueTransaction = async (
  db: Firestore,
  roomRef: DocumentReference,
  expectedN: number,
): Promise<Round | null> => {
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(roomRef);
    const data = snap.data() as RoomData | undefined;
    if (!snap.exists() || !data || data.phase !== "summary") return null;
    const r = data.round;
    if (!r || r.n !== expectedN) return null;
    const pick = pickSpectrumIndex(data.usedSpectra ?? []);
    const round = makeRound(r.n + 1, r.guesser, r.giver, pick.idx);
    tx.update(roomRef, { roundScore: 0, usedSpectra: pick.used, phase: "clue", round });
    return round;
  });
};
