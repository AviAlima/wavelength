import { runTransaction, type Firestore, type DocumentReference } from "firebase/firestore";
import { SPECTRA } from "./spectra.js";

export type RoomPhase = "lobby" | "clue" | "guess" | "reveal";

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
}

export const pointsFor = (target: number, guess: number): number => {
  const d = Math.abs(target - guess);
  if (d < 6) return 4;
  if (d < 12) return 3;
  if (d < 20) return 2;
  if (d < 30) return 1;
  return 0;
};

export const makeRound = (n: number, giver: string, guesser: string): Round => {
  const sp = SPECTRA[Math.floor(Math.random() * SPECTRA.length)];
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
    const round = makeRound(1, giver, guesser);
    tx.update(roomRef, { phase: "clue", round });
    return round;
  });
};

export const nextRoundTransaction = async (
  db: Firestore,
  roomRef: DocumentReference,
  expectedN: number,
): Promise<{ points: number; round: Round } | null> => {
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(roomRef);
    const data = snap.data() as RoomData | undefined;
    if (!snap.exists() || !data) return null;
    const r = data.round;
    if (!r || r.n !== expectedN || r.guess == null) return null;
    const pts = pointsFor(r.target, r.guess);
    const round = makeRound(r.n + 1, r.guesser, r.giver);
    tx.update(roomRef, { score: data.score + pts, phase: "clue", round });
    return { points: pts, round };
  });
};
