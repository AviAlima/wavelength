import { initializeApp } from "firebase/app";
import { getFirestore, initializeFirestore, doc, setDoc, updateDoc, getDoc, deleteDoc, onSnapshot, serverTimestamp, deleteField } from "firebase/firestore";
import { firebaseConfig } from "./firebase-config.js";
import { pointsFor, startGameTransaction, nextRoundTransaction, continueTransaction, startCollectiveTransaction, skipSetupTransaction, setupDoneTransaction, guessTurnTransaction, reviewNextTransaction, reviewSkipTransaction, allCluesDone, setupQList, MAX_SKIPS, DEFAULT_QUESTIONS_PER_ROUND, type RoomData, type SetupItem } from "./game-logic.js";
import { CATEGORIES, SPECTRA_BY_CATEGORY, CATEGORY_HE } from "./spectra.js";
import { getLang, setLang, t, langLabel, applyStaticLang } from "./i18n.js";

const VERSION = "1.17.0";
document.getElementById("version")!.textContent = VERSION;

applyStaticLang();

const app = initializeApp(firebaseConfig);
const db = initializeFirestore(app, { experimentalForceLongPolling: true });

const $ = (id: string): HTMLElement => document.getElementById(id)!;

const langBtn = (id: string) => $(id) as HTMLButtonElement;
const syncLangBtns = () => {
  langBtn("lang-he").classList.toggle("active", getLang() === "he");
  langBtn("lang-en").classList.toggle("active", getLang() === "en");
};
syncLangBtns();
langBtn("lang-he").addEventListener("click", () => { setLang("he"); afterLangChange(); });
langBtn("lang-en").addEventListener("click", () => { setLang("en"); afterLangChange(); });

const afterLangChange = () => {
  applyStaticLang();
  syncLangBtns();
  if (catListBuilt) buildCatList();
  if (roomData) render();
};

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

const catLabel = (c: string): string => (getLang() === "he" ? CATEGORY_HE[c] ?? c : c);

let catListBuilt = false;

function buildCatList() {
  const list = $("cat-list");
  list.innerHTML = "";
  CATEGORIES.forEach((c) => {
    const n = SPECTRA_BY_CATEGORY[c].length;
    const label = document.createElement("label");
    label.className = "cat-option";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.value = c;
    cb.checked = true;
    label.append(cb, document.createTextNode(`${catLabel(c)} (${n})`));
    list.append(label);
  });
}

function showCatScreen() {
  if (!requireName()) return;
  show("cats");
  if (catListBuilt) return;
  catListBuilt = true;
  buildCatList();
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
    alert(t("Could not create room. Did you paste your Firebase config in src/firebase-config.ts? ", "לא הצלחנו ליצור חדר. הדבקתם את קונפיג הפיירבייס ב-src/firebase-config.ts? ") + (err as Error).message);
  }
}

async function joinRoom() {
  if (!requireName()) return;
  const code = ($("join-input") as HTMLInputElement).value.trim().toUpperCase();
  if (!code) return;
  try {
    const snap = await getDoc(doc(db, "rooms", code));
    if (!snap.exists()) { alert(t("Room not found", "החדר לא נמצא")); return; }
    const data = snap.data() as RoomData;
    const pids = Object.keys(data.players);
    if (data.phase !== "lobby") {
      if (myPlayerId && pids.includes(myPlayerId)) { openRoom(code); return; }
      alert(t("The game already started", "המשחק כבר התחיל"));
      return;
    }
    if (myPlayerId && pids.includes(myPlayerId)) {
      openRoom(code);
      return;
    }
    if (pids.length >= 2) { alert(t("Room is full", "החדר מלא")); return; }
    const id = freshId();
    sessionStorage.setItem("wave_player_id", id);
    myPlayerId = id;
    await updateDoc(doc(db, "rooms", code), {
      [`players.${id}`]: { id, name: myName(), color: COLORS[pids.length] },
    });
    openRoom(code);
  } catch (err) { alert(t("Could not join: ", "לא הצלחנו להצטרף: ") + (err as Error).message); }
}

function openRoom(code: string) {
  roomCode = code;
  if (unsub) unsub();
  unsub = onSnapshot(doc(db, "rooms", code), { includeMetadataChanges: true }, (snap) => {
    if (!snap.exists()) {
      alert(t("The party was closed by the other player", "המשחק נסגר על ידי השחקן השני"));
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
  catch { prompt(t("Party code:", "קוד משחק:"), roomData.code); }
});

$("btn-create").addEventListener("click", showCatScreen);
($("join-input") as HTMLInputElement).addEventListener("keydown", (e) => { if (e.key === "Enter") joinRoom(); });
$("btn-join").addEventListener("click", joinRoom);

const confirmLeave = () => {
  if (!roomCode) return;
  if (roomData?.phase === "lobby") {
    $("leave-confirm-text").textContent = t("You'll leave the party and it will close for everyone.", "אם תעזוב המשחק ייסגר לכולם.");
  } else {
    $("leave-confirm-text").textContent = t("Your spot will be freed and the party will close for everyone.", "המקום שלך יתפנה והמשחק ייסגר לכולם.");
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
  try { await updateDoc(ref(), { questionsPerRound: v }); } catch (e) { alert(t("Failed: ", "שגיאה: ") + (e as Error).message); }
});

($("collective-toggle") as HTMLInputElement).addEventListener("change", async () => {
  if (!roomCode) return;
  const v = ($("collective-toggle") as HTMLInputElement).checked;
  try { await updateDoc(ref(), { collective: v }); } catch (e) { alert(t("Failed: ", "שגיאה: ") + (e as Error).message); }
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
      }).catch((err) => { setupDoneFired = false; alert(t("Failed to start the guessing stage: ", "שגיאה בשלב הניחושים: ") + (err as Error).message); });
    }, 1500);
  }
  if (roomData.collective && roomData.phase === "guess" && roomData.setup) {
    const turn = roomData.setup.turn;
    if (turn !== lastTurn) { lastTurn = turn; guessTurnFired = false; }
    if (turnTargetsDone(roomData) && revealElapsed(roomData) && !guessTurnFired) {
      guessTurnFired = true;
      guessTurnTransaction(db, ref()).then((ok) => {
        if (!ok) guessTurnFired = false;
      }).catch((err) => { guessTurnFired = false; alert(t("Failed to switch turn: ", "שגיאה במעבר תור: ") + (err as Error).message); });
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
    row.append(dot, document.createTextNode(`${p.name}${p.id === myPlayerId ? t(" (you)", " (אתה)") : ""}`));
    list.append(row);
  });
  const n = Object.values(roomData!.players).length;
  const isHost = roomData!.host === myPlayerId;
  console.log("[renderLobby]", { isHost, myPlayerId: (myPlayerId ?? "null").slice(0, 4), host: (roomData!.host ?? "").slice(0, 4), wrapHidden: $("collective-wrap").hidden });
  const start = $("btn-start") as HTMLButtonElement;
  start.hidden = !isHost;
  start.disabled = n < 2;
  start.textContent = n < 2 ? t(`Start game (${n}/2 players)`, `התחל משחק (${n}/2 שחקנים)`) : t("Start game", "התחל משחק");
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
    $("lobby-qpr").textContent = t(`Questions per round: ${qpr}`, `שאלות בסיבוב: ${qpr}`);
  }
  const cats = roomData!.categories?.length ? roomData!.categories : null;
  $("lobby-cats").textContent = cats
    ? t(`Spectra: ${cats.join(", ")}`, `ספקטרומים: ${cats.map(catLabel).join(", ")}`)
    : t("Spectra: random (all categories)", "ספקטרומים: אקראי (כל הקטגוריות)");
  const collective = roomData!.collective ?? true;
  if (isHost) {
    const toggle = $("collective-toggle") as HTMLInputElement;
    if (document.activeElement !== toggle) toggle.checked = collective;
    $("collective-wrap").hidden = false;
    $("lobby-collective").hidden = true;
  } else {
    $("collective-wrap").hidden = true;
    $("lobby-collective").hidden = false;
    $("lobby-collective").textContent = collective
      ? t("Answering: all spectra up front — each player sees the secret target and writes clues, then you guess each other's targets", "מענה: כל הספקטרומים מראש — כל שחקן רואה את המטרה הסודית וכותב רמזים, ואז מנחשים זה את המטרות של זה")
      : t("Answering: one question at a time", "מענה: שאלה אחת בכל פעם");
  }
}

function renderSummary() {
  show("summary");
  const d = roomData!;
  const qpr = d.questionsPerRound ?? DEFAULT_QUESTIONS_PER_ROUND;
  const n = d.collective ? (d.setup ? Object.values(d.setup.q).length : 0) : (d.round?.n ?? 0);
  const group = d.collective ? (d.group ?? 1) : Math.max(1, Math.ceil(n / qpr));
  $("summary-title").textContent = t(`Round ${group} complete!`, `סיבוב ${group} הסתיים!`);
  $("summary-round").textContent = t(`${n} questions played, +${d.roundScore ?? 0} points this round`, `${n} שאלות הושלמו, +${d.roundScore ?? 0} נקודות בסיבוב הזה`);
  $("summary-total").textContent = t(`Total score: ${d.score}`, `ניקוד כולל: ${d.score}`);
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
  } catch (err) { alert(t("Failed to start: ", "שגיאה בהתחלה: ") + (err as Error).message); }
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

const specLabels = (c: HTMLElement, left: string, right: string, leftHe?: string, rightHe?: string) => {
  const labels = document.createElement("div");
  labels.className = "spec-labels";
  const l = document.createElement("span");
  l.textContent = langLabel(left, leftHe);
  const r = document.createElement("span");
  r.textContent = langLabel(right, rightHe);
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

const chipScore = (d: RoomData): string => {
  const banked = d.score;
  if (d.setup && setupQList(d.setup.q).length > 0) {
    const pending = setupQList(d.setup.q).reduce(
      (s, it) => (it.answer != null ? s + pointsFor(it.target, it.answer) : s),
      0,
    );
    return pending > 0 ? `${banked} (+${pending})` : String(banked);
  }
  if (d.round && d.round.guess != null) {
    const p = pointsFor(d.round.target, d.round.guess);
    return p > 0 ? `${banked} (+${p})` : String(banked);
  }
  return String(banked);
};

function renderCollect() {
  if (!roomData || !myPlayerId) return;
  const d = roomData;
  const st = d.setup;
  if (!st) return;
  show("collect");
  $("collect-code").textContent = d.code;
  $("collect-score").textContent = chipScore(d);
  $("collect-round").textContent = t(`Round ${d.group ?? 1}`, `סיבוב ${d.group ?? 1}`);
  $("collect-title").textContent = t("Your spectra — write a clue", "הספקטרומים שלך — כתבו רמז");
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
    $("collect-progress").textContent = t(`Spectrum ${cur + 1} of ${mine.length} — write a clue`, `ספקטרום ${cur + 1} מתוך ${mine.length} — כתבו רמז`);
    const c = card();
    specLabels(c, it.left, it.right, it.leftHe, it.rightHe);
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = t(`Target: ${it.target}`, `מטרה: ${it.target}`);
    const p = document.createElement("p");
    p.className = "hint small-hint";
    p.append(badge, t(" Give a clue that lands your partner near the target:", " תנו רמז שינחית את השותף ליד המטרה:"));
    c.append(p);
    miniDial(c, "target", it.target);
    const input = document.createElement("input");
    input.maxLength = 60;
    input.placeholder = t("e.g. “Sunday morning”", "למשל: “בוקר של יום ראשון”");
    input.value = draftClues[key] ?? it.clue;
    const actions = document.createElement("div");
    actions.className = "card-actions";
    const send = document.createElement("button");
    send.className = "btn primary";
    send.textContent = t("Send clue", "שלחו רמז");
    const syncSend = () => { send.disabled = !input.value.trim(); };
    input.addEventListener("input", () => {
      draftClues[key] = input.value;
      syncSend();
    });
    send.addEventListener("click", async () => {
      const v = input.value.trim();
      if (!v) return;
      try { await updateDoc(ref(), { [`setup.q.${key}.clue`]: v }); }
      catch (e) { alert(t("Failed: ", "שגיאה: ") + (e as Error).message); }
    });
    actions.append(send);
    const skip = document.createElement("button");
    skip.className = "btn";
    skip.textContent = t("Skip", "דלג");
    skip.disabled = skips <= 0;
    skip.addEventListener("click", async () => {
      try { await skipSetupTransaction(db, ref(), myPlayerId!, key); }
      catch (e) { alert(t("Failed: ", "שגיאה: ") + (e as Error).message); }
    });
    actions.append(skip);
    c.append(input, actions);
    list.append(c);
    syncSend();
  } else {
    $("collect-progress").textContent = mine.length ? t("All your clues are in", "כל הרמזים שלך בפנים") : t("You skipped all of yours", "דילגת על כל הספקטרומים שלך");
  }
  const allDone = allCluesDone(d);
  $("collect-done").hidden = false;
  if (allDone) $("collect-done").textContent = t("All clues are in — starting the guessing stage…", "כל הרמזים בפנים — מתחילים בשלב הניחושים…");
  else if (cur === -1) $("collect-done").textContent = t(`Waiting for ${partner?.name ?? "the other player"} to finish their clues…`, `מחכים ש${partner?.name ?? "השחקן השני"} יסיים את הרמזים…`);
  else $("collect-done").hidden = true;
}

function renderGuess() {
  if (!roomData || !myPlayerId) return;
  const d = roomData;
  const st = d.setup;
  if (!st) return;
  show("collect");
  $("collect-code").textContent = d.code;
  $("collect-score").textContent = chipScore(d);
  $("collect-round").textContent = t(`Round ${d.group ?? 1}`, `סיבוב ${d.group ?? 1}`);
  $("skip-wrap").hidden = true;
  if (dragging) return;
  const list = $("collect-list");
  list.innerHTML = "";
  $("collect-done").hidden = true;
  const { entries, theirs } = mySet(d);
  const latest = latestAnswer(d);
  if (latest && Date.now() - latest.it.answerAt! < REVEAL_MS) {
    $("collect-title").textContent = t("How did you do?", "איך יצא לך?");
    $("collect-progress").textContent = t("Next question in a moment…", "השאלה הבאה עוד רגע…");
    const it = latest.it;
    const c = card();
    specLabels(c, it.left, it.right, it.leftHe, it.rightHe);
    clueBox(c, it.clue);
    revealDial(c, it.target, it.answer ?? 50);
    const guesser = Object.keys(d.players).find((p) => p !== it.by)!;
    const who = guesser === myPlayerId ? t("You", "אתה") : d.players[guesser]?.name ?? t("They", "השני");
    const pts = document.createElement("p");
    pts.className = "q-pts";
    const p = pointsFor(it.target, it.answer ?? 50);
    pts.textContent = t(`${who} guessed ${it.answer} — target was ${it.target} → +${p} pts`, `${who} ניחש ${it.answer} — המטרה הייתה ${it.target} → +${p} נקודות`);
    c.append(pts);
    list.append(c);
    return;
  }
  const nextGlobal = entries.find(([, it]) => it.answer == null);
  if (!nextGlobal) {
    $("collect-title").textContent = t("All guesses are in", "כל הניחושים בפנים");
    $("collect-progress").textContent = t("All guesses are in — opening the review…", "כל הניחושים בפנים — פותחים את הסיכום…");
    return;
  }
  const guesser = Object.keys(d.players).find((p) => p !== nextGlobal[1].by)!;
  if (guesser === myPlayerId) {
    $("collect-title").textContent = t("Your turn — guess the targets", "התור שלך — נחשו את המטרות");
    const cur = theirs.findIndex(([, it]) => it.answer == null);
    const [key, it] = theirs[cur];
    $("collect-progress").textContent = t(`Guessing ${cur + 1} of ${theirs.length}`, `מנחש ${cur + 1} מתוך ${theirs.length}`);
    const c = card();
    specLabels(c, it.left, it.right, it.leftHe, it.rightHe);
    clueBox(c, it.clue);
    const { bar, marker } = miniDial(c, "arrow", draftGuesses[key] ?? 50);
    const val = document.createElement("p");
    val.className = "hint";
    val.textContent = t(`Your guess: ${Math.round(draftGuesses[key] ?? 50)}`, `הניחוש שלך: ${Math.round(draftGuesses[key] ?? 50)}`);
    c.append(val);
    const move = (e: PointerEvent) => {
      const rect = bar.getBoundingClientRect();
      let x = e.clientX - rect.left;
      x = Math.max(0, Math.min(rect.width, x));
      draftGuesses[key] = (x / rect.width) * 100;
      marker.style.left = `${draftGuesses[key]}%`;
      val.textContent = t(`Your guess: ${Math.round(draftGuesses[key])}`, `הניחוש שלך: ${Math.round(draftGuesses[key])}`);
    };
    bar.addEventListener("pointerdown", (e) => { dragging = true; bar.setPointerCapture(e.pointerId); move(e); });
    bar.addEventListener("pointermove", (e) => { if (dragging) move(e); });
    bar.addEventListener("pointerup", () => { dragging = false; render(); });
    bar.addEventListener("pointercancel", () => { dragging = false; render(); });
    const actions = document.createElement("div");
    actions.className = "card-actions";
    const lock = document.createElement("button");
    lock.className = "btn primary";
    lock.textContent = t("Lock guess", "נעילת ניחוש");
    lock.addEventListener("click", async () => {
      try { await updateDoc(ref(), { [`setup.q.${key}.answer`]: Math.round(draftGuesses[key] ?? 50), [`setup.q.${key}.answerAt`]: Date.now() }); }
      catch (e) { alert(t("Failed: ", "שגיאה: ") + (e as Error).message); }
    });
    actions.append(lock);
    c.append(actions);
    list.append(c);
  } else {
    $("collect-title").textContent = t(`Waiting for ${d.players[guesser]?.name ?? "the other player"}…`, `מחכים ל${d.players[guesser]?.name ?? "השחקן השני"}…`);
    $("collect-progress").textContent = "";
    const c = card();
    c.classList.add("waiting-card");
    const title = document.createElement("p");
    title.className = "hint";
    title.id = "waiting-title";
    title.textContent = t(`${d.players[guesser]?.name ?? "The other player"} is answering…`, `${d.players[guesser]?.name ?? "השחקן השני"} עונה…`);
    c.append(title);
    const dots = document.createElement("div");
    dots.className = "waiting-dots";
    dots.append(document.createElement("span"), document.createElement("span"), document.createElement("span"));
    c.append(dots);
    const it = nextGlobal[1];
    specLabels(c, it.left, it.right, it.leftHe, it.rightHe);
    clueBox(c, it.clue);
    const hint = document.createElement("p");
    hint.className = "hint small-hint";
    hint.textContent = t("Your turn comes right after.", "התור שלך מיד אחרי.");
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
  $("collect-score").textContent = chipScore(d);
  $("collect-round").textContent = t(`Round ${d.group ?? 1}`, `סיבוב ${d.group ?? 1}`);
  $("collect-title").textContent = t("Review — how close were you?", "סיכום — כמה קרובים הייתם?");
  $("skip-wrap").hidden = true;
  const entries = Object.entries(st.q);
  const count = entries.length;
  const idx = Math.min(st.reviewIdx ?? 0, Math.max(0, count - 1));
  $("collect-progress").textContent = count ? t(`Review ${idx + 1} of ${count}`, `סיכום ${idx + 1} מתוך ${count}`) : t("No questions this round", "אין שאלות בסיבוב הזה");
  const list = $("collect-list");
  list.innerHTML = "";
  const c = card();
  if (count) {
    const [, it] = entries[idx];
    specLabels(c, it.left, it.right, it.leftHe, it.rightHe);
    clueBox(c, it.clue);
    revealDial(c, it.target, it.answer ?? 50);
    const pts = document.createElement("p");
    pts.className = "q-pts";
    const p = pointsFor(it.target, it.answer ?? 50);
    pts.textContent = t(`Target ${it.target} vs guess ${it.answer ?? "—"} — off by ${Math.abs(it.target - (it.answer ?? 50))} → +${p} pts`, `מטרה ${it.target} לעומת ניחוש ${it.answer ?? "—"} — במרחק ${Math.abs(it.target - (it.answer ?? 50))} → +${p} נקודות`);
    c.append(pts);
  }
  if (d.host === myPlayerId) {
    const actions = document.createElement("div");
    actions.className = "card-actions";
    const next = document.createElement("button");
    next.className = "btn primary";
    next.textContent = count ? (idx + 1 >= count ? t("Finish review", "סיום סיכום") : t("Next", "הבא")) : t("See results", "הצגת תוצאות");
    next.addEventListener("click", async () => {
      try { await reviewNextTransaction(db, ref(), myPlayerId!); }
      catch (e) { alert(t("Failed: ", "שגיאה: ") + (e as Error).message); }
    });
    actions.append(next);
    if (count) {
      const skip = document.createElement("button");
      skip.className = "btn";
      skip.textContent = t("Skip review", "דילוג על הסיכום");
      skip.addEventListener("click", async () => {
        try { await reviewSkipTransaction(db, ref(), myPlayerId!); }
        catch (e) { alert(t("Failed: ", "שגיאה: ") + (e as Error).message); }
      });
      actions.append(skip);
    }
    c.append(actions);
  } else {
    const hint = document.createElement("p");
    hint.className = "hint small-hint";
    hint.textContent = t("The host is driving the review.", "המארח מוביל את הסיכום.");
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
  $("score").textContent = chipScore(d);
  $("round-num").textContent = String(r.n);
  $("round-group").textContent = String(Math.max(1, Math.ceil(r.n / (d.questionsPerRound ?? DEFAULT_QUESTIONS_PER_ROUND))));
  $("round-info").textContent = t(`${d.players[r.giver].name} gives the clue${isGiver ? " — that's you" : ""}`, `${d.players[r.giver].name} נותן רמז${isGiver ? " — זה אתה" : ""}`);
  $("spec-left").textContent = langLabel(r.left, r.leftHe);
  $("spec-right").textContent = langLabel(r.right, r.rightHe);

  $("clue-box").hidden = !r.clue;
  $("clue-text").textContent = r.clue;

  /* markers */
  $("target-marker").hidden = !isGiver || revealPhase;
  if (isGiver && !revealPhase) {
    setPos($("target-marker"), r.target);
    $("target-badge").textContent = t(`Target: ${r.target}`, `מטרה: ${r.target}`);
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
    $("reveal-delta").textContent = t(`Target ${r.target} vs guess ${r.guess} — off by ${Math.abs(r.target - r.guess)}`, `מטרה ${r.target} לעומת ניחוש ${r.guess} — במרחק ${Math.abs(r.target - r.guess)}`);
    const pts = pointsFor(r.target, r.guess);
    $("reveal-points").textContent = pts > 0 ? t(`+${pts} points`, `+${pts} נקודות`) : t("+0 points", "+0 נקודות");
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
  $("btn-next").textContent = (r.n % (d.questionsPerRound ?? DEFAULT_QUESTIONS_PER_ROUND) === 0) ? t("Finish round", "סיום סיבוב") : t("Next question", "שאלה הבאה");
}

$("btn-continue").addEventListener("click", async () => {
  const d = roomData;
  if (!d) return;
  const n = d.round?.n ?? (d.collective ? 0 : null);
  if (n == null) return;
  try {
    await continueTransaction(db, ref(), n);
  } catch (err) { alert(t("Failed: ", "שגיאה: ") + (err as Error).message); }
});

$("btn-send").addEventListener("click", async () => {
  const clue = ($("clue-input") as HTMLInputElement).value.trim();
  if (!clue) return;
  try {
    await updateDoc(ref(), { phase: "guess", "round.clue": clue });
    ($("clue-input") as HTMLInputElement).value = "";
  } catch (err) { alert(t("Failed: ", "שגיאה: ") + (err as Error).message); }
});

$("btn-lock").addEventListener("click", async () => {
  try {
    await updateDoc(ref(), { phase: "reveal", "round.guess": Math.round(draftGuess) });
  } catch (err) { alert(t("Failed: ", "שגיאה: ") + (err as Error).message); }
});

$("btn-next").addEventListener("click", async () => {
  const n = roomData?.round?.n;
  if (!n) return;
  try {
    await nextRoundTransaction(db, ref(), n);
  } catch (err) { alert(t("Failed: ", "שגיאה: ") + (err as Error).message); }
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

let interacting = false;
window.addEventListener("pointerdown", () => { interacting = true; });
window.addEventListener("pointerup", () => { interacting = false; });
window.addEventListener("pointercancel", () => { interacting = false; });
window.addEventListener("blur", () => { interacting = false; });

setInterval(() => {
  if (!roomData || interacting) return;
  if (roomData.phase === "reveal" || (roomData.collective && roomData.phase === "guess")) render();
}, 300);

show("home");
