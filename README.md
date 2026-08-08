# Wavelength (2-player, two devices)

A simple real-time Wavelength game for two people on separate phones. No backend code —
Firebase Firestore does the sync. Hosted on GitHub Pages. Written in TypeScript, built with esbuild.

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
