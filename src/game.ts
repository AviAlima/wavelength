import { initializeApp } from "firebase/app";
import { getFirestore, initializeFirestore, doc, setDoc, updateDoc, getDoc, deleteDoc, onSnapshot, serverTimestamp, deleteField } from "firebase/firestore";
import { firebaseConfig } from "./firebase-config.js";
import { pointsFor, startGameTransaction, nextRoundTransaction, continueTransaction, DEFAULT_QUESTIONS_PER_ROUND, type RoomData } from "./game-logic.js";
import { CATEGORIES, SPECTRA_BY_CATEGORY } from "./spectra.js";

const VERSION = "1.4.2";
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

const freshId = () => uid();
let myPlayerId: string | null = sessionStorage.getItem("wave_player_id");

let roomCode: string | null = null;
let roomData: RoomData | null = null;
let unsub: (() => void) | null = null;
let draftGuess = 50;
let resetRoundN = 0;

const ref = () => doc(db, "rooms", roomCode!);
const screens: Record<string, HTMLElement> = { home: $("screen-home"), cats: $("screen-cats"), lobby: $("screen-lobby"), game: $("screen-game"), summary: $("screen-summary") };
const show = (name: string) => { for (const [k, el] of Object.entries(screens)) el.hidden = k !== name; };
const setPos = (el: HTMLElement, val: number) => { el.style.left = `${val}%`; };

/* ---------- home ---------- */

const nickInput = $("nick-input") as HTMLInputElement;
nickInput.value = localStorage.getItem("wave_nick") || "";
nickInput.addEventListener("input", () => {
  localStorage.setItem("wave_nick", nickInput.value.trim());
  if (nickInput.value.trim()) {
    $("nick-error").hidden = true;
    nickInput.classList.remove("input-error");
  }
});

const requireName = (): boolean => {
  if (nickInput.value.trim()) {
    $("nick-error").hidden = true;
    nickInput.classList.remove("input-error");
    return true;
  }
  $("nick-error").hidden = false;
  nickInput.classList.add("input-error");
  nickInput.focus();
  return false;
};

const myName = () => nickInput.value.trim();

let catListBuilt = false;

function showCatScreen() {
  if (!requireName()) return;
  show("cats");
  if (catListBuilt) return;
  catListBuilt = true;
  const list = $("cat-list");
  CATEGORIES.forEach((c) => {
    const n = SPECTRA_BY_CATEGORY[c].length;
    const label = document.createElement("label");
    label.className = "cat-option";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.value = c;
    cb.checked = true;
    label.append(cb, document.createTextNode(`${c} (${n})`));
    list.append(label);
  });
}

$("btn-create").addEventListener("click", showCatScreen);
$("btn-back-cats").addEventListener("click", () => show("home"));
$("btn-create-cats").addEventListener("click", () => {
  const cats = Array.from(document.querySelectorAll<HTMLInputElement>("#cat-list input:checked")).map((i) => i.value);
  createRoom(cats);
});

async function createRoom(categories: string[]) {
  if (!requireName()) return;
  const code = makeCode();
  try {
    const id = freshId();
    sessionStorage.setItem("wave_player_id", id);
    myPlayerId = id;
    await setDoc(doc(db, "rooms", code), {
      code,
      createdAt: serverTimestamp(),
      host: id,
      players: { [id]: { id, name: myName(), color: COLORS[0] } },
      phase: "lobby",
      score: 0,
      questionsPerRound: 6,
      categories,
      round: null,
    });
    openRoom(code);
  } catch (err) {
    alert("Could not create room. Did you paste your Firebase config in src/firebase-config.ts? " + (err as Error).message);
  }
}

async function joinRoom() {
  if (!requireName()) return;
  const code = ($("join-input") as HTMLInputElement).value.trim().toUpperCase();
  if (!code) return;
  try {
    const snap = await getDoc(doc(db, "rooms", code));
    if (!snap.exists()) { alert("Room not found"); return; }
    const data = snap.data() as RoomData;
    const pids = Object.keys(data.players);
    if (data.phase !== "lobby") {
      if (myPlayerId && pids.includes(myPlayerId)) { openRoom(code); return; }
      alert("The game already started");
      return;
    }
    if (myPlayerId && pids.includes(myPlayerId)) {
      openRoom(code);
      return;
    }
    if (pids.length >= 2) { alert("Room is full"); return; }
    const id = freshId();
    sessionStorage.setItem("wave_player_id", id);
    myPlayerId = id;
    await updateDoc(doc(db, "rooms", code), {
      [`players.${id}`]: { id, name: myName(), color: COLORS[pids.length] },
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
      const isHost = roomData.host === myPlayerId;
      if (roomData.phase === "lobby") {
        if (isHost) {
          await deleteDoc(ref());
        } else {
          await updateDoc(ref(), { [`players.${myPlayerId}`]: deleteField() });
          if (Object.keys(roomData.players).filter((p) => p !== myPlayerId).length === 0) {
            await deleteDoc(ref());
          }
        }
      } else {
        await deleteDoc(ref());
      }
    } catch (e) { /* ignore */ }
  }
  sessionStorage.removeItem("wave_player_id");
  myPlayerId = null;
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

$("btn-create").addEventListener("click", showCatScreen);
($("join-input") as HTMLInputElement).addEventListener("keydown", (e) => { if (e.key === "Enter") joinRoom(); });
$("btn-join").addEventListener("click", joinRoom);
$("btn-leave").addEventListener("click", leaveRoom);
$("btn-leave-game").addEventListener("click", leaveRoom);
$("btn-end").addEventListener("click", leaveRoom);

($("qpr-input") as HTMLInputElement).addEventListener("change", async () => {
  const inp = $("qpr-input") as HTMLInputElement;
  let v = parseInt(inp.value, 10);
  if (isNaN(v)) v = DEFAULT_QUESTIONS_PER_ROUND;
  v = Math.max(1, Math.min(20, v));
  inp.value = String(v);
  if (!roomCode) return;
  try { await updateDoc(ref(), { questionsPerRound: v }); } catch (e) { alert("Failed: " + (e as Error).message); }
});

/* ---------- render ---------- */

function render() {
  if (!roomData) return;
  if (roomData.phase === "lobby") renderLobby();
  else if (roomData.phase === "summary") renderSummary();
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
    row.append(dot, document.createTextNode(`${p.name}${p.id === myPlayerId ? " (you)" : ""}`));
    list.append(row);
  });
  const n = Object.values(roomData!.players).length;
  const isHost = roomData!.host === myPlayerId;
  const start = $("btn-start") as HTMLButtonElement;
  start.hidden = !isHost;
  start.disabled = n < 2;
  start.textContent = n < 2 ? `Start game (${n}/2 players)` : "Start game";
  $("lobby-waiting").hidden = n >= 2;
  $("lobby-note").hidden = isHost || n < 2;
  const qpr = roomData!.questionsPerRound ?? DEFAULT_QUESTIONS_PER_ROUND;
  if (isHost) {
    $("qpr-wrap").hidden = false;
    $("lobby-qpr").hidden = true;
    const inp = $("qpr-input") as HTMLInputElement;
    if (document.activeElement !== inp) inp.value = String(qpr);
  } else {
    $("qpr-wrap").hidden = true;
    $("lobby-qpr").hidden = false;
    $("lobby-qpr").textContent = `Questions per round: ${qpr}`;
  }
  const cats = roomData!.categories?.length ? roomData!.categories : null;
  $("lobby-cats").textContent = cats ? `Spectra: ${cats.join(", ")}` : "Spectra: random (all categories)";
}

function renderSummary() {
  show("summary");
  const d = roomData!;
  const qpr = d.questionsPerRound ?? DEFAULT_QUESTIONS_PER_ROUND;
  const n = d.round?.n ?? 0;
  const group = Math.max(1, Math.ceil(n / qpr));
  $("summary-title").textContent = `Round ${group} complete!`;
  $("summary-round").textContent = `${qpr} questions played, +${d.roundScore ?? 0} points this round`;
  $("summary-total").textContent = `Total score: ${d.score}`;
  const isHost = d.host === myPlayerId;
  $("btn-continue").hidden = !isHost;
  $("summary-wait").hidden = isHost;
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
  const isGiver = r.giver === myPlayerId;
  const isGuesser = r.guesser === myPlayerId;
  const cluePhase = roomData!.phase === "clue";
  const guessPhase = roomData!.phase === "guess";
  const revealPhase = roomData!.phase === "reveal";

  $("game-code").textContent = roomData!.code;
  $("score").textContent = String(roomData!.score);
  $("round-num").textContent = String(r.n);
  $("round-group").textContent = String(Math.max(1, Math.ceil(r.n / (roomData!.questionsPerRound ?? DEFAULT_QUESTIONS_PER_ROUND))));
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
  const qpr = roomData!.questionsPerRound ?? DEFAULT_QUESTIONS_PER_ROUND;
  $("btn-next").textContent = r.n % qpr === 0 ? "Finish round" : "Next question";
}

$("btn-continue").addEventListener("click", async () => {
  const n = roomData?.round?.n;
  if (!n) return;
  try {
    await continueTransaction(db, ref(), n);
  } catch (err) { alert("Failed: " + (err as Error).message); }
});

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
  if (!roomData || roomData.phase !== "guess" || roomData.round?.guesser !== myPlayerId) return;
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
