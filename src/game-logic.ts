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
  answer: number | null;
  skipped: boolean;
}

export interface PlayerSetup {
  cur: number;
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

const freshSetup = (q: SetupItem[], pids: string[], hostId: string): SetupState => ({
  q: Object.fromEntries(q.map((it, i) => [String(i), it])),
  byPlayer: Object.fromEntries(pids.map((pid) => [pid, { cur: 0, skips: MAX_SKIPS, total: q.filter((it) => it.by === pid).length }])),
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
    q.push({ left: sp.left, right: sp.right, target: randomTarget(), by: i % 2 === 0 ? hostId : guestId, answer: null, skipped: false });
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
    const setup = freshSetup(deal.q, pids, data.host);
    tx.update(roomRef, { phase: "setup", setup, roundScore: 0, usedSpectra: deal.used, group: (data.group ?? 0) + 1 });
    return deal.q.length;
  });
};

export const skipSetupTransaction = async (
  db: Firestore,
  roomRef: DocumentReference,
  pid: string,
): Promise<boolean> => {
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(roomRef);
    const data = snap.data() as RoomData | undefined;
    if (!snap.exists() || !data || data.phase !== "setup" || !data.setup) return false;
    const q = data.setup.q;
    const ps = data.setup.byPlayer[pid];
    if (!ps || ps.skips <= 0) return false;
    const mine = Object.entries(q).filter(([, it]) => it.by === pid);
    if (ps.cur >= mine.length) return false;
    const [key] = mine[ps.cur];
    tx.update(roomRef, {
      [`setup.q.${key}`]: deleteField(),
      [`setup.byPlayer.${pid}.cur`]: ps.cur,
      [`setup.byPlayer.${pid}.skips`]: ps.skips - 1,
    });
    return true;
  });
};

export const allSetupDone = (data: RoomData): boolean => {
  if (!data.setup) return false;
  const { q, byPlayer } = data.setup;
  return Object.keys(data.players).every((pid) => {
    const n = setupQList(q).filter((it) => it.by === pid).length;
    return (byPlayer[pid]?.cur ?? 0) >= n;
  });
};

export const setupDoneTransaction = async (
  db: Firestore,
  roomRef: DocumentReference,
): Promise<Round | null> => {
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(roomRef);
    const data = snap.data() as RoomData | undefined;
    if (!snap.exists() || !data || data.phase !== "setup" || !data.setup) return null;
    if (!allSetupDone(data)) return null;
    const item = setupQList(data.setup.q)[0];
    const guesser = Object.keys(data.players).find((p) => p !== item.by)!;
    const round: Round = { n: 1, giver: item.by, guesser, left: item.left, right: item.right, target: item.target, clue: "", guess: item.answer ?? 50 };
    tx.update(roomRef, { phase: "reveal", round });
    return round;
  });
};

export const nextCollectiveTransaction = async (
  db: Firestore,
  roomRef: DocumentReference,
  expectedN: number,
): Promise<{ points: number; round: Round; ended: boolean } | null> => {
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(roomRef);
    const data = snap.data() as RoomData | undefined;
    if (!snap.exists() || !data) return null;
    const r = data.round;
    const st = data.setup;
    if (!r || !st || r.n !== expectedN || r.guess == null) return null;
    const pts = pointsFor(r.target, r.guess);
    const score = data.score + pts;
    const roundScore = (data.roundScore ?? 0) + pts;
    const qList = setupQList(st.q);
    if (r.n >= qList.length) {
      tx.update(roomRef, { score, roundScore, phase: "summary" });
      return { points: pts, round: r, ended: true };
    }
    const item = qList[r.n];
    const guesser = Object.keys(data.players).find((p) => p !== item.by)!;
    const round: Round = { n: r.n + 1, giver: item.by, guesser, left: item.left, right: item.right, target: item.target, clue: "", guess: item.answer ?? 50 };
    tx.update(roomRef, { score, roundScore, phase: "reveal", round });
    return { points: pts, round, ended: false };
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
    if (!r || r.n !== expectedN) return null;
    if (data.collective) {
      const pids = Object.keys(data.players);
      if (pids.length < 2) return null;
      const qpr = data.questionsPerRound ?? DEFAULT_QUESTIONS_PER_ROUND;
      const deal = dealItems(qpr, data.usedSpectra ?? [], data.categories, data.host, pids);
      const setup = freshSetup(deal.q, pids, data.host);
      tx.update(roomRef, { phase: "setup", setup, roundScore: 0, usedSpectra: deal.used, group: (data.group ?? 0) + 1 });
      return null;
    }
    const pick = pickSpectrumIndex(data.usedSpectra ?? [], poolFor(data.categories));
    const round = makeRound(r.n + 1, r.guesser, r.giver, pick.idx);
    tx.update(roomRef, { roundScore: 0, usedSpectra: pick.used, phase: "clue", round });
    return round;
  });
};
