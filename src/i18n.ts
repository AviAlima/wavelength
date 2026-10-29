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
  "label-nick": { en: "What should we call you?", he: "איך לקרוא לך?" },
  "avatar-title": { en: "Pick your character", he: "מי אתם היום?" },
  "party-settings-title": { en: "Your party", he: "המשחק שלכם" },
  "party-capacity": { en: "Room size", he: "מקומות בחדר" },
  "party-scoring": { en: "Scoring", he: "איך סופרים נקודות?" },
  "party-coop": { en: "Together 🤝", he: "ביחד 🤝" },
  "party-compete": { en: "Competitive 🏆", he: "תחרותי 🏆" },
  "skip-confirm-title": { en: "Skip this spectrum?", he: "לדלג על השאלה?" },
  "skip-confirm-hint": { en: "A new spectrum will replace it and use one skip.", he: "נקבל שאלה חדשה במקום הזו, ונשתמש בדילוג אחד." },
  "skip-cancel": { en: "Keep it", he: "נשארים עם השאלה" },
  "skip-yes": { en: "Yes, skip", he: "כן, לדלג" },
  "nick-ph": { en: "The name your friends will see", he: "השם שהחברים שלך יראו" },
  "nick-error": { en: "Enter your name first.", he: "קודם תכניסו שם." },
  "btn-create": { en: "Create a party", he: "יצירת משחק" },
  "create-sub": { en: "Choose the vibe and invite a friend", he: "בוחרים אווירה ומזמינים חבר" },
  or: { en: "or", he: "או" },
  "label-join": { en: "Join with code", he: "הצטרפות עם קוד" },
  "join-sub": { en: "Got an invite? Jump right in", he: "קיבלת קוד? קופצים ישר פנימה" },
  "btn-join": { en: "Join", he: "יאללה" },
  "setup-step": { en: "One tiny setup", he: "עוד בחירה קטנה" },
  "cats-title": { en: "Pick your playground", he: "על מה משחקים?" },
  "cats-hint": { en: "Choose a few, take them all, or let fate decide.", he: "בוחרים כמה, לוקחים הכול או נותנים למזל להחליט." },
  "cat-all": { en: "Select all", he: "הכול" },
  "cat-surprise": { en: "Surprise me 🎲", he: "תפתיעו אותי 🎲" },
  "btn-create-cats": { en: "Create the party", he: "פותחים משחק" },
  "btn-back-cats": { en: "Back", he: "חזרה" },
  "code-label": { en: "Party code", he: "קוד משחק" },
  "btn-copy": { en: "Copy", he: "העתקה" },
  players: { en: "Players", he: "שחקנים" },
  "lobby-waiting": { en: "Waiting for a second player…<br>Share the code above.", he: "מחכים לשחקן שני…<br>שתפו את הקוד למעלה." },
  "qpr-label": { en: "Round length", he: "כמה שאלות בסיבוב?" },
  "collective-label": { en: "All spectra up front", he: "כל הספקטרומים מראש" },
  "collective-hint": {
    en: "Everyone writes their clues first. Then you take turns guessing each other's targets. Turn it off for one question at a time.",
    he: "כולם כותבים קודם את הרמזים שלהם. אחר כך מנחשים בתורות את המטרות זה של זה. אפשר לכבות כדי לשחק שאלה־שאלה.",
  },
  "collective-short": { en: "Clues first, guesses second", he: "קודם רמזים, אחר כך ניחושים" },
  "how-it-works": { en: "How does it work?", he: "איך זה עובד?" },
  "lobby-note": { en: "Waiting for the host to start the game…", he: "מחכים שהמארח יתחיל את המשחק…" },
  "rules-hint": { en: "The closer the guess, the more points you score: up to 4 points per question.", he: "ככל שהניחוש קרוב יותר, מקבלים יותר נקודות — עד 4 נקודות לשאלה." },
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
  "btn-update-version": { en: "Update version", he: "עדכון גרסה" },
  "modal-title": { en: "Leave the party?", he: "לעזוב את המשחק?" },
  "btn-stay": { en: "Stay", he: "הישארו" },
  "btn-confirm-leave": { en: "Leave", he: "עזוב" },
};

export function applyStaticLang(): void {
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === "he" ? "rtl" : "ltr";
  document.querySelectorAll<HTMLElement>("[data-i18n]").forEach((el) => {
    const s = STRINGS[el.dataset.i18n ?? ""];
    if (s) el.innerHTML = s[lang];
  });
  document.querySelectorAll<HTMLInputElement>("[data-i18n-ph]").forEach((el) => {
    const s = STRINGS[el.dataset.i18nPh ?? ""];
    if (s) el.placeholder = s[lang];
  });
}
