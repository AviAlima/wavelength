import { initializeApp } from "firebase/app";
import { getFirestore, doc, setDoc, getDoc, updateDoc, deleteDoc } from "firebase/firestore";
import { firebaseConfig } from "../js/firebase-config.mjs";
import { pointsFor, startGameTransaction, nextRoundTransaction } from "../js/game-logic.mjs";

const appA = initializeApp(firebaseConfig, "simA");
const appB = initializeApp(firebaseConfig, "simB");
const dbA = getFirestore(appA);
const dbB = getFirestore(appB);

let passed = 0;
const assert = (cond, msg) => {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
  passed++;
  console.log("ok:", msg);
};
const eq = (a, b) => {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => Object.hasOwn(b, k) && eq(a[k], b[k]));
};
const read = async (db, code) => (await getDoc(doc(db, "rooms", code))).data();
const roomRef = (db, code) => doc(db, "rooms", code);
const makeCode = () => "S" + Math.random().toString(36).slice(2, 6).toUpperCase();
const cleanup = [];

async function makeRoom() {
  const c = makeCode();
  await setDoc(roomRef(dbA, c), {
    code: c,
    createdAt: new Date(),
    players: { A: { id: "A", name: "Avi", color: "#38bdf8" } },
    phase: "lobby",
    score: 0,
    round: null,
  });
  await updateDoc(roomRef(dbA, c), { "players.B": { id: "B", name: "Babi", color: "#f472b6" } });
  cleanup.push(c);
  return c;
}

console.log("--- test: happy path (full game flow) ---");
{
  const c = await makeRoom();
  await startGameTransaction(dbA, roomRef(dbA, c));
  let a = await read(dbA, c);
  let b = await read(dbB, c);
  assert(a.phase === "clue" && a.round, "game starts into clue phase");
  assert(eq(a.round, b.round), "both players see the identical round (same spectrum)");

  await updateDoc(roomRef(dbA, c), { phase: "guess", "round.clue": "banana" });
  a = await read(dbA, c);
  b = await read(dbB, c);
  assert(a.phase === "guess" && a.round.clue === "banana", "clue sent moves to guess phase");
  assert(eq(a.round, b.round), "both players see the same clue on the same spectrum");

  await updateDoc(roomRef(dbA, c), { phase: "reveal", "round.guess": 40 });
  a = await read(dbA, c);
  assert(a.phase === "reveal" && a.round.guess === 40, "guess locked moves to reveal");

  const expected = pointsFor(a.round.target, 40);
  const res = await nextRoundTransaction(dbA, roomRef(dbA, c), a.round.n);
  assert(res && res.points === expected, `points computed correctly (${expected})`);
  a = await read(dbA, c);
  b = await read(dbB, c);
  assert(a.score === expected, "score accumulated exactly once");
  assert(a.round.n === 2, "round advanced to 2");
  assert(a.round.giver === res.round.giver && a.round.giver !== a.round.guesser, "clue giver alternated");
  assert(eq(a.round, b.round), "both players see the identical next round (same spectrum)");
}

console.log("--- test: double-start race (the spectrum desync bug) ---");
{
  const c = await makeRoom();
  await Promise.all([
    startGameTransaction(dbA, roomRef(dbA, c)),
    startGameTransaction(dbB, roomRef(dbB, c)),
  ]);
  const a = await read(dbA, c);
  const b = await read(dbB, c);
  assert(a.phase === "clue" && a.round && a.round.n === 1, "double start commits exactly one round");
  assert(eq(a.round, b.round), "double start: both players converge to the same spectrum");
}

console.log("--- test: double-next race (double scoring) ---");
{
  const c = await makeRoom();
  await startGameTransaction(dbA, roomRef(dbA, c));
  const st = await read(dbA, c);
  const expected = pointsFor(st.round.target, 50);
  await updateDoc(roomRef(dbA, c), { phase: "guess", "round.clue": "clue" });
  await updateDoc(roomRef(dbA, c), { phase: "reveal", "round.guess": 50 });
  await Promise.all([
    nextRoundTransaction(dbA, roomRef(dbA, c), st.round.n),
    nextRoundTransaction(dbB, roomRef(dbB, c), st.round.n),
  ]);
  const a = await read(dbA, c);
  const b = await read(dbB, c);
  assert(a.score === expected, "double next scores exactly once");
  assert(a.round.n === 2, "double next advances exactly one round");
  assert(eq(a.round, b.round), "double next: both players see the same new round");
}

console.log(`\nAll ${passed} assertions passed.`);
for (const c of cleanup) {
  try { await deleteDoc(roomRef(dbA, c)); } catch { /* ignore */ }
}
process.exit(0);
