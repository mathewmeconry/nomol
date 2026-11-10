# Nomol

Self-service video replay for Swiss Geräteturnen training. A tablet at the apparatus records a
gymnast when they give the start sign in the start zone (or tap "Aufnahme starten"), follows them
through the routine, and shows the clip right after they land. Runs as an installable web app (PWA).

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
Pose detection loads its WASM and model from the internet on startup.

## Setting up a tablet

1. Mount the tablet so the camera sees the whole apparatus, including the floor in front of it.
2. Open the app and allow camera access. Install it to the home screen for full-screen mode.
3. Tap **Startzone** and drag the area where gymnasts stand before they start. Its bottom edge
   must sit on the floor: recordings stop when the gymnast stands still on that floor line.

## Scripts

- `pnpm dev`: dev server with HMR
- `pnpm build` / `pnpm start`: production build and server
- `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test:ci`: the checks CI runs
- `pnpm knip`: find unused files, exports and dependencies

## Docker

```bash
docker build -t nomol .
docker run -p 3000:3000 nomol
```
