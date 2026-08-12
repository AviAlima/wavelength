import { initializeApp } from "firebase/app";
import { getFirestore, initializeFirestore, doc, setDoc, updateDoc, getDoc, deleteDoc, onSnapshot, serverTimestamp, deleteField } from "firebase/firestore";
import { firebaseConfig } from "./firebase-config.js";
import { pointsFor, startGameTransaction, nextRoundTransaction, continueTransaction, startCollectiveTransaction, skipSetupTransaction, setupDoneTransaction, guessTurnTransaction, reviewNextTransaction, reviewSkipTransaction, allCluesDone, MAX_SKIPS, DEFAULT_QUESTIONS_PER_ROUND, type RoomData, type SetupItem } from "./game-logic.js";
import { CATEGORIES, SPECTRA_BY_CATEGORY } from "./spectra.js";

const VERSION = "1.13.0";
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
let draftClues: Record<string, string> = {};
let draftGuesses: Record<string, number> = {};
let setupDoneFired = false;
let guessTurnFired = false;
let lastTurn = "";
let lastSetupStart = 0;

const ref = () => doc(db, "rooms", roomCode!);
const screens: Record<string, HTMLElement> = { home: $("screen-home"), cats: $("screen-cats"), lobby: $("screen-lobby"), game: $("screen-game"), collect: $("screen-collect"), summary: $("screen-summary") };
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
      collective: true,
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
    if (roomData && roomData.setup && roomData.setup.startedAt !== lastSetupStart) {
      lastSetupStart = roomData.setup.startedAt;
      setupDoneFired = false;
      guessTurnFired = false;
      lastTurn = "";
      draftClues = {};
      draftGuesses = {};
    }
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
  draftClues = {};
  draftGuesses = {};
  setupDoneFired = false;
  guessTurnFired = false;
  lastTurn = "";
  lastSetupStart = 0;
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

const confirmLeave = () => {
  if (!roomCode) return;
  if (roomData?.phase === "lobby") {
    $("leave-confirm-text").textContent = "You'll leave the party and it will close for everyone.";
  } else {
    $("leave-confirm-text").textContent = "Your spot will be freed and the party will close for everyone.";
  }
  $("leave-confirm").hidden = false;
};
$("btn-leave").addEventListener("click", confirmLeave);
$("btn-leave-game").addEventListener("click", confirmLeave);
$("btn-end").addEventListener("click", confirmLeave);
$("btn-stay").addEventListener("click", () => { $("leave-confirm").hidden = true; });
$("btn-confirm-leave").addEventListener("click", () => {
  $("leave-confirm").hidden = true;
  leaveRoom();
});

($("qpr-input") as HTMLInputElement).addEventListener("change", async () => {
  const inp = $("qpr-input") as HTMLInputElement;
  let v = parseInt(inp.value, 10);
  if (isNaN(v)) v = DEFAULT_QUESTIONS_PER_ROUND;
  v = Math.max(1, Math.min(20, v));
  inp.value = String(v);
  if (!roomCode) return;
  try { await updateDoc(ref(), { questionsPerRound: v }); } catch (e) { alert("Failed: " + (e as Error).message); }
});

($("collective-toggle") as HTMLInputElement).addEventListener("change", async () => {
  if (!roomCode) return;
  const v = ($("collective-toggle") as HTMLInputElement).checked;
  try { await updateDoc(ref(), { collective: v }); } catch (e) { alert("Failed: " + (e as Error).message); }
});

/* ---------- render ---------- */

function render() {
  if (!roomData) return;
  if (roomData.phase === "lobby") renderLobby();
  else if (roomData.collective && roomData.phase === "setup") renderCollect();
  else if (roomData.collective && roomData.phase === "guess") renderGuess();
  else if (roomData.collective && roomData.phase === "reveal") renderReveal();
  else if (roomData.phase === "summary") renderSummary();
  else renderGame();
  if (roomData.phase === "setup" && allCluesDone(roomData) && !setupDoneFired) {
    setupDoneFired = true;
    setTimeout(() => {
      if (roomData?.phase !== "setup") { setupDoneFired = false; return; }
      setupDoneTransaction(db, ref()).then((ok) => {
        if (!ok) setupDoneFired = false;
      }).catch((err) => { setupDoneFired = false; alert("Failed to start the guessing stage: " + (err as Error).message); });
    }, 1500);
  }
  if (roomData.collective && roomData.phase === "guess" && roomData.setup) {
    const t = roomData.setup.turn;
    if (t !== lastTurn) { lastTurn = t; guessTurnFired = false; }
    if (turnTargetsDone(roomData) && revealElapsed(roomData) && !guessTurnFired) {
      guessTurnFired = true;
      guessTurnTransaction(db, ref()).then((ok) => {
        if (!ok) guessTurnFired = false;
      }).catch((err) => { guessTurnFired = false; alert("Failed to switch turn: " + (err as Error).message); });
    }
  }
}

const REVEAL_MS = 4000;

const latestAnswer = (d: RoomData): { key: string; it: SetupItem } | null => {
  const st = d.setup;
  if (!st) return null;
  let best: [string, SetupItem] | null = null;
  for (const entry of Object.entries(st.q)) {
    const it = entry[1];
    if (it.answer != null && it.answerAt && (!best || it.answerAt > best[1].answerAt!)) best = entry;
  }
  return best ? { key: best[0], it: best[1] } : null;
};

const revealElapsed = (d: RoomData): boolean => {
  const latest = latestAnswer(d);
  if (!latest) return true;
  return Date.now() - latest.it.answerAt! >= REVEAL_MS;
};

const turnTargetsDone = (d: RoomData): boolean => {
  const st = d.setup;
  if (!st || !st.turn) return false;
  const items = Object.values(st.q);
  const next = items.find((it) => it.answer == null);
  if (!next) return true;
  const pids = Object.keys(d.players);
  return st.turn !== pids.find((p) => p !== next.by)!;
};

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
  console.log("[renderLobby]", { isHost, myPlayerId: (myPlayerId ?? "null").slice(0, 4), host: (roomData!.host ?? "").slice(0, 4), wrapHidden: $("collective-wrap").hidden });
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
  const collective = roomData!.collective ?? true;
  if (isHost) {
    const t = $("collective-toggle") as HTMLInputElement;
    if (document.activeElement !== t) t.checked = collective;
    $("collective-wrap").hidden = false;
    $("lobby-collective").hidden = true;
  } else {
    $("collective-wrap").hidden = true;
    $("lobby-collective").hidden = false;
    $("lobby-collective").textContent = `Answering: ${collective ? "all spectra up front — each player sees the secret target and writes clues, then you guess each other's targets" : "one question at a time"}`;
  }
}

function renderSummary() {
  show("summary");
  const d = roomData!;
  const qpr = d.questionsPerRound ?? DEFAULT_QUESTIONS_PER_ROUND;
  const n = d.collective ? (d.setup ? Object.values(d.setup.q).length : 0) : (d.round?.n ?? 0);
  const group = d.collective ? (d.group ?? 1) : Math.max(1, Math.ceil(n / qpr));
  $("summary-title").textContent = `Round ${group} complete!`;
  $("summary-round").textContent = `${n} questions played, +${d.roundScore ?? 0} points this round`;
  $("summary-total").textContent = `Total score: ${d.score}`;
  const isHost = d.host === myPlayerId;
  $("btn-continue").hidden = !isHost;
  $("summary-wait").hidden = isHost;
}

/* ---------- game ---------- */

$("btn-start").addEventListener("click", async () => {
  if (!roomData) return;
  try {
    if (roomData.collective) await startCollectiveTransaction(db, ref());
    else await startGameTransaction(db, ref());
  } catch (err) { alert("Failed to start: " + (err as Error).message); }
});

/* ---------- collective (up front) ---------- */

function renderSkipDots(left: number) {
  const dots = $("skip-dots");
  dots.innerHTML = "";
  for (let i = 0; i < MAX_SKIPS; i++) {
    const d = document.createElement("span");
    d.className = "skip-dot" + (i < left ? "" : " used");
    dots.append(d);
  }
}

const card = () => {
  const c = document.createElement("div");
  c.className = "q-card";
  return c;
};

const specLabels = (c: HTMLElement, left: string, right: string) => {
  const labels = document.createElement("div");
  labels.className = "spec-labels";
  const l = document.createElement("span");
  l.textContent = left;
  const r = document.createElement("span");
  r.textContent = right;
  labels.append(l, r);
  c.append(labels);
};

const miniDial = (c: HTMLElement, markerClass: string, pos: number) => {
  const dial = document.createElement("div");
  dial.className = "dial";
  const bar = document.createElement("div");
  bar.className = "dial-bar";
  const m = document.createElement("div");
  m.className = "marker " + markerClass;
  m.style.left = `${pos}%`;
  bar.append(m);
  dial.append(bar);
  c.append(dial);
  return { bar, marker: m };
};

const revealDial = (c: HTMLElement, target: number, guess: number) => {
  const dial = document.createElement("div");
  dial.className = "dial";
  const bar = document.createElement("div");
  bar.className = "dial-bar";
  const g = document.createElement("div");
  g.className = "marker arrow reveal";
  g.style.left = `${guess}%`;
  const t = document.createElement("div");
  t.className = "marker target reveal";
  t.style.left = `${target}%`;
  bar.append(g, t);
  dial.append(bar);
  c.append(dial);
};

const clueBox = (c: HTMLElement, text: string) => {
  const box = document.createElement("div");
  box.className = "clue-box";
  box.textContent = `“${text}”`;
  c.append(box);
};

const mySet = (d: RoomData) => {
  const st = d.setup!;
  const entries = Object.entries(st.q);
  const mine = entries.filter(([, it]) => it.by === myPlayerId);
  const theirs = entries.filter(([, it]) => it.by !== myPlayerId);
  const partner = Object.values(d.players).find((p) => p.id !== myPlayerId);
  return { st, entries, mine, theirs, partner };
};

function renderCollect() {
  if (!roomData || !myPlayerId) return;
  const d = roomData;
  const st = d.setup;
  if (!st) return;
  show("collect");
  $("collect-code").textContent = d.code;
  $("collect-score").textContent = String(d.score);
  $("collect-round").textContent = `Round ${d.group ?? 1}`;
  $("collect-title").textContent = "Your spectra — write a clue";
  const { mine, partner } = mySet(d);
  const ps = st.byPlayer[myPlayerId!];
  const skips = ps?.skips ?? MAX_SKIPS;
  const cur = mine.findIndex(([, it]) => it.clue.trim() === "");
  $("skip-wrap").hidden = cur === -1;
  renderSkipDots(skips);
  const list = $("collect-list");
  list.innerHTML = "";
  if (cur !== -1) {
    const [key, it] = mine[cur];
    $("collect-progress").textContent = `Spectrum ${cur + 1} of ${mine.length} — write a clue`;
    const c = card();
    specLabels(c, it.left, it.right);
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = `Target: ${it.target}`;
    const p = document.createElement("p");
    p.className = "hint small-hint";
    p.append(badge, " Give a clue that lands your partner near the target:");
    c.append(p);
    miniDial(c, "target", it.target);
    const input = document.createElement("input");
    input.maxLength = 60;
    input.placeholder = "e.g. “Sunday morning”";
    input.value = draftClues[key] ?? it.clue;
    const actions = document.createElement("div");
    actions.className = "card-actions";
    const send = document.createElement("button");
    send.className = "btn primary";
    send.textContent = "Send clue";
    const syncSend = () => { send.disabled = !input.value.trim(); };
    input.addEventListener("input", () => {
      draftClues[key] = input.value;
      syncSend();
    });
    send.addEventListener("click", async () => {
      const v = input.value.trim();
      if (!v) return;
      try { await updateDoc(ref(), { [`setup.q.${key}.clue`]: v }); }
      catch (e) { alert("Failed: " + (e as Error).message); }
    });
    actions.append(send);
    const skip = document.createElement("button");
    skip.className = "btn";
    skip.textContent = "Skip";
    skip.disabled = skips <= 0;
    skip.addEventListener("click", async () => {
      try { await skipSetupTransaction(db, ref(), myPlayerId!, key); }
      catch (e) { alert("Failed: " + (e as Error).message); }
    });
    actions.append(skip);
    c.append(input, actions);
    list.append(c);
    syncSend();
  } else {
    $("collect-progress").textContent = mine.length ? "All your clues are in" : "You skipped all of yours";
  }
  const allDone = allCluesDone(d);
  $("collect-done").hidden = false;
  if (allDone) $("collect-done").textContent = "All clues are in — starting the guessing stage…";
  else if (cur === -1) $("collect-done").textContent = `Waiting for ${partner?.name ?? "the other player"} to finish their clues…`;
  else $("collect-done").hidden = true;
}

function renderGuess() {
  if (!roomData || !myPlayerId) return;
  const d = roomData;
  const st = d.setup;
  if (!st) return;
  show("collect");
  $("collect-code").textContent = d.code;
  $("collect-score").textContent = String(d.score);
  $("collect-round").textContent = `Round ${d.group ?? 1}`;
  $("skip-wrap").hidden = true;
  const list = $("collect-list");
  list.innerHTML = "";
  $("collect-done").hidden = true;
  const { entries, theirs } = mySet(d);
  const latest = latestAnswer(d);
  if (latest && Date.now() - latest.it.answerAt! < REVEAL_MS) {
    $("collect-title").textContent = "How did you do?";
    $("collect-progress").textContent = "Next question in a moment…";
    const it = latest.it;
    const c = card();
    specLabels(c, it.left, it.right);
    clueBox(c, it.clue);
    revealDial(c, it.target, it.answer ?? 50);
    const guesser = Object.keys(d.players).find((p) => p !== it.by)!;
    const who = guesser === myPlayerId ? "You" : d.players[guesser]?.name ?? "They";
    const pts = document.createElement("p");
    pts.className = "q-pts";
    const p = pointsFor(it.target, it.answer ?? 50);
    pts.textContent = `${who} guessed ${it.answer} — target was ${it.target} → +${p} pts`;
    c.append(pts);
    list.append(c);
    return;
  }
  const nextGlobal = entries.find(([, it]) => it.answer == null);
  if (!nextGlobal) {
    $("collect-title").textContent = "All guesses are in";
    $("collect-progress").textContent = "All guesses are in — opening the review…";
    return;
  }
  const guesser = Object.keys(d.players).find((p) => p !== nextGlobal[1].by)!;
  if (guesser === myPlayerId) {
    $("collect-title").textContent = "Your turn — guess the targets";
    const cur = theirs.findIndex(([, it]) => it.answer == null);
    const [key, it] = theirs[cur];
    $("collect-progress").textContent = `Guessing ${cur + 1} of ${theirs.length}`;
    const c = card();
    specLabels(c, it.left, it.right);
    clueBox(c, it.clue);
    const { bar, marker } = miniDial(c, "arrow", draftGuesses[key] ?? 50);
    const val = document.createElement("p");
    val.className = "hint";
    val.textContent = `Your guess: ${Math.round(draftGuesses[key] ?? 50)}`;
    c.append(val);
    let dragging = false;
    const move = (e: PointerEvent) => {
      const rect = bar.getBoundingClientRect();
      let x = e.clientX - rect.left;
      x = Math.max(0, Math.min(rect.width, x));
      draftGuesses[key] = (x / rect.width) * 100;
      marker.style.left = `${draftGuesses[key]}%`;
      val.textContent = `Your guess: ${Math.round(draftGuesses[key])}`;
    };
    bar.addEventListener("pointerdown", (e) => { dragging = true; bar.setPointerCapture(e.pointerId); move(e); });
    bar.addEventListener("pointermove", (e) => { if (dragging) move(e); });
    bar.addEventListener("pointerup", () => { dragging = false; });
    bar.addEventListener("pointercancel", () => { dragging = false; });
    const actions = document.createElement("div");
    actions.className = "card-actions";
    const lock = document.createElement("button");
    lock.className = "btn primary";
    lock.textContent = "Lock guess";
    lock.addEventListener("click", async () => {
      try { await updateDoc(ref(), { [`setup.q.${key}.answer`]: Math.round(draftGuesses[key] ?? 50), [`setup.q.${key}.answerAt`]: Date.now() }); }
      catch (e) { alert("Failed: " + (e as Error).message); }
    });
    actions.append(lock);
    c.append(actions);
    list.append(c);
  } else {
    $("collect-title").textContent = `Waiting for ${d.players[guesser]?.name ?? "the other player"}…`;
    $("collect-progress").textContent = "";
    const c = card();
    c.classList.add("waiting-card");
    const title = document.createElement("p");
    title.className = "hint";
    title.id = "waiting-title";
    title.textContent = `${d.players[guesser]?.name ?? "The other player"} is answering…`;
    c.append(title);
    const dots = document.createElement("div");
    dots.className = "waiting-dots";
    dots.append(document.createElement("span"), document.createElement("span"), document.createElement("span"));
    c.append(dots);
    const it = nextGlobal[1];
    specLabels(c, it.left, it.right);
    clueBox(c, it.clue);
    const hint = document.createElement("p");
    hint.className = "hint small-hint";
    hint.textContent = "Your turn comes right after.";
    c.append(hint);
    list.append(c);
  }
}

function renderReveal() {
  if (!roomData || !myPlayerId) return;
  const d = roomData;
  const st = d.setup;
  if (!st) return;
  show("collect");
  $("collect-code").textContent = d.code;
  $("collect-score").textContent = String(d.score);
  $("collect-round").textContent = `Round ${d.group ?? 1}`;
  $("collect-title").textContent = "Review — how close were you?";
  $("skip-wrap").hidden = true;
  const entries = Object.entries(st.q);
  const count = entries.length;
  const idx = Math.min(st.reviewIdx ?? 0, Math.max(0, count - 1));
  $("collect-progress").textContent = count ? `Review ${idx + 1} of ${count}` : "No questions this round";
  const list = $("collect-list");
  list.innerHTML = "";
  const c = card();
  if (count) {
    const [, it] = entries[idx];
    specLabels(c, it.left, it.right);
    clueBox(c, it.clue);
    revealDial(c, it.target, it.answer ?? 50);
    const pts = document.createElement("p");
    pts.className = "q-pts";
    const p = pointsFor(it.target, it.answer ?? 50);
    pts.textContent = `Target ${it.target} vs guess ${it.answer ?? "—"} — off by ${Math.abs(it.target - (it.answer ?? 50))} → +${p} pts`;
    c.append(pts);
  }
  if (d.host === myPlayerId) {
    const actions = document.createElement("div");
    actions.className = "card-actions";
    const next = document.createElement("button");
    next.className = "btn primary";
    next.textContent = count ? (idx + 1 >= count ? "Finish review" : "Next") : "See results";
    next.addEventListener("click", async () => {
      try { await reviewNextTransaction(db, ref(), myPlayerId!); }
      catch (e) { alert("Failed: " + (e as Error).message); }
    });
    actions.append(next);
    if (count) {
      const skip = document.createElement("button");
      skip.className = "btn";
      skip.textContent = "Skip review";
      skip.addEventListener("click", async () => {
        try { await reviewSkipTransaction(db, ref(), myPlayerId!); }
        catch (e) { alert("Failed: " + (e as Error).message); }
      });
      actions.append(skip);
    }
    c.append(actions);
  } else {
    const hint = document.createElement("p");
    hint.className = "hint small-hint";
    hint.textContent = "The host is driving the review.";
    c.append(hint);
  }
  list.append(c);
  $("collect-done").hidden = true;
}

$("btn-leave-collect").addEventListener("click", confirmLeave);

function renderGame() {
  show("game");
  const r = roomData!.round;
  if (!r) return;
  const d = roomData!;
  const isGiver = r.giver === myPlayerId;
  const isGuesser = r.guesser === myPlayerId;
  const cluePhase = d.phase === "clue";
  const guessPhase = d.phase === "guess";
  const revealPhase = d.phase === "reveal";

  $("game-code").textContent = d.code;
  $("score").textContent = String(d.score);
  $("round-num").textContent = String(r.n);
  $("round-group").textContent = String(Math.max(1, Math.ceil(r.n / (d.questionsPerRound ?? DEFAULT_QUESTIONS_PER_ROUND))));
  $("round-info").textContent = `${d.players[r.giver].name} gives the clue${isGiver ? " — that's you" : ""}`;
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
    $("reveal-clue-line").hidden = !r.clue;
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
  $("btn-next").textContent = (r.n % (d.questionsPerRound ?? DEFAULT_QUESTIONS_PER_ROUND) === 0) ? "Finish round" : "Next question";
}

$("btn-continue").addEventListener("click", async () => {
  const d = roomData;
  if (!d) return;
  const n = d.round?.n ?? (d.collective ? 0 : null);
  if (n == null) return;
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

setInterval(() => {
  if (!roomData) return;
  if (roomData.phase === "reveal" || (roomData.collective && roomData.phase === "guess")) render();
}, 300);

show("home");
