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
- **Automatic start** (e.g. Sprung), chosen per device ("Auto von links/rechts"): a recording
  starts when someone runs into the start zone from the run-up side. Walkers come from the other
  side and must not trigger it, nor people standing nearby. The trigger comes late (the run-up is
  usually outside the picture), so two staggered recorders run while waiting and the older one
  becomes the clip: it starts 1.5–3 s before the trigger. Nothing else is kept.
- **Nothing is recorded without a sign, button press or automatic start.**
- **Following:** only the person who started is tracked; others in the picture are ignored and
  get no boxes.
- **Stopping:** when the recorded gymnast shows the start sign (held ~1 s, anywhere in the
  picture), leaves the picture, or after ~6 s of only standing or walking
  (both feet on the floor or a landing mat) since their last element. Waiting before the routine
  and short breaks between elements must not stop it. An element is anything but both feet on the
  floor; hands don't count as feet (handstand, support on the Reck, balancing on one leg). A sign
  that just started or ended a recording must be released before it counts again. "Aufnahme
  stoppen" in the bar ends a recording by hand.
- **Trimming:** the replay starts 1.5 s before the first element and loops up to 2 s after the
  last one (`routineRange`), cutting the wait and the walk-away. The full video is kept, exported
  and can still be scrubbed.
- **Start zone:** drawn by the coach on the live image, once per device. Its bottom edge is the
  floor line used for the stop rule and trimming; it must be where the feet are.
- **Camera:** selectable when a device has several (e.g. ultra-wide lens), remembered per device.
  Chrome on Android usually lists only front and back; there a "Weitwinkel (0,5×)" switch reaches
  the ultra-wide lens if the phone allows zooming below 1×.
- **Settings** (gear in the bar, kept off the live picture): camera and wide angle, the start
  beep on/off, deleting all recordings (two taps), and the version (commit) and build time, to
  tell whether an update loaded.
- **Replay:** the finished clip opens immediately and loops while detection keeps running for the
  next gymnast; the small live picture over it can be dragged anywhere, a tap on it goes live. Speeds ¼× / ½× (default) / 1×, frame steps (1 and 5), pinch zoom (double tap resets), skeleton overlay incl. head; left side
  warm, right side cool, arms lighter than legs. A beep sounds when a recording starts (unless switched off). The replay
  skeleton is computed after the recording (MediaPipe on turned frames, see Stack) with a progress
  bar above the timeline; parts not computed yet show no skeleton (never the live one, it's wrong
  upside down).
- **Clips:** recordings as a strip with one thumbnail each. All kept on the device
  (IndexedDB, persistent storage requested) until deleted with two taps; no automatic deletion,
  they're test footage for later; or all at once in the settings. Clips are exportable as video + `.nomol.txt` (JSON; Chrome on
  Android won't share `.json` files).
- **Screen space:** must work on phones and tablets, landscape and portrait. No header/footer;
  controls float over the video and fade during playback; the bar keeps only the status, start
  mode, start zone, settings and an icon-only record button. Every tap enters fullscreen (not on
  iPhone); installed to the home screen it starts fullscreen.
- **Offline:** after one visit with internet the app and model work without a connection.
- **No server for now.** Everything runs and stays on the device. A server is a later discussion.
- **Privacy:** never commit or publish videos or exports of people (`.gitignore` blocks them).

Decided against (don't reintroduce): automatic scoring in the PoC, saving a clip after the fact
(the pre-roll of the automatic start is the only look-back), a salute as start sign, coach
comments, a film-strip timeline.

UI language is German (Swiss spelling: "ss", never "ß"). Use the informal "du".

## Stack

- React Router 8 (framework mode, SPA: `ssr: false`), React 19, Vite, TypeScript strict. Built
  as a static site and deployed to GitHub Pages under `/nomol/` (`BASE_PATH`); use
  `import.meta.env.BASE_URL` for links to files in `public/`.
- Tailwind CSS v4, shadcn/ui (new-york, Radix, lucide icons) in `app/components/ui/` — add
  components with `pnpm exec shadcn add <name>`; join classes with `cn` from the `cn` package
  (shadcn's replacement for clsx + tailwind-merge), never with template strings. Always dark
  (`<html class="dark">`); controls over the video use the `floating` style in `Tablet.tsx`.
- zod for validation
- Pose detection: MediaPipe Pose Landmarker (`@mediapipe/tasks-vision`) in the browser, up to 4
  people per frame, in a worker (`pose.worker.ts`): each camera frame
  (`requestVideoFrameCallback`) goes there as a `VideoFrame` and comes back with the poses, so recording saves exactly the
  detected picture; the newest frame arriving meanwhile is detected next. On the page, detection
  blocked drawing (on a warm phone 100–250 ms per frame, the replay stuttered constantly); an
  `ImageBitmap` copy of the video cost a third of the detections on a Pixel 8. MediaPipe's
  `importScripts` is shimmed for module workers (`landmarker.client.ts`). WASM and model load
  from CDNs (`pose-detector.client.ts`). Heavy model by default; if it takes > 100 ms per frame
  (median over 3 s of detection, checked again and again since phones slow down as they heat
  up), the lite model takes over. MediaPipe drives
  everything live (sign, tracking, stop, trimming).
- Replay skeleton (`app/lib/skeleton/`): MediaPipe heavy again, as a second landmarker in IMAGE
  mode on the already loaded model, in a worker (`skeleton.worker.ts`; on the page it blocked
  the replay up to ~0.5 s per frame, sometimes 1.4 s, on a Pixel 8). While recording, the
  frame (long side 640) and the live tracked pose are saved 10× per second as JPEG. Afterwards
  each frame is cropped around the live torso centre and turned by the previous frame's body
  angle plus its turning speed, so the gymnast appears upright; if MediaPipe sees no upright
  gymnast there, the other angles (180°, ±90°) and then the whole frame are tried. Forwards from
  the routine's start, then backwards over the wait before it. Paused while recording. It
  replaced YOLOX + RTMPose (onnxruntime-web, 90 MB of models), which took ~1.3 s per frame on a
  Pixel 8.
- Recording keyframes every 0.5 s (`videoKeyFrameIntervalDuration`): phones otherwise wrote one
  every ~3 s, and scrubbing the replay looked frozen while each seek decoded seconds of video.
- Recording: MediaRecorder on the camera stream; clips are kept in IndexedDB
  (`clip-store.client.ts`) and can be exported as video + `.nomol.txt` (`export.ts`).
- Offline: `public/sw.js` caches network-first (app, MediaPipe WASM and model), production only.
- vitest + Testing Library (jsdom)
- pnpm only, Node >= 24
- Database (when needed): Prisma with Postgres. Not added yet; don't add it without a feature
  that needs persistence.

## Code map

- `app/lib/detection/`: pure, tested logic. `session.ts` decides when recordings start and stop
  (`step(state, frame)`), `sign.ts` the start sign, `zone.ts` the start zone and floor line.
  Also MediaPipe itself: `pose-detector.client.ts` (models, lite fallback) talking to
  `pose.worker.ts`.
- `app/components/Tablet.tsx`: the screen. Runs the camera → detection → session loop, starts
  and finishes recordings, switches between live picture and replay.
- `app/components/LiveControls.tsx`, `Settings.tsx`, `StartHint.tsx`, `LoadingScreen.tsx`: the
  bar over the live picture, the settings dialog, the start hint, the loading/error screen.
- `app/components/ClipPlayer.tsx`, `ClipStrip.tsx`, `ZoneEditor.tsx`: replay, clip list, coach
  zone drawing.
- `app/hooks/`: `use-clips` (clip list, storage, background skeleton), `use-pose-detector`
  (MediaPipe loading), `use-tap-effects` (fullscreen and sound need a tap), camera hooks.
- `app/lib/recording/`: clips, recorder, pre-roll, storage, export, skeleton interpolation
  (`poseAt`). `capture.client.ts` gathers poses, skeleton frames and stills while recording and
  turns them into a clip.
- `app/lib/skeleton/`: replay skeleton. `rotation.ts` the turned views and the tracking through
  a clip (pure, tested), `skeleton.worker.ts` MediaPipe on the turned views, `refiner.client.ts`
  frame capture and the job queue.
- `app/tests/poses.ts`: builds synthetic poses for tests.

## Detection notes (learned from real footage)

The thresholds were tuned on a single demo video. Real gym data will likely need retuning.

- MediaPipe normalizes x by width and y by height; all decisions use image-height units
  (`scalePose`), otherwise distances and the shoulder check are skewed on 16:9.
- With crossed forearms the wrists often land on top of each other without swapping sides; "close
  together with elbows out" counts as crossed.
- Facing the camera, shoulder width / torso length is only ~0.43–0.55 (profile ~0.1–0.2).
- The sign drops out for single frames; gaps up to 250 ms don't restart the hold.
- Handstands: on a phone recording (31 handstand frames) lite found the person in 23 and got 18
  the right way up, full 19/17, heavy 31/21. Going into a handstand the skeleton flips between
  upright and upside down, so the person is followed by the torso centre (middle of shoulders
  and hips, unchanged by a flip), and the search radius widens while they aren't found.
- While recording, everyone else in the picture is remembered and keeps their own skeleton, so the
  gymnast can move far between frames (a salto moved the torso 0.32 in 67 ms) without the tracker
  switching to a coach standing by. Someone who was hidden behind the gymnast can't be known; when
  the gymnast leaves at the side, only a skeleton close by and of similar size counts as them.
  Checked on six recordings (Sprung, Reck, handstands, a busy hall) traced frame by frame.
- "On the floor" needs both ankles near the floor line and both knees ≥ 0.1 body sizes below the
  hips (standing measured ≥ 0.13, a raised leg ≤ 0). Ankles alone fail close to a low phone
  camera: a raised foot still looks near the floor line, and feet are often out of the picture
  (MediaPipe then guesses them below it).
- RTMPose (the earlier replay skeleton; same handstand recording, 47 handstand frames): YOLOX-s +
  RTMPose-m got 44 the right way up, MediaPipe heavy ~33. RTMO-s/m were poor (8/15).
- Replay skeleton, MediaPipe on turned frames (compared frame by frame on the saved 640 px
  frames, 10 per second): on two dim handstand recordings with the legs often out of the picture
  (63 handstand frames, judged by eye) tracking the angle got 53 right way up, live 35, whole
  frames 49, upright + 180° picking the more visible 51; also running backwards and merging 55,
  at twice the cost. On five Reck/Sprung recordings in a busy hall (617 frames, RTMPose as
  reference) on the right person and the right way up: tracking 595, live 591, whole frames 482
  (the gymnast is small at 640 px and often missed; the crop enlarges them); upside down 34 of
  40, live 30. Taking the nearest skeleton without a distance limit followed a spectator for a
  whole recording; hence views centred on the live torso centre and a 0.2 image-height limit.
  On a Sprung clip the blurred gymnast running past two girls squatting by the springboard was
  missed and one of them drawn instead (0.13 image heights away); with a live pose the limit is
  now 0.15 of the gymnast's size. On that clip and two hall recordings (411 frames) this moved
  7 frames, 5 of them from someone else or a partial skeleton onto the gymnast, and dropped 3.
  ~1.5 MediaPipe runs per frame, ~30 ms each on a laptop GPU.
- Automatic start, from three Sprung slow-motion videos (Pixel 8, 240 fps, played back at real
  speed): gymnasts crossed the picture at 2–9 torso lengths per second and were recognised
  0.1–0.4 s after appearing (also at 15 and 10 detections per second). Browsers can't record
  slow motion (Android's high-speed capture is for native apps only).
  The first rule (last 0.4 s, 4 sightings, ¾ of frame-to-frame steps forward, nearest skeleton
  as the earlier sighting) never started at 4 or fewer detections per second, which phones
  filming a jump managed, and started on two girls squatting by the springboard (detected in
  turn, with jitter counting as forward steps); running past them, the gymnast's trail hopped
  onto them. Now (Sprung clip filmed by hand, gymnast visible ~0.35 s before take-off): the
  person is followed back through 1 s, only along steps ≥ 100 ms apart, towards the apparatus
  at 2–12 torso lengths per second and with torso lengths within 1.5×; 4 sightings start. Run
  at 3–30 detections per second (heavy and lite, every frame offset) it started in nearly every
  case, 1.4 s in at 30 and ~2.3 s (in flight) at 3; mirrored it didn't, except once at 30 per
  second (hand-held drift plus a hop). On three hall recordings it started far less often on
  people walking or running around than the first rule.
- Phone load, Pixel 8 (measured over adb, `chrome://inspect`): MediaPipe heavy took 25 ms per
  frame at first; after ~45 minutes of camera and models it ran hot (thermal status critical)
  and took 100–300 ms. While the RTMPose replay skeleton was computing (~1.3 s per frame there),
  recordings dropped from ~43 to ~25 fps with gaps up to 0.25 s and live detection slowed by a
  third; busy CPU threads alone barely mattered. With MediaPipe on the page, the replay skeleton
  (MediaPipe on turned frames) took 0.35–0.5 s per frame and the page dropped every frame for
  whole recordings; with both in workers (camera pointed at a screen looping a gym video,
  thermal status severe) under 1 s in 15 s of a recording drew slower than 50 ms. Automatic mode's two pre-roll recorders cost
  another ~40 % of the detection rate. In the dark the camera delivers only ~14 fps.
- Start sign from far away: further than ~half the picture height, MediaPipe heavy rates crossed
  wrists at 0.1–0.5 visibility although their positions are right (phone frames shrunk to ½, ⅓
  and ¼: sign recognised in 7 of 8 at each size once arms needn't be visible).
- Skeleton timing: frames are stamped with the camera capture time; the recording's time 0
  accounts for delivery and detection latency, and poses are interpolated. Verified to line up
  within about a frame by re-detecting on the replay.

## Export format (`.nomol.txt`, JSON, version 3)

`{ version, appVersion, startedAt, durationMs, aspectRatio, zone, startReason, runUp, userAgent,
frames, skeleton }`. `appVersion` is the commit that recorded the clip, `startReason` `sign`,
`button` or `runUp`, `runUp` the automatic start setting (`left`, `right` or null); all three are
null for clips recorded before version 3. `frames`
are the tracked person's 33 MediaPipe landmarks (`x`, `y` normalized to the image, `visibility`)
with `time` in ms relative to the video's start; times can be slightly negative. Only frames
while recording are included, so start detection can't be replayed from an export, but stop
timing, tracking and skeleton quality can be analyzed alongside the video. `skeleton` is the
replay skeleton (~10 per second) in the same 33-point layout, with MediaPipe's visibility. Clips
recorded before November 2026 (see `appVersion`) have RTMPose's instead, where landmarks it
doesn't have (hands, feet details) and unsure keypoints have visibility 0. It may be partial if
exported before it finished. Version 1 had no `skeleton`, version 2 no `appVersion`, `startReason`, `runUp`.

## Testing in a browser

The browser pane has no WebGL, so MediaPipe can't run there. Test end to end in a separate
Chromium (e.g. Brave via `playwright-core`) with a video as fake camera. Run it headless so no
window pops up on the owner's screen: `headless: true` plus `--use-angle=swiftshader
--enable-unsafe-swiftshader` gives MediaPipe software WebGL (about half as fast, works). Flags for
the camera:
`--use-fake-ui-for-media-stream --use-fake-device-for-media-stream
--use-file-for-fake-video-capture=<file>.mjpeg` (convert with
`ffmpeg -i in.mp4 -an -vf fps=24,scale=1280:720 -q:v 4 out.mjpeg`; MJPEG plays ~1.25× fast).
To compare models on an exported video, run them frame by frame in the page: load the video as a
blob URL (a Playwright-routed response can't seek) and re-encode it first (`-g 1`), because
recorded MP4s seek badly and report wrong durations. Software WebGL is far slower than a real
GPU, so only relative timings mean something; headless with a GPU (`--use-angle=gl`) crashes.
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
