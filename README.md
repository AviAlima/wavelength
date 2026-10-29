# Wavelength (2–6 players)

A real-time Wavelength game for friends on separate phones. No backend code —
Firebase Firestore does the sync. Hosted on GitHub Pages. Written in TypeScript, built with esbuild.

## Party settings

The host chooses a room size (2–6) and scoring mode in the lobby before starting.
Two-player cooperative rooms retain the original up-front/classic options.
Larger rooms and competitive rooms use a shared clue, individual guesses, and a simultaneous reveal after everyone locks.

- Cooperative: the team earns the mean guesser score, up to 4 points per question.
- Competitive: each guesser earns 0–4 points; the clue giver earns their mean. Fractional points accumulate without rounding and display to one decimal place. Equal scores share a rank.
- A party round gives every player one turn as clue giver. Scores carry into the next round.
- Joining, final-guess scoring, and advancing turns use transactions so concurrent actions do not overfill rooms or award points twice.
- Spectrum skips ask for confirmation; cancelling keeps both the question and the skip allowance.
- Leaving a running game closes the room and only notifies the remaining players. A lobby guest can leave without closing the room.

Run `npm run test:party` for scoring checks, and `npm run e2e` for multiplayer and existing two-player browser tests. Deployment waits for these checks.

## Setup (5 minutes)

1. **Firebase project**: go to https://console.firebase.google.com → *Add project*
2. **Register web app**: click the `</>` icon → copy the config object
3. **Enable Firestore**: Build → Firestore Database → *Create database* (test mode is fine)
4. **Paste your keys** into `src/firebase-config.ts`
5. **Deploy rules** (optional but recommended): publish `firestore.rules` via
   Firestore → Rules tab

## Commands

```sh
npm install
npm run typecheck   # strict TS check
npm run build       # bundle src/ -> dist/
npm run sim         # run the 15-assertion simulation against real Firebase
```

## Run locally

```sh
npm run build
npx serve dist
```
Then open the printed URL on two devices/browsers (must run via http, not `file://`).

## Deploy to GitHub Pages

Push to `main` — the GitHub Actions workflow runs typecheck + build and deploys
`dist/` to Pages automatically. URL: `https://<user>.github.io/wavelength/`

## How it works

- Every party is a Firestore document `rooms/<CODE>` (5-char code).
- Both phones listen to the same doc with `onSnapshot` — instant live sync.
- Round flow: random spectrum + hidden target → clue giver sends a clue →
  guesser drags the arrow → reveal with points (within 10 = 4pts, 20 = 3, 30 = 2, 40 = 1).
- Clue giver alternates every round; score is shared.
- Round creation ("Start" and "Next round") uses Firestore **transactions**, so
  simultaneous presses can never create two different rounds or double-score.

## Testing (sim)

`npm run sim` simulates two players against the real Firestore and asserts:
the full round flow, that both players always see the identical round (no spectrum
desync), and that double-start / double-next races commit exactly once.
The sim runs the same `src/game-logic.ts` module the app uses.

## Notes

- `src/firebase-config.ts` values are only client-side hints; anyone can read your
  Firestore while rules are open. Fine for a fun personal app — lock the rules down
  if it matters.
- Trust-based: the target position is visible to the clue giver's own phone (like
  the real game's screen side of the dial).
