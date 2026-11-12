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
  that just started or ended a recording must be released before it counts again.
- **Trimming:** the replay starts 1.5 s before the first element and loops up to 2 s after the
  last one (`routineRange`), cutting the wait and the walk-away. The full video is kept, exported
  and can still be scrubbed.
- **Start zone:** drawn by the coach on the live image, once per device. Its bottom edge is the
  floor line used for the stop rule and trimming; it must be where the feet are.
- **Camera:** selectable when a device has several (e.g. ultra-wide lens), remembered per device.
  Chrome on Android usually lists only front and back; there a zoom button (e.g. "0,5×") reaches
  the ultra-wide lens if the phone allows zooming below 1×.
- **Replay:** the finished clip opens immediately and loops while detection keeps running for the
  next gymnast; the small live picture over it can be dragged anywhere, a tap on it goes live. Speeds ¼× / ½× / 1×, frame steps (1 and 5), pinch zoom (double tap resets), skeleton overlay incl. head; left side
  warm, right side cool, arms lighter than legs. A beep sounds when a recording starts. The replay
  skeleton is RTMPose, computed after the recording with a progress bar above the timeline; parts
  not computed yet show no skeleton (never MediaPipe's live one, it's wrong upside down).
- **Clips:** recent recordings as a strip with one thumbnail each. Last 8 kept on the device
  (IndexedDB), deletable with two taps, exportable as video + `.nomol.txt` (JSON; Chrome on
  Android won't share `.json` files).
- **Screen space:** must work on phones and tablets, landscape and portrait. No header/footer;
  controls float over the video and fade during playback. Every tap enters fullscreen (not on
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
  components with `pnpm exec shadcn add <name>`; `cn` lives in `~/lib/utils`. Always dark
  (`<html class="dark">`); controls over the video use the `floating` style in `Tablet.tsx`.
- zod for validation
- Pose detection: MediaPipe Pose Landmarker (`@mediapipe/tasks-vision`) in the browser, up to 4
  people per frame, run once per camera frame (`requestVideoFrameCallback`). WASM and model load
  from CDNs (`pose-detector.client.ts`). Heavy model by default; if it takes > 150 ms per frame
  (median over the first 3 s of detection), the lite model takes over. MediaPipe drives
  everything live (sign, tracking, stop, trimming).
- Replay skeleton: YOLOX-s (human-art) finds the people, RTMPose-m (body7, 256×192) the
  keypoints, both Apache-2.0, with `onnxruntime-web` in a worker (`app/lib/skeleton/`). While
  recording, the frame (long side 640) and MediaPipe's pose are saved 10× per second as JPEG;
  afterwards, routine first: YOLOX (WebGPU) → the box containing MediaPipe's torso centre →
  RTMPose (WASM) on a crop around it. Without WebGPU, or if no box contains the gymnast, the crop
  comes from MediaPipe's poses. Models in `public/models/` (`yolox-s.onnx` 36 MB,
  `rtmpose-m.onnx` 54 MB, from openmmlab's ONNX SDK releases).
- Recording keyframes every 0.5 s (`videoKeyFrameIntervalDuration`): phones otherwise wrote one
  every ~3 s, and scrubbing the replay looked frozen while each seek decoded seconds of video.
- Recording: MediaRecorder on the camera stream; the last 8 clips are kept in IndexedDB
  (`clip-store.client.ts`) and can be exported as video + `.nomol.txt` (`export.ts`).
- Offline: `public/sw.js` caches network-first (app, MediaPipe WASM and model, RTMPose model),
  production only.
- vitest + Testing Library (jsdom)
- pnpm only, Node >= 24
- Database (when needed): Prisma with Postgres. Not added yet; don't add it without a feature
  that needs persistence.

## Code map

- `app/lib/detection/`: pure, tested logic. `session.ts` decides when recordings start and stop
  (`step(state, frame)`), `sign.ts` the start sign, `zone.ts` the start zone and floor line.
- `app/components/Tablet.tsx`: the screen. Runs the camera → detection → session loop, starts
  and finishes recordings, switches between live picture and replay.
- `app/components/LiveControls.tsx`, `StartHint.tsx`, `LoadingScreen.tsx`: the bar over the live
  picture, the start hint, the loading/error screen.
- `app/components/ClipPlayer.tsx`, `ClipStrip.tsx`, `ZoneEditor.tsx`: replay, clip list, coach
  zone drawing.
- `app/hooks/`: `use-clips` (clip list, storage, background skeleton), `use-pose-detector`
  (MediaPipe loading), `use-tap-effects` (fullscreen and sound need a tap), camera hooks.
- `app/lib/recording/`: clips, recorder, pre-roll, storage, export, skeleton interpolation
  (`poseAt`). `capture.client.ts` gathers poses, skeleton frames and stills while recording and
  turns them into a clip.
- `app/lib/skeleton/`: replay skeleton. `yolox.ts` and `rtmpose.ts` pre/post-processing, box
  choice and crops (pure, tested), `rtmpose.worker.ts` inference, `refiner.client.ts` frame
  capture and the job queue.
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
- "On the floor" needs both ankles near the floor line and both knees ≥ 0.1 body sizes below the
  hips (standing measured ≥ 0.13, a raised leg ≤ 0). Ankles alone fail close to a low phone
  camera: a raised foot still looks near the floor line, and feet are often out of the picture
  (MediaPipe then guesses them below it).
- RTMPose (same handstand recording, 47 handstand frames, Python): YOLOX-s + RTMPose-m found 47
  and got 44 the right way up, MediaPipe heavy ~33. The detector matters most (YOLOX-tiny/nano
  missed a quarter); RTMO-s/m were poor (8/15). On MediaPipe's box as crop (no detector) RTMPose
  got 43 of 48 with 1.75× padding (1.25× found only 40). In the app the crop is never smaller
  than the gymnast's median size over the last 0.5 s: MediaPipe sometimes collapses the skeleton
  onto part of the body, and the combined extent instead made the person too small.
- onnxruntime-web 1.30 WebGPU computes RTMPose-m wrong (keypoints pinned to the crop edges; the
  same input in Python is fine) while YOLOX-s works on WebGPU (~90 ms). On WASM RTMPose-m takes
  ~190 ms per crop on a laptop, MediaPipe heavy on the GPU ~35 ms per frame. End to end on the
  handstand video (11 s clip, 75 frames) YOLOX + RTMPose took ~30 s on a laptop and left 4–6
  frames with fewer than 5 of 9 main keypoints (MediaPipe crops only: 9), all blurred kick-ups.
- Automatic start, from three Sprung slow-motion videos (Pixel 8, 240 fps, played back at real
  speed): gymnasts crossed the picture at 2–9 torso lengths per second and were recognised
  0.1–0.4 s after appearing (also at 15 and 10 detections per second). The person is followed
  back through the last 0.4 s: at least 4 sightings, ¾ of the steps towards the apparatus,
  ≥ 0.5 torso lengths in total. Mirrored (coming from the wrong side) none started, except one
  at 10 detections per second where the gymnast appeared next to someone standing. Browsers
  can't record slow motion (Android's high-speed capture is for native apps only).
- Start sign from far away: further than ~half the picture height, MediaPipe heavy rates crossed
  wrists at 0.1–0.5 visibility although their positions are right (phone frames shrunk to ½, ⅓
  and ¼: sign recognised in 7 of 8 at each size once arms needn't be visible).
- Skeleton timing: frames are stamped with the camera capture time; the recording's time 0
  accounts for delivery and detection latency, and poses are interpolated. Verified to line up
  within about a frame by re-detecting on the replay.

## Export format (`.nomol.txt`, JSON, version 2)

`{ version, startedAt, durationMs, aspectRatio, zone, userAgent, frames, skeleton }`. `frames`
are the tracked person's 33 MediaPipe landmarks (`x`, `y` normalized to the image, `visibility`)
with `time` in ms relative to the video's start; times can be slightly negative. Only frames
while recording are included, so start detection can't be replayed from an export, but stop
timing, tracking and skeleton quality can be analyzed alongside the video. `skeleton` is the
RTMPose replay skeleton (~10 per second) in the same 33-point layout; landmarks RTMPose doesn't
have (hands, feet details) and unsure keypoints have visibility 0. It may be partial if exported
before it finished. Version 1 had no `skeleton`.

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
