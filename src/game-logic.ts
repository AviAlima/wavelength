import { runTransaction, deleteField, type Firestore, type DocumentReference } from "firebase/firestore";
import { SPECTRA } from "./spectra.js";
export type RoomPhase = "lobby" | "setup" | "clue" | "guess" | "reveal" | "summary";

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
  categories?: string[];
  collective?: boolean;
  setup?: SetupState;
  group?: number;
}

export interface SetupItem {
  left: string;
  right: string;
  target: number;
  by: string;
  clue: string;
  answer: number | null;
  skipped: boolean;
}

export interface PlayerSetup {
  skips: number;
  total: number;
}

export interface SetupState {
  q: Record<string, SetupItem>;
  byPlayer: Record<string, PlayerSetup>;
  startedAt: number;
}

export const setupQList = (q: SetupState["q"]): SetupItem[] =>
  Array.isArray(q) ? q : Object.values(q);

const freshSetup = (q: SetupItem[], pids: string[]): SetupState => ({
  q: Object.fromEntries(q.map((it, i) => [String(i), it])),
  byPlayer: Object.fromEntries(pids.map((pid) => [pid, { skips: MAX_SKIPS, total: q.filter((it) => it.by === pid).length }])),
  startedAt: Date.now(),
});

const dealItems = (qpr: number, used: number[], categories: string[] | undefined, hostId: string, pids: string[]): { q: SetupItem[]; used: number[] } => {
  const guestId = pids.find((p) => p !== hostId)!;
  let u = used;
  const q: SetupItem[] = [];
  for (let i = 0; i < qpr; i++) {
    const pick = pickSpectrumIndex(u, poolFor(categories));
    u = pick.used;
    const sp = SPECTRA[pick.idx];
    q.push({ left: sp.left, right: sp.right, target: randomTarget(), by: i % 2 === 0 ? hostId : guestId, clue: "", answer: null, skipped: false });
  }
  return { q, used: u };
};

export const DEFAULT_QUESTIONS_PER_ROUND = 6;
export const MAX_SKIPS = 2;

export const pointsFor = (target: number, guess: number): number => {
  const d = Math.abs(target - guess);
  if (d < 6) return 4;
  if (d < 12) return 3;
  if (d < 20) return 2;
  if (d < 30) return 1;
  return 0;
};

export const poolFor = (categories: string[] | undefined): number[] => {
  if (categories?.length) {
    return SPECTRA.flatMap((p, i) => (categories.includes(p.category) ? [i] : []));
  }
  return SPECTRA.map((_, i) => i);
};

export const pickSpectrumIndex = (used: number[], pool: number[]): { idx: number; used: number[] } => {
  const available = pool.filter((i) => !used.includes(i));
  const draw = available.length ? available : pool;
  const idx = draw[Math.floor(Math.random() * draw.length)];
  return { idx, used: [...used.filter((i) => i !== idx), idx] };
};

export const makeRound = (n: number, giver: string, guesser: string, spectrumIdx: number): Round => {
  const sp = SPECTRA[spectrumIdx];
  return {
    n,
    giver,
    guesser,
    left: sp.left,
    right: sp.right,
    target: randomTarget(),
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
    const pick = pickSpectrumIndex([], poolFor(data.categories));
    const round = makeRound(1, giver, guesser, pick.idx);
    tx.update(roomRef, { phase: "clue", round, roundScore: 0, usedSpectra: pick.used });
    return round;
  });
};

const randomTarget = () => 3 + Math.floor(Math.random() * 94);

export const startCollectiveTransaction = async (db: Firestore, roomRef: DocumentReference): Promise<number | null> => {
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(roomRef);
    const data = snap.data() as RoomData | undefined;
    if (!snap.exists() || !data || data.phase !== "lobby") return null;
    const pids = Object.keys(data.players);
    if (pids.length < 2) return null;
    const qpr = data.questionsPerRound ?? DEFAULT_QUESTIONS_PER_ROUND;
    const deal = dealItems(qpr, data.usedSpectra ?? [], data.categories, data.host, pids);
    const setup = freshSetup(deal.q, pids);
    tx.update(roomRef, { phase: "setup", setup, roundScore: 0, usedSpectra: deal.used, group: (data.group ?? 0) + 1 });
    return deal.q.length;
  });
};

export const skipSetupTransaction = async (
  db: Firestore,
  roomRef: DocumentReference,
  pid: string,
  key: string,
): Promise<boolean> => {
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(roomRef);
    const data = snap.data() as RoomData | undefined;
    if (!snap.exists() || !data || data.phase !== "setup" || !data.setup) return false;
    const ps = data.setup.byPlayer[pid];
    const item = data.setup.q[key];
    if (!ps || ps.skips <= 0 || !item || item.by !== pid) return false;
    tx.update(roomRef, {
      [`setup.q.${key}`]: deleteField(),
      [`setup.byPlayer.${pid}.skips`]: ps.skips - 1,
    });
    return true;
  });
};

export const allCluesDone = (data: RoomData): boolean => {
  if (!data.setup) return false;
  return setupQList(data.setup.q).every((it) => it.clue.trim() !== "");
};

export const allGuessesDone = (data: RoomData): boolean => {
  if (!data.setup) return false;
  return setupQList(data.setup.q).every((it) => it.answer != null);
};

export const setupDoneTransaction = async (
  db: Firestore,
  roomRef: DocumentReference,
): Promise<boolean> => {
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(roomRef);
    const data = snap.data() as RoomData | undefined;
    if (!snap.exists() || !data || data.phase !== "setup" || !data.setup) return false;
    if (!allCluesDone(data)) return false;
    tx.update(roomRef, { phase: "guess" });
    return true;
  });
};

export const guessDoneTransaction = async (
  db: Firestore,
  roomRef: DocumentReference,
): Promise<number | null> => {
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(roomRef);
    const data = snap.data() as RoomData | undefined;
    if (!snap.exists() || !data || data.phase !== "guess" || !data.setup) return null;
    if (!allGuessesDone(data)) return null;
    const items = setupQList(data.setup.q);
    const pts = items.reduce((sum, it) => sum + pointsFor(it.target, it.answer ?? 50), 0);
    tx.update(roomRef, { score: data.score + pts, roundScore: pts, phase: "summary" });
    return pts;
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
    const pick = pickSpectrumIndex(data.usedSpectra ?? [], poolFor(data.categories));
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
    if (data.collective) {
      const pids = Object.keys(data.players);
      if (pids.length < 2) return null;
      const qpr = data.questionsPerRound ?? DEFAULT_QUESTIONS_PER_ROUND;
      const deal = dealItems(qpr, data.usedSpectra ?? [], data.categories, data.host, pids);
      const setup = freshSetup(deal.q, pids);
      tx.update(roomRef, { phase: "setup", setup, roundScore: 0, usedSpectra: deal.used, group: (data.group ?? 0) + 1 });
      return null;
    }
    if (!r || r.n !== expectedN) return null;
    const pick = pickSpectrumIndex(data.usedSpectra ?? [], poolFor(data.categories));
    const round = makeRound(r.n + 1, r.guesser, r.giver, pick.idx);
    tx.update(roomRef, { roundScore: 0, usedSpectra: pick.used, phase: "clue", round });
    return round;
  });
};
