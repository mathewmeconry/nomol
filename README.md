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

The app runs on `http://localhost:5173`.

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
