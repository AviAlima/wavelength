export type Lang = "he" | "en";

const LANG_KEY = "wave_lang";
const langOf = (v: string | null): Lang => (v === "en" ? "en" : "he");

let lang: Lang = langOf(typeof localStorage !== "undefined" ? localStorage.getItem(LANG_KEY) : null);

export const getLang = (): Lang => lang;

export const setLang = (l: Lang): void => {
  lang = l;
  try {
    localStorage.setItem(LANG_KEY, l);
  } catch {
    /* ignore */
  }
};

export const t = (en: string, he: string): string => (lang === "he" ? he : en);

export const langLabel = (en: string, he?: string): string => (lang === "he" && he ? he : en);

export const STRINGS: Record<string, { en: string; he: string }> = {
  tagline: { en: "2 players. 1 spectrum. How well do you sync?", he: "2 שחקנים. ספקטרום אחד. כמה אתם מסונכרנים?" },
  "label-nick": { en: 'Your name <em class="required">required</em>', he: 'השם שלך <em class="required">חובה</em>' },
  "nick-ph": { en: "The name your friends will see", he: "השם שהחברים שלך יראו" },
  "nick-error": { en: "Enter your name first.", he: "קודם תכניסו שם." },
  "btn-create": { en: "Create a party", he: "צור משחק" },
  or: { en: "or", he: "או" },
  "label-join": { en: "Join with code", he: "הצטרף עם קוד" },
  "btn-join": { en: "Join party", he: "הצטרף למשחק" },
  "cats-title": { en: "Choose categories", he: "בחרו קטגוריות" },
  "cats-hint": { en: "Pick which spectra to play with. Nothing selected = random from everything.", he: "בחרו אילו ספקטרומים לשחק. לא נבחר כלום = אקראי מכולם." },
  "btn-create-cats": { en: "Create party", he: "צור משחק" },
  "btn-back-cats": { en: "Back", he: "חזרה" },
  "code-label": { en: "Party code", he: "קוד משחק" },
  "btn-copy": { en: "Copy", he: "העתקה" },
  players: { en: "Players", he: "שחקנים" },
  "lobby-waiting": { en: "Waiting for a second player…<br>Share the code above.", he: "מחכים לשחקן שני…<br>שתפו את הקוד למעלה." },
  "qpr-label": { en: "Questions per round", he: "שאלות בסיבוב" },
  "collective-label": { en: "All spectra up front", he: "כל הספקטרומים מראש" },
  "collective-hint": {
    en: "Like the original game: the round's spectra are dealt ahead, each player sees the secret target on their own and writes clues, then you guess each other's targets. Off = one question at a time.",
    he: "כמו המשחק המקורי: ספקטרומי הסיבוב מחולקים מראש, כל שחקן רואה את המטרה הסודית לבד וכותב רמזים, ואז מנחשים זה את המטרות של זה. כבוי = שאלה אחת בכל פעם.",
  },
  "lobby-note": { en: "Waiting for the host to start the game…", he: "מחכים שהמארח יתחיל את המשחק…" },
  "rules-hint": { en: "Clue givers alternate every question. Guess within 6 of the target = 4 pts, 12 = 3, 20 = 2, 30 = 1.", he: "נותן הרמז מתחלף בכל שאלה. ניחוש במרחק עד 6 מהמטרה = 4 נקודות, עד 12 = 3, עד 20 = 2, עד 30 = 1." },
  "btn-leave": { en: "Leave party", he: "עזיבת משחק" },
  score: { en: "Score", he: "ניקוד" },
  "q-label": { en: "Question", he: "שאלה" },
  "round-label": { en: "Round", he: "סיבוב" },
  "game-clue-hint": { en: "Give a clue that lands your teammate near the target:", he: "תנו רמז שינחית את השותף שלכם ליד המטרה:" },
  "clue-ph": { en: "e.g. “Sunday morning”", he: "למשל: “בוקר של יום ראשון”" },
  "btn-send": { en: "Send clue", he: "שלחו רמז" },
  "giver-wait": { en: "Waiting for your teammate's guess…", he: "מחכים לניחוש של השותף…" },
  "guess-wait": { en: "Waiting for a clue…", he: "מחכים לרמז…" },
  "drag-hint": { en: "Drag the arrow to where the target is:", he: "גררו את החץ למקום שבו המטרה:" },
  "btn-lock": { en: "Lock guess", he: "נעילת ניחוש" },
  "reveal-clue-label": { en: "Clue:", he: "רמז:" },
  "btn-leave-game": { en: "Leave party", he: "עזיבת משחק" },
  "skip-text": { en: "skips left — skipped spectra are dropped from the round", he: "דילוגים שנותרו — ספקטרומים שדילגו עליהם יורדים מהסיבוב" },
  "btn-leave-collect": { en: "Leave party", he: "עזיבת משחק" },
  "btn-continue": { en: "Continue playing", he: "המשך לשחק" },
  "summary-wait": { en: "Waiting for the host…", he: "מחכים למארח…" },
  "btn-end": { en: "End game", he: "סיום משחק" },
  "modal-title": { en: "Leave the party?", he: "לעזוב את המשחק?" },
  "btn-stay": { en: "Stay", he: "הישארו" },
  "btn-confirm-leave": { en: "Leave", he: "עזוב" },
};

export function applyStaticLang(): void {
  document.documentElement.lang = lang;
  document.querySelectorAll<HTMLElement>("[data-i18n]").forEach((el) => {
    const s = STRINGS[el.dataset.i18n ?? ""];
    if (s) el.innerHTML = s[lang];
  });
  document.querySelectorAll<HTMLInputElement>("[data-i18n-ph]").forEach((el) => {
    const s = STRINGS[el.dataset.i18nPh ?? ""];
    if (s) el.placeholder = s[lang];
  });
}