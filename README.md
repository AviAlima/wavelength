# Wavelength (2-player, two devices)

A simple real-time Wavelength game for two people on separate phones. No backend code —
Firebase Firestore does the sync. Hosted on GitHub Pages.

## Setup (5 minutes)

1. **Firebase project**: go to https://console.firebase.google.com → *Add project*
2. **Register web app**: click the `</>` icon → copy the config object
3. **Enable Firestore**: Build → Firestore Database → *Create database* (test mode is fine)
4. **Paste your keys** into `js/firebase-config.js`
5. **Deploy rules** (optional but recommended): publish `firestore.rules` via
   Firestore → Rules tab

## Run locally

```sh
python3 -m http.server 8000
# or: npx serve
```
Then open http://localhost:8000 on two devices/browsers (must run via http, not `file://`).

## Deploy to GitHub Pages

1. Create a new repo (e.g. `wavelength`), push this folder
2. Repo → Settings → Pages → Source: **Deploy from a branch** → `main` / root
3. Done — your URL is `https://<user>.github.io/wavelength/`

## How it works

- Every party is a Firestore document `rooms/<CODE>` (5-char code).
- Both phones listen to the same doc with `onSnapshot` — instant live sync.
- Round flow: random spectrum + hidden target → clue giver sends a clue →
  guesser drags the arrow → reveal with points (within 10 = 4pts, 20 = 3, 30 = 2, 40 = 1).
- Clue giver alternates every round; score is shared.

## Notes

- `js/firebase-config.js` values are only client-side hints; anyone can read your Firestore
  while rules are open. Fine for a fun personal app — lock the rules down if it matters.
- Trust-based: the target position is visible to the clue giver's own phone (like the
  real game's screen side of the dial).
