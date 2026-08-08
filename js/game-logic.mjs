import { runTransaction } from "firebase/firestore";
import { SPECTRA } from "./spectra.mjs";

export const pointsFor = (t, g) => {
  const d = Math.abs(t - g);
  if (d < 10) return 4;
  if (d < 20) return 3;
  if (d < 30) return 2;
  if (d < 40) return 1;
  return 0;
};

export const makeRound = (n, giver, guesser) => {
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

export const startGameTransaction = async (db, roomRef) => {
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(roomRef);
    if (!snap.exists() || snap.data().phase !== "lobby") return null;
    const pids = Object.keys(snap.data().players);
    if (pids.length < 2) return null;
    const giver = pids[Math.floor(Math.random() * pids.length)];
    const guesser = pids.find((p) => p !== giver);
    const round = makeRound(1, giver, guesser);
    tx.update(roomRef, { phase: "clue", round });
    return round;
  });
};

export const nextRoundTransaction = async (db, roomRef, expectedN) => {
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(roomRef);
    if (!snap.exists()) return null;
    const data = snap.data();
    const r = data.round;
    if (!r || r.n !== expectedN || r.guess == null) return null;
    const pts = pointsFor(r.target, r.guess);
    const round = makeRound(r.n + 1, r.guesser, r.giver);
    tx.update(roomRef, { score: data.score + pts, phase: "clue", round });
    return { points: pts, round };
  });
};
