import { initializeApp } from "firebase/app";
import { getFirestore, initializeFirestore, doc, setDoc, updateDoc, getDoc, deleteDoc, onSnapshot, serverTimestamp, deleteField } from "firebase/firestore";
import { firebaseConfig } from "./firebase-config.js";
import { pointsFor, startGameTransaction, nextRoundTransaction, type RoomData } from "./game-logic.js";

const VERSION = "1.1.3";
document.getElementById("version")!.textContent = VERSION;

const app = initializeApp(firebaseConfig);
const db = initializeFirestore(app, { experimentalForceLongPolling: true });

const $ = (id: string): HTMLElement => document.getElementById(id)!;

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
const makeCode = () => {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let c = "";
  for (let i = 0; i < 5; i++) c += chars[Math.floor(Math.random() * chars.length)];
  return c;
};

const COLORS = ["#38bdf8", "#f472b6", "#a78bfa", "#fbbf24", "#34d399", "#fb7185"];

const storedId = sessionStorage.getItem("wave_id") || localStorage.getItem("wave_id");
const myId: string = storedId || uid();
sessionStorage.setItem("wave_id", myId);

let roomCode: string | null = null;
let roomData: RoomData | null = null;
let unsub: (() => void) | null = null;
let draftGuess = 50;
let resetRoundN = 0;

const ref = () => doc(db, "rooms", roomCode!);
const screens: Record<string, HTMLElement> = { home: $("screen-home"), lobby: $("screen-lobby"), game: $("screen-game") };
const show = (name: string) => { for (const [k, el] of Object.entries(screens)) el.hidden = k !== name; };
const setPos = (el: HTMLElement, val: number) => { el.style.left = `${val}%`; };

/* ---------- home ---------- */

const nickInput = $("nick-input") as HTMLInputElement;
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
      host: myId,
      players: { [myId]: { id: myId, name: myName(), color: COLORS[0] } },
      phase: "lobby",
      score: 0,
      round: null,
    });
    openRoom(code);
  } catch (err) {
    alert("Could not create room. Did you paste your Firebase config in src/firebase-config.ts? " + (err as Error).message);
  }
}

async function joinRoom() {
  const code = ($("join-input") as HTMLInputElement).value.trim().toUpperCase();
  if (!code) return;
  try {
    const snap = await getDoc(doc(db, "rooms", code));
    if (!snap.exists()) { alert("Room not found"); return; }
    const data = snap.data() as RoomData;
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
  } catch (err) { alert("Could not join: " + (err as Error).message); }
}

function openRoom(code: string) {
  roomCode = code;
  if (unsub) unsub();
  unsub = onSnapshot(doc(db, "rooms", code), { includeMetadataChanges: true }, (snap) => {
    if (!snap.exists()) {
      alert("The party was closed by the other player");
      leaveRoom();
      return;
    }
    roomData = snap.data() as RoomData;
    setSync(!!(snap.metadata.hasPendingWrites || snap.metadata.fromCache));
    render();
  });
}

const setSync = (warn: boolean) => {
  $("sync-dot").classList.toggle("warn", warn);
};

async function leaveRoom() {
  if (roomCode && roomData) {
    try {
      if (roomData.phase === "lobby") {
        await updateDoc(ref(), { [`players.${myId}`]: deleteField() });
        if (Object.keys(roomData.players).filter((p) => p !== myId).length === 0) {
          await deleteDoc(ref());
        }
      } else {
        await deleteDoc(ref());
      }
    } catch (e) { /* ignore */ }
  }
  if (unsub) unsub();
  roomCode = null;
  roomData = null;
  unsub = null;
  show("home");
}

$("btn-copy").addEventListener("click", async () => {
  if (!roomData) return;
  try { await navigator.clipboard.writeText(roomData.code); }
  catch { prompt("Party code:", roomData.code); }
});

$("btn-create").addEventListener("click", createRoom);
($("join-input") as HTMLInputElement).addEventListener("keydown", (e) => { if (e.key === "Enter") joinRoom(); });
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
  $("lobby-code").textContent = roomData!.code;
  const list = $("lobby-players");
  list.innerHTML = "";
  Object.values(roomData!.players).forEach((p) => {
    const row = document.createElement("div");
    row.className = "player-row";
    const dot = document.createElement("span");
    dot.className = "dot";
    dot.style.background = p.color;
    row.append(dot, document.createTextNode(`${p.name}${p.id === myId ? " (you)" : ""}`));
    list.append(row);
  });
  const n = Object.values(roomData!.players).length;
  const isHost = roomData!.host === myId;
  const start = $("btn-start") as HTMLButtonElement;
  start.hidden = !isHost;
  start.disabled = n < 2;
  start.textContent = n < 2 ? `Start game (${n}/2 players)` : "Start game";
  $("lobby-waiting").hidden = n >= 2;
  $("lobby-note").hidden = isHost || n < 2;
}

/* ---------- game ---------- */

$("btn-start").addEventListener("click", async () => {
  try {
    await startGameTransaction(db, ref());
  } catch (err) { alert("Failed to start: " + (err as Error).message); }
});

function renderGame() {
  show("game");
  const r = roomData!.round;
  if (!r) return;
  const isGiver = r.giver === myId;
  const isGuesser = r.guesser === myId;
  const cluePhase = roomData!.phase === "clue";
  const guessPhase = roomData!.phase === "guess";
  const revealPhase = roomData!.phase === "reveal";

  $("game-code").textContent = roomData!.code;
  $("score").textContent = String(roomData!.score);
  $("round-num").textContent = String(r.n);
  $("round-info").textContent = `${roomData!.players[r.giver].name} gives the clue${isGiver ? " — that's you" : ""}`;
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
    if (r.n !== resetRoundN) {
      draftGuess = 50;
      resetRoundN = r.n;
    }
    setPos($("guess-arrow"), draftGuess);
    $("guess-value").textContent = String(Math.round(draftGuess));
  }
  $("reveal-guess").hidden = !revealPhase;
  $("reveal-target").hidden = !revealPhase;
  if (revealPhase && r.guess != null) {
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
  const clue = ($("clue-input") as HTMLInputElement).value.trim();
  if (!clue) return;
  try {
    await updateDoc(ref(), { phase: "guess", "round.clue": clue });
    ($("clue-input") as HTMLInputElement).value = "";
  } catch (err) { alert("Failed: " + (err as Error).message); }
});

$("btn-lock").addEventListener("click", async () => {
  try {
    await updateDoc(ref(), { phase: "reveal", "round.guess": Math.round(draftGuess) });
  } catch (err) { alert("Failed: " + (err as Error).message); }
});

$("btn-next").addEventListener("click", async () => {
  const n = roomData?.round?.n;
  if (!n) return;
  try {
    await nextRoundTransaction(db, ref(), n);
  } catch (err) { alert("Failed: " + (err as Error).message); }
});

/* ---------- dial ---------- */

const dialBar = $("dial-bar");
let dragging = false;
const move = (e: PointerEvent) => {
  if (!roomData || roomData.phase !== "guess" || roomData.round?.guesser !== myId) return;
  const rect = dialBar.getBoundingClientRect();
  let x = e.clientX - rect.left;
  x = Math.max(0, Math.min(rect.width, x));
  draftGuess = (x / rect.width) * 100;
  setPos($("guess-arrow"), draftGuess);
  $("guess-value").textContent = String(Math.round(draftGuess));
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
