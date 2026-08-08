import { initializeApp } from "firebase/app";
import { getFirestore, doc, setDoc, updateDoc, getDoc, onSnapshot, serverTimestamp } from "firebase/firestore";
import { firebaseConfig } from "./firebase-config.js";
import { SPECTRA } from "./spectra.js";

const VERSION = "1.0.2";
document.getElementById("version").textContent = VERSION;

initializeApp(firebaseConfig);
const db = getFirestore();

const $ = (id) => document.getElementById(id);

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
const makeCode = () => {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let c = "";
  for (let i = 0; i < 5; i++) c += chars[Math.floor(Math.random() * chars.length)];
  return c;
};
const pointsFor = (t, g) => {
  const d = Math.abs(t - g);
  if (d < 10) return 4;
  if (d < 20) return 3;
  if (d < 30) return 2;
  if (d < 40) return 1;
  return 0;
};

const COLORS = ["#38bdf8", "#f472b6", "#a78bfa", "#fbbf24", "#34d399", "#fb7185"];

let myId = localStorage.getItem("wave_id");
if (!myId) { myId = uid(); localStorage.setItem("wave_id", myId); }

let roomCode = null;
let roomData = null;
let unsub = null;
let draftGuess = 50;

const ref = () => doc(db, "rooms", roomCode);
const screens = { home: $("screen-home"), lobby: $("screen-lobby"), game: $("screen-game") };
const show = (name) => { for (const [k, el] of Object.entries(screens)) el.hidden = k !== name; };
const setPos = (el, val) => { el.style.left = `${val}%`; };

/* ---------- home ---------- */

const nickInput = $("nick-input");
nickInput.value = localStorage.getItem("wave_nick") || "";
nickInput.addEventListener("input", () => localStorage.setItem("wave_nick", nickInput.value.trim()));
const myName = () => nickInput.value.trim() || "Player 1";

async function createRoom() {
  if (!nickInput.value.trim()) { nickInput.focus(); return; }
  const code = makeCode();
  try {
    await setDoc(doc(db, "rooms", code), {
      code,
      createdAt: serverTimestamp(),
      players: { [myId]: { id: myId, name: myName(), color: COLORS[0] } },
      phase: "lobby",
      score: 0,
      round: null,
    });
    openRoom(code);
  } catch (err) {
    alert("Could not create room. Did you paste your Firebase config in js/firebase-config.js? " + err.message);
  }
}

async function joinRoom() {
  const code = $("join-input").value.trim().toUpperCase();
  if (!code) return;
  try {
    const snap = await getDoc(doc(db, "rooms", code));
    if (!snap.exists()) { alert("Room not found"); return; }
    const data = snap.data();
    const pids = Object.keys(data.players);
    if (data.phase !== "lobby") {
      if (pids.includes(myId)) { openRoom(code); return; }
      alert("The game already started");
      return;
    }
    if (pids.includes(myId)) {
      openRoom(code);
      return;
    }
    if (pids.length >= 2) { alert("Room is full"); return; }
    await updateDoc(doc(db, "rooms", code), {
      [`players.${myId}`]: { id: myId, name: myName(), color: COLORS[pids.length] },
    });
    openRoom(code);
  } catch (err) { alert("Could not join: " + err.message); }
}

function openRoom(code) {
  roomCode = code;
  if (unsub) unsub();
  unsub = onSnapshot(doc(db, "rooms", code), (snap) => {
    if (!snap.exists()) return;
    roomData = snap.data();
    render();
  });
}

function leaveRoom() {
  if (unsub) unsub();
  roomCode = null;
  roomData = null;
  unsub = null;
  show("home");
}

$("btn-create").addEventListener("click", createRoom);
$("join-input").addEventListener("keydown", (e) => { if (e.key === "Enter") joinRoom(); });
$("btn-join").addEventListener("click", joinRoom);
$("btn-leave").addEventListener("click", leaveRoom);
$("btn-leave-game").addEventListener("click", leaveRoom);

/* ---------- render ---------- */

function render() {
  if (!roomData) return;
  if (roomData.phase === "lobby") renderLobby();
  else renderGame();
}

function renderLobby() {
  show("lobby");
  $("lobby-code").textContent = roomData.code;
  const list = $("lobby-players");
  list.innerHTML = "";
  Object.values(roomData.players).forEach((p) => {
    const row = document.createElement("div");
    row.className = "player-row";
    const dot = document.createElement("span");
    dot.className = "dot";
    dot.style.background = p.color;
    row.append(dot, document.createTextNode(`${p.name}${p.id === myId ? " (you)" : ""}`));
    list.append(row);
  });
  const n = Object.keys(roomData.players).length;
  const start = $("lobby-start");
  start.hidden = false;
  start.disabled = n < 2;
  start.textContent = n < 2 ? `Start game (${n}/2 players)` : "Start game";
  $("lobby-waiting").hidden = n === 2;
}

/* ---------- game ---------- */

$("btn-start").addEventListener("click", async () => {
  const pids = Object.keys(roomData.players);
  const giver = pids[Math.floor(Math.random() * pids.length)];
  const sp = SPECTRA[Math.floor(Math.random() * SPECTRA.length)];
  await updateDoc(ref(), {
    phase: "clue",
    round: {
      n: 1,
      giver,
      guesser: pids.find((p) => p !== giver),
      left: sp[0],
      right: sp[1],
      target: 3 + Math.floor(Math.random() * 94),
      clue: "",
      guess: null,
      scored: false,
    },
  });
});

function renderGame() {
  show("game");
  const r = roomData.round;
  if (!r) return;
  const isGiver = r.giver === myId;
  const isGuesser = r.guesser === myId;
  const cluePhase = r.phase === "clue";
  const guessPhase = r.phase === "guess";
  const revealPhase = r.phase === "reveal";

  $("game-code").textContent = roomData.code;
  $("score").textContent = roomData.score;
  $("round-num").textContent = r.n;
  $("round-info").textContent = `${roomData.players[r.giver].name} gives the clue${isGiver ? " — that's you" : ""}`;
  $("spec-left").textContent = r.left;
  $("spec-right").textContent = r.right;

  $("clue-box").hidden = !r.clue;
  $("clue-text").textContent = r.clue;

  /* markers */
  $("target-marker").hidden = !isGiver || revealPhase;
  if (isGiver && !revealPhase) {
    setPos($("target-marker"), r.target);
    $("target-badge").textContent = `Target: ${r.target}`;
  }
  $("guess-arrow").hidden = !(isGuesser && guessPhase);
  if (isGuesser && guessPhase) {
    setPos($("guess-arrow"), draftGuess);
    $("guess-value").textContent = Math.round(draftGuess);
  }
  $("reveal-guess").hidden = !revealPhase;
  $("reveal-target").hidden = !revealPhase;
  if (revealPhase) {
    setPos($("reveal-guess"), r.guess);
    setPos($("reveal-target"), r.target);
    $("reveal-clue").textContent = r.clue;
    $("reveal-delta").textContent = `Target ${r.target} vs guess ${r.guess} — off by ${Math.abs(r.target - r.guess)}`;
    const pts = pointsFor(r.target, r.guess);
    $("reveal-points").textContent = pts > 0 ? `+${pts} points` : "+0 points";
  }

  /* panels */
  $("giver-panel").hidden = !isGiver || revealPhase;
  if (isGiver && !revealPhase) {
    $("clue-input-wrap").hidden = !cluePhase;
    $("giver-wait").hidden = !guessPhase;
  }
  $("guess-panel").hidden = !isGuesser || revealPhase;
  if (isGuesser && !revealPhase) {
    $("guess-wait").hidden = !cluePhase;
    $("guess-dial").hidden = !guessPhase;
  }
  $("reveal-panel").hidden = !revealPhase;
}

$("btn-send").addEventListener("click", async () => {
  const clue = $("clue-input").value.trim();
  if (!clue) return;
  try {
    await updateDoc(ref(), { phase: "guess", "round.clue": clue });
    $("clue-input").value = "";
  } catch (err) { alert("Failed: " + err.message); }
});

$("btn-lock").addEventListener("click", async () => {
  try {
    await updateDoc(ref(), { phase: "reveal", "round.guess": Math.round(draftGuess) });
  } catch (err) { alert("Failed: " + err.message); }
});

$("btn-next").addEventListener("click", async () => {
  const r = roomData.round;
  if (r.scored) return;
  r.scored = true;
  const score = roomData.score + pointsFor(r.target, r.guess);
  const sp = SPECTRA[Math.floor(Math.random() * SPECTRA.length)];
  await updateDoc(ref(), {
    score,
    phase: "clue",
    round: {
      n: r.n + 1,
      giver: r.guesser,
      guesser: r.giver,
      left: sp[0],
      right: sp[1],
      target: 3 + Math.floor(Math.random() * 94),
      clue: "",
      guess: null,
      scored: false,
    },
  });
});

/* ---------- dial ---------- */

const dialBar = $("dial-bar");
let dragging = false;
const move = (e) => {
  if (!roomData || roomData.phase !== "guess" || roomData.round.guesser !== myId) return;
  const rect = dialBar.getBoundingClientRect();
  let x = e.clientX - rect.left;
  x = Math.max(0, Math.min(rect.width, x));
  draftGuess = (x / rect.width) * 100;
  setPos($("guess-arrow"), draftGuess);
  $("guess-value").textContent = Math.round(draftGuess);
};
dialBar.addEventListener("pointerdown", (e) => {
  dragging = true;
  dialBar.setPointerCapture(e.pointerId);
  move(e);
});
dialBar.addEventListener("pointermove", (e) => { if (dragging) move(e); });
dialBar.addEventListener("pointerup", () => { dragging = false; });
dialBar.addEventListener("pointercancel", () => { dragging = false; });

show("home");
