# AGENTS.md

Guide for coding agents working on Nomol.

## Product

Nomol is a tablet app mounted at a gymnastics apparatus (Swiss Geräteturnen). Gymnasts record and
review themselves when the coach has no time:

- Recording starts when a gymnast crosses their forearms above the head (facing the camera, held
  ~1 s) inside the start zone, or when someone taps "Aufnahme starten". After a button tap, the
  camera follows the person in the start zone.
- Signs outside the start zone don't start a recording.
- The camera follows the recorded person. Recording stops when they stand still on the floor or
  mat. Resting still on an apparatus (e.g. support on the Reck) does not stop it.
- The finished clip opens immediately on the tablet (loop, ¼× / ½× / 1×, skeleton overlay). Pose
  detection keeps running for the next gymnast.
- The coach sets the start zone once per apparatus by drawing it on the live image.
- Nothing is recorded without a sign or button press. Video stays local.

UI language is German (Swiss spelling: "ss", never "ß"). Use the informal "du".

## Stack

- React Router 8 (framework mode, SSR), React 19, Vite, TypeScript strict
- Tailwind CSS v4
- zod for validation
- vitest + Testing Library (jsdom)
- pnpm only, Node >= 24
- Database (when needed): Prisma with Postgres. Not added yet; don't add it without a feature
  that needs persistence.

## Conventions

- Routes are declared in `app/routes.ts` (no file-system routing).
- Path alias `~/*` maps to `app/*`. Use `import type` for type-only imports.
- Prefer `function` declarations over arrow-function constants. Default-export page components.
- Server-only code uses the `*.server.ts` suffix.
- Validate inputs with zod `safeParse`.
- Comments explain why, not what.
- Tests sit next to the code as `*.test.ts(x)`. Mock only third-party/browser APIs (camera, media),
  not our own modules.
- No `console.log` in committed code.
- Commits follow Conventional Commits in plain language (`feat: …`, `fix: …`).

## Agent rules

- Edit files with the edit tools, not with sed or scripts.
- Stay in scope: no unrequested features, abstractions or dependencies.
- When an idea is dropped, remove it completely (code, UI text, docs).
- Before finishing, run: `pnpm format:check`, `pnpm typecheck`, `pnpm lint`, `pnpm test:ci`.
