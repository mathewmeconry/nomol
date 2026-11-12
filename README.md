# Nomol

Self-service video replay for Swiss Geräteturnen training. A tablet at the apparatus records a
gymnast when they give the start sign in the start zone (or tap "Aufnahme starten"), follows them
through the routine, and shows the clip right after they land. Runs as an installable web app (PWA).

**Live:** https://mathewmeconry.github.io/nomol/ (deployed from `main`)

## Requirements

- Node >= 24 (`nvm use`)
- pnpm (`corepack enable`)

## Getting started

```bash
pnpm install
pnpm dev
```

The app runs on `http://localhost:5173` (`pnpm dev --port 5180` if that port is taken).

Camera access needs a secure context: `localhost` works, a tablet on the network needs HTTPS.
Pose detection loads its WASM and model from the internet. After one visit with internet, a
service worker (`public/sw.js`, production builds only) keeps the app and the model available
offline.

Live detection (start sign, following, stopping) uses MediaPipe Pose. The replay skeleton is
computed after each recording with [RTMPose](https://github.com/open-mmlab/mmpose/tree/main/projects/rtmpose)
and its YOLOX person detector (RTMPose-m and YOLOX-s, Apache-2.0, in `public/models/`), which
handle handstands far better.

The last 8 clips are kept in the browser (IndexedDB), so they survive reloads. Nothing is
uploaded; **Export** in the player shares or downloads a clip as video plus `.nomol.txt` (JSON body
points per frame, start zone, aspect ratio).

## Setting up a tablet

1. Mount the tablet so the camera sees the whole apparatus, including the floor in front of it.
2. Open the app and allow camera access. Install it to the home screen for full-screen mode.
3. Tap **Startzone** and drag the area where gymnasts stand before they start. Its bottom edge
   must sit on the floor where the feet are: anything not standing on both feet counts as an
   element. Recordings stop ~6 s after the last element (or when the gymnast leaves the picture),
   and the replay loops just the routine.
4. For apparatus like Sprung, pick **Auto von links/rechts** (the side the run-up comes from) and
   draw the start zone over the apparatus and the landing. Each run-in starts a recording by
   itself, including the 1.5–3 s before it was recognised.

## Scripts

- `pnpm dev`: dev server with HMR
- `pnpm build` / `pnpm preview`: static production build in `build/client`, and a server for it
- `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test:ci`: the checks CI runs
- `pnpm knip`: find unused files, exports and dependencies

## Deployment

The app is a static single-page app: camera, pose detection and recording all run in the
browser. Every push to `main` runs the checks and deploys `build/client` to GitHub Pages
(`.github/workflows/deploy.yml`). Pages serves it under `/nomol/`, set at build time with
`BASE_PATH=/nomol/`.

Any static host works too, e.g. with Docker (nginx):

```bash
docker build -t nomol .
docker run -p 8080:80 nomol
```
