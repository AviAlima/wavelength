import { initializeApp } from "firebase/app";
import { getFirestore, initializeFirestore, doc, setDoc, updateDoc, getDoc, deleteDoc, onSnapshot, serverTimestamp, deleteField } from "firebase/firestore";
import { firebaseConfig } from "./firebase-config.js";
import { pointsFor, startGameTransaction, nextRoundTransaction, continueTransaction, startCollectiveTransaction, skipSetupTransaction, setupDoneTransaction, nextCollectiveTransaction, allSetupDone, setupQList, MAX_SKIPS, DEFAULT_QUESTIONS_PER_ROUND, type RoomData } from "./game-logic.js";
import { CATEGORIES, SPECTRA_BY_CATEGORY } from "./spectra.js";

const VERSION = "1.6.0";
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
let draftCollect = 50;
let collectIdx: string | null = null;
let setupDoneFired = false;
let lastSetupStart = 0;
let collectTimer: ReturnType<typeof setInterval> | null = null;

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
  draftCollect = 50;
  collectIdx = null;
  setupDoneFired = false;
  lastSetupStart = 0;
  if (collectTimer) { clearInterval(collectTimer); collectTimer = null; }
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

($("collective-toggle") as HTMLInputElement).addEventListener("change", async () => {
  if (!roomCode) return;
  const v = ($("collective-toggle") as HTMLInputElement).checked;
  try { await updateDoc(ref(), { collective: v }); } catch (e) { alert("Failed: " + (e as Error).message); }
});

/* ---------- render ---------- */

function render() {
  if (!roomData) return;
  if (roomData.phase === "lobby") renderLobby();
  else if (roomData.phase === "setup") renderCollect();
  else if (roomData.phase === "summary") renderSummary();
  else renderGame();
  if (roomData.phase === "setup" && allSetupDone(roomData) && !setupDoneFired) {
    setupDoneFired = true;
    setTimeout(() => {
      if (roomData?.phase !== "setup") { setupDoneFired = false; return; }
      setupDoneTransaction(db, ref()).then((round) => {
        if (!round) setupDoneFired = false;
      }).catch((err) => { setupDoneFired = false; alert("Failed to start the reveal: " + (err as Error).message); });
    }, 1500);
  }
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
    $("lobby-collective").textContent = `Answering: ${collective ? "together up front (both pre-position their dial, then results play back)" : "one question at a time"}`;
  }
}

function renderSummary() {
  show("summary");
  const d = roomData!;
  const qpr = d.questionsPerRound ?? DEFAULT_QUESTIONS_PER_ROUND;
  const n = d.round?.n ?? 0;
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

/* ---------- collect (up-front answering) ---------- */

const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

function mySetupList(d: RoomData) {
  const st = d.setup!;
  const mine = Object.entries(st.q).filter(([, it]) => it.by === myPlayerId).map(([k, it]) => ({ it, i: k }));
  const ps = st.byPlayer[myPlayerId!] ?? { cur: 0, skips: 2, total: mine.length };
  return { st, mine, ps };
}

function renderSkipDots(left: number) {
  const dots = $("skip-dots");
  dots.innerHTML = "";
  for (let i = 0; i < 2; i++) {
    const d = document.createElement("span");
    d.className = "skip-dot" + (i < left ? "" : " used");
    dots.append(d);
  }
}

function renderCollect() {
  if (!roomData || !myPlayerId) return;
  const d = roomData;
  const st = d.setup;
  if (!st) return;
  show("collect");
  $("collect-code").textContent = d.code;
  $("collect-score").textContent = String(d.score);
  $("collect-round").textContent = `Round ${d.group ?? 1}`;
  const { mine, ps } = mySetupList(d);
  const done = ps.cur >= mine.length;
  const partner = Object.values(d.players).find((p) => p.id !== myPlayerId);
  const partnerN = setupQList(st.q).filter((it) => it.by === partner?.id).length;
  const partnerDone = partner ? (st.byPlayer[partner.id]?.cur ?? 0) >= partnerN : true;
  if (done) {
    renderSkipDots(ps.skips);
    ($("btn-skip") as HTMLButtonElement).disabled = true;
    $("collect-question").hidden = true;
    $("collect-done").hidden = false;
    $("collect-done").textContent = allSetupDone(d)
      ? "Everyone is done — starting the reveal…"
      : `You're done — waiting for ${partner?.name ?? "the other player"} to finish…`;
    return;
  }
  $("collect-question").hidden = false;
  $("collect-done").hidden = true;
  const cur = mine[ps.cur];
  $("collect-queue").textContent = `Question ${ps.cur + (MAX_SKIPS - ps.skips) + 1} of ${ps.total ?? mine.length} — your turn`;
  $("collect-spec-left").textContent = cur.it.left;
  $("collect-spec-right").textContent = cur.it.right;
  if (collectIdx !== cur.i) {
    collectIdx = cur.i;
    draftCollect = 50;
  }
  setPos($("collect-marker"), draftCollect);
  $("collect-value").textContent = String(Math.round(draftCollect));
  const budget = 30 * mine.length;
  const remain = Math.max(0, Math.ceil(budget - (Date.now() - (st.startedAt ?? Date.now())) / 1000));
  $("collect-timer").textContent = `⏱ ${fmtTime(remain)} left (30s per question, cumulative)`;
  ($("btn-skip") as HTMLButtonElement).disabled = ps.skips <= 0;
  renderSkipDots(ps.skips);
}

async function submitCollect() {
  const d = roomData;
  if (!d || !myPlayerId || d.phase !== "setup") return;
  const { mine, ps } = mySetupList(d);
  if (ps.cur >= mine.length) return;
  const idx = mine[ps.cur].i;
  try {
    await updateDoc(ref(), {
      [`setup.q.${idx}.answer`]: Math.round(draftCollect),
      [`setup.byPlayer.${myPlayerId}.cur`]: ps.cur + 1,
    });
  } catch (e) { alert("Failed: " + (e as Error).message); }
}

$("btn-answer").addEventListener("click", submitCollect);
$("btn-skip").addEventListener("click", async () => {
  if (!roomCode || !myPlayerId) return;
  try { await skipSetupTransaction(db, ref(), myPlayerId); }
  catch (e) { alert("Failed: " + (e as Error).message); }
});
$("btn-leave-collect").addEventListener("click", leaveRoom);

collectTimer = setInterval(() => {
  const d = roomData;
  if (!d || d.phase !== "setup" || !d.setup || !myPlayerId) return;
  const { mine, ps } = mySetupList(d);
  if (ps.cur >= mine.length) return;
  const budget = 30 * mine.length;
  const remain = budget - (Date.now() - d.setup.startedAt) / 1000;
  if (remain <= 0) submitCollect();
  else renderCollect();
}, 500);

function renderGame() {
  show("game");
  const r = roomData!.round;
  if (!r) return;
  const d = roomData!;
  const collective = !!d.collective;
  const isGiver = r.giver === myPlayerId;
  const isGuesser = r.guesser === myPlayerId;
  const cluePhase = d.phase === "clue";
  const guessPhase = d.phase === "guess";
  const revealPhase = d.phase === "reveal";

  $("game-code").textContent = d.code;
  $("score").textContent = String(d.score);
  $("round-num").textContent = String(r.n);
  $("round-group").textContent = String(collective ? (d.group ?? 1) : Math.max(1, Math.ceil(r.n / (d.questionsPerRound ?? DEFAULT_QUESTIONS_PER_ROUND))));
  $("round-info").textContent = collective
    ? `${d.players[r.giver].name} placed the marker${r.giver === myPlayerId ? " — that's you" : ""}`
    : `${d.players[r.giver].name} gives the clue${isGiver ? " — that's you" : ""}`;
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
    $("reveal-delta").textContent = collective
      ? `${d.players[r.giver].name} placed it at ${r.guess} — the game drew ${r.target}, off by ${Math.abs(r.target - r.guess)}`
      : `Target ${r.target} vs guess ${r.guess} — off by ${Math.abs(r.target - r.guess)}`;
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
  const qpr = d.questionsPerRound ?? DEFAULT_QUESTIONS_PER_ROUND;
  $("btn-next").textContent = (collective ? r.n >= (d.setup ? setupQList(d.setup.q).length : qpr) : r.n % qpr === 0) ? "Finish round" : "Next question";
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
    if (roomData?.collective) await nextCollectiveTransaction(db, ref(), n);
    else await nextRoundTransaction(db, ref(), n);
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

const collectBar = $("collect-bar");
let collectDragging = false;
const moveCollect = (e: PointerEvent) => {
  const d = roomData;
  if (!d || !myPlayerId || d.phase !== "setup" || !d.setup) return;
  const { mine, ps } = mySetupList(d);
  if (ps.cur >= mine.length || mine[ps.cur].it.by !== myPlayerId) return;
  const rect = collectBar.getBoundingClientRect();
  let x = e.clientX - rect.left;
  x = Math.max(0, Math.min(rect.width, x));
  draftCollect = (x / rect.width) * 100;
  setPos($("collect-marker"), draftCollect);
  $("collect-value").textContent = String(Math.round(draftCollect));
};
collectBar.addEventListener("pointerdown", (e) => {
  collectDragging = true;
  collectBar.setPointerCapture(e.pointerId);
  moveCollect(e);
});
collectBar.addEventListener("pointermove", (e) => { if (collectDragging) moveCollect(e); });
collectBar.addEventListener("pointerup", () => { collectDragging = false; });
collectBar.addEventListener("pointercancel", () => { collectDragging = false; });

show("home");
