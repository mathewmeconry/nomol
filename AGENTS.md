# AGENTS.md

Guide for coding agents working on Nomol.

## Product

Nomol is a proof of concept for Swiss Geräteturnen training: a phone or tablet is mounted at an
apparatus so gymnasts can record and review themselves when the coach has no time. Live at
https://mathewmeconry.github.io/nomol/ (deployed on every push to `main`).

Requirements, as agreed with the owner:

- **Starting:** a gymnast crosses their forearms above the head, facing the camera, held ~1 s,
  inside the start zone. Signs outside the zone don't count. Alternatively someone taps
  "Aufnahme starten"; the camera then follows the person in the start zone (waits up to 20 s).
- **Nothing is recorded without a sign or button press.** No background recording.
- **Following:** only the person who started is tracked; others in the picture are ignored and
  get no boxes.
- **Stopping:** when the gymnast stands still on the floor or a landing mat (~1 s), or leaves the
  picture. Resting still on an apparatus (e.g. support on the Reck) must not stop it.
- **Start zone:** drawn by the coach on the live image, once per device. Its bottom edge is the
  floor line used for the stop rule.
- **Camera:** selectable when a device has several (e.g. ultra-wide lens), remembered per device.
  Chrome on Android usually lists only front and back; there a zoom button (e.g. "0,5×") reaches
  the ultra-wide lens if the phone allows zooming below 1×.
- **Replay:** the finished clip opens immediately and loops while detection keeps running for the
  next gymnast. Speeds ¼× / ½× / 1×, frame steps (1 and 5), skeleton overlay incl. head; left side
  warm, right side cool, arms lighter than legs. A beep sounds when a recording starts.
- **Clips:** recent recordings as a strip with one thumbnail each. Last 8 kept on the device
  (IndexedDB), deletable with two taps, exportable as video + `.nomol.txt` (JSON; Chrome on
  Android won't share `.json` files).
- **Screen space:** must work on phones and tablets, landscape and portrait. No header/footer;
  controls float over the video and fade during playback.
- **Offline:** after one visit with internet the app and model work without a connection.
- **No server for now.** Everything runs and stays on the device. A server is a later discussion.
- **Privacy:** never commit or publish videos or exports of people (`.gitignore` blocks them).

Decided against (don't reintroduce): automatic scoring in the PoC, a rolling buffer or saving a
clip after the fact, a salute as start sign, coach comments, a film-strip timeline.

UI language is German (Swiss spelling: "ss", never "ß"). Use the informal "du".

## Stack

- React Router 8 (framework mode, SPA: `ssr: false`), React 19, Vite, TypeScript strict. Built
  as a static site and deployed to GitHub Pages under `/nomol/` (`BASE_PATH`); use
  `import.meta.env.BASE_URL` for links to files in `public/`.
- Tailwind CSS v4
- zod for validation
- Pose detection: MediaPipe Pose Landmarker (`@mediapipe/tasks-vision`) in the browser, up to 4
  people per frame, run once per camera frame (`requestVideoFrameCallback`). WASM and model load
  from CDNs (`pose-detector.client.ts`).
- Recording: MediaRecorder on the camera stream; the last 8 clips are kept in IndexedDB
  (`clip-store.client.ts`) and can be exported as video + `.nomol.txt` (`export.ts`).
- Offline: `public/sw.js` caches network-first (app, MediaPipe WASM and model), production only.
- vitest + Testing Library (jsdom)
- pnpm only, Node >= 24
- Database (when needed): Prisma with Postgres. Not added yet; don't add it without a feature
  that needs persistence.

## Code map

- `app/lib/detection/`: pure, tested logic. `session.ts` decides when recordings start and stop
  (`step(state, frame)`), `sign.ts` the start sign, `zone.ts` the start zone and floor line.
- `app/components/Tablet.tsx`: the screen. Runs the camera → detection → session loop and drives
  recording and replay.
- `app/components/ClipPlayer.tsx`, `ClipStrip.tsx`, `ZoneEditor.tsx`: replay, clip list, coach
  zone drawing.
- `app/lib/recording/`: clips, recorder, storage, export, skeleton interpolation (`poseAt`).
- `app/tests/poses.ts`: builds synthetic poses for tests.

## Detection notes (learned from real footage)

The thresholds were tuned on a single demo video. Real gym data will likely need retuning.

- MediaPipe normalizes x by width and y by height; all decisions use image-height units
  (`scalePose`), otherwise distances and the shoulder check are skewed on 16:9.
- With crossed forearms the wrists often land on top of each other without swapping sides; "close
  together with elbows out" counts as crossed.
- Facing the camera, shoulder width / torso length is only ~0.43–0.55 (profile ~0.1–0.2).
- The sign drops out for single frames; gaps up to 250 ms don't restart the hold.
- Skeleton timing: frames are stamped with the camera capture time; the recording's time 0
  accounts for delivery and detection latency, and poses are interpolated. Verified to line up
  within about a frame by re-detecting on the replay.

## Export format (`.nomol.txt`, JSON, version 1)

`{ version, startedAt, durationMs, aspectRatio, zone, userAgent, frames }`. `frames` are the
tracked person's 33 MediaPipe landmarks (`x`, `y` normalized to the image, `visibility`) with
`time` in ms relative to the video's start; times can be slightly negative. Only frames while
recording are included, so start detection can't be replayed from an export, but stop timing,
tracking and skeleton quality can be analyzed alongside the video.

## Testing in a browser

The browser pane has no WebGL, so MediaPipe can't run there. Test end to end in a separate
Chromium (e.g. Brave via `playwright-core`, headed) with a video as fake camera:
`--use-fake-ui-for-media-stream --use-fake-device-for-media-stream
--use-file-for-fake-video-capture=<file>.mjpeg` (convert with
`ffmpeg -i in.mp4 -an -vf fps=24,scale=1280:720 -q:v 4 out.mjpeg`; MJPEG plays ~1.25× fast).
Keep such files and scripts outside the repo. Check layouts at phone sizes (e.g. 844×390,
390×844) and on a tablet (e.g. 1180×820).

## Conventions

- Routes are declared in `app/routes.ts` (no file-system routing).
- Path alias `~/*` maps to `app/*`. Use `import type` for type-only imports.
- Prefer `function` declarations over arrow-function constants. Default-export page components.
- Browser-only code (camera, MediaPipe, MediaRecorder, audio, storage) uses the `*.client.ts`
  suffix.
- Validate inputs with zod `safeParse`.
- Comments explain why, not what.
- Tests sit next to the code as `*.test.ts(x)`. Mock only third-party/browser APIs (camera, media),
  not our own modules.
- No `console.log` in committed code.
- Commits follow Conventional Commits in plain language (`feat: …`, `fix: …`).

## Agent rules

- Agents work autonomously in this repo: commit (unsigned is fine), push to `main` and let it
  deploy. Verify behaviour in the browser before pushing.
- Clean, workable code; no slop and no overengineering. Stay in scope: no unrequested
  abstractions or dependencies. Useful PoC features may be proposed and built.
- When an idea is dropped, remove it completely (code, UI text, docs).
- Edit files with the edit tools, not with sed or scripts.
- Before finishing, run: `pnpm format:check`, `pnpm typecheck`, `pnpm lint`, `pnpm test:ci`,
  `pnpm knip`.
