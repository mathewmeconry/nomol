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
  becomes the clip: it starts 1.5–3 s before the trigger. Nothing else is kept. "Auto bei Tempo"
  does the same for anyone faster than walking (≥ 4 torso lengths per second) in any direction,
  for all apparatus: swinging on the rings, a run-up on the floor.
- **Nothing is recorded without a sign, button press or automatic start.**
- **Following:** only the person who started is tracked; others in the picture are ignored and
  get no boxes.
- **Stopping:** when the recorded gymnast shows the start sign (held ~1 s, anywhere in the
  picture), leaves the picture (1.5 s unseen; 3 s if last seen in an element, since a swing on the
  rings leaves the picture and comes back), or after ~6 s of only standing or walking
  (both feet on the floor or a landing mat) since their last element. Waiting before the routine
  and short breaks between elements must not stop it. An element is anything but both feet on the
  floor; hands don't count as feet (handstand, support on the Reck, balancing on one leg). A sign
  that just started or ended a recording must be released before it counts again. "Aufnahme
  stoppen" in the bar ends a recording by hand.
- **Trimming:** the replay starts 1.5 s before the first element and loops up to 2 s after the
  last one (`routineRange`), cutting the wait and the walk-away. The full video is kept, exported
  and can still be scrubbed.
- **Start zone:** drawn by the coach on the live image, once per device. Its bottom edge is the
  floor line used for the stop rule and trimming; it must be where the feet are. Detection only
  looks at the zone and around it (`detectionArea`, see Stack).
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

- pnpm monorepo: `apps/web` (`@nomol/web`) is the web app; `apps/native` (`@nomol/native`) the
  Android app being ported to React Native; `packages/core` (`@nomol/core`) holds the pure logic
  (detection, clips, export format, skeleton rotation, zoom, settings parsing) shared by both.
  Shared pure logic belongs in `packages/core` so web and native stay in sync; it is imported as
  TypeScript source (`@nomol/core/detection/session`, no build step) and must not use browser or
  React Native APIs. Run the scripts from the root: they cover the whole workspace (`pnpm dev`,
  `pnpm build` and `pnpm preview` run the web app). Each app has its own React (web 19.3.1,
  native 19.3.0 as React Native 0.88 requires).
- Android app (`apps/native`, `ch.nomol.app`): Expo SDK 58, React Native 0.88, TypeScript strict,
  react-native-vision-camera 5 (Nitro modules). The live screen: camera preview,
  start mode, start zone editor, settings (camera/lens, "Weitwinkel" = the camera's `minZoom`
  below 1×, beep, delete all, version), and live detection driving core's session (status,
  boxes, sign, "Aufnahme starten", automatic start, stop, beep); recording, clip strip, replay
  export, the replay skeleton and the automatic start's pre-roll (see below). Settings are stored synchronously in `expo-sqlite/kv-store` under the web app's keys
  (`SETTINGS_KEYS` in core). Icons from `@expo/vector-icons` (MaterialCommunityIcons). Continuous
  native generation: `android/` is generated by `expo prebuild` and not committed; everything
  native is configured in `app.config.ts` and config plugins. The build machine has only
  build-tools 37.0.0, platform android-37 and NDK 30.0.16248370 in `/opt/android-sdk`, system
  CMake in `/usr/bin`, and JDK 21 that must be named in `JAVA_HOME`;
  `plugins/with-android-toolchain.js` pins every Gradle module to these and writes
  `local.properties`, since Gradle can't download others.
- Android pose detection: MediaPipe Pose Landmarker for Android (`com.google.mediapipe:tasks-vision`,
  VIDEO mode, GPU delegate with CPU fallback, up to 4 poses) in a Nitro module,
  `packages/native-modules` (`@nomol/native-modules`, Kotlin; also the start beep, a system
  `ToneGenerator`). MediaPipe for Android takes no region of interest for poses, so Kotlin cuts
  the crop out of the frame (`ImageProxy.toBitmap`, then one `Bitmap.createBitmap` that crops,
  turns upright, mirrors and shrinks to ≤ 512 px) and returns flat landmarks normalized to that
  crop; all coordinate math is in core (`camera-frame.ts`): `bufferCrop` maps the
  `detectionArea` (picture coordinates, as on screen) to buffer pixels by the frame's rotation
  and mirroring, `cropArea` and `posesInArea` map the landmarks back. Detection runs
  synchronously in VisionCamera's frame worklet on the camera thread (`useFrameOutput`,
  react-native-worklets; core functions called there need a `'worklet'` directive), dropping
  frames while busy, so the newest one is detected next; results go to the JS thread with
  `scheduleOnRN`, where `step()` runs. The area goes the other way through a worklets
  `Synchronizable`. Frames are 4:3 like the preview (otherwise the two show different parts of
  the sensor), targeting 1280×960. Frame time is the camera timestamp in ms (the sensor's clock:
  BOOTTIME on most phones, else MONOTONIC; see recording). If the GPU delegate fails when a
  landmarker is created or only at its first detection, it is created again on the CPU, once
  (`Landmarker` in `Landmarkers.kt`, live and replay skeleton). Same heavy
  → lite rule as the web (`measureSpeed` in core). The `.task` models are downloaded from
  storage.googleapis.com by the module's Gradle build into `android/models/` (gitignored) and
  bundled as assets, so the app works offline from the first start; nitrogen's generated code
  is not committed either (`pnpm specs`, run by `prebuild`).
- Android recording (`src/lib/recording.ts`, Kotlin `HybridClipRecorder.kt`): our own encoder
  instead of CameraX's `Recorder`, which allows one `VideoCapture` and one recording at a time,
  can't begin before it is started and hardcodes 1 s keyframes. `ClipRecorder.output` is a
  custom VisionCamera camera output (`NativeCameraOutput`; Nitro can't yet extend
  `CameraOutput` across modules, so it is a property, like VisionCamera's barcode scanner)
  whose use case is a second CameraX `Preview` (4:3, 1440×1080, CameraX allows several Previews
  but one VideoCapture). Two Previews and the analysis stream only run together with one
  Preview at VGA (the Pixel 8 guarantees PRIV preview + PRIV VGA + YUV maximum, CameraX's
  `ExtraSupportedSurfaceCombinationsQuirk`), and CameraX gives the larger size to the output
  listed first; so the clip output comes first and the picture on screen is 640×480 (soft, but
  the clip and the detected frames keep their size). Sharing one stream between screen and
  encoder would need a CameraX effect, which VisionCamera's session doesn't take. The Preview
  feeds a MediaCodec H.264 encoder's input surface (12 Mbit/s, no audio,
  a keyframe every 0.5 s: the encoder is asked for one whenever the last is 0.5 s old, since
  encoders count the interval in frames and the camera's frame rate varies). Encoded samples
  carry the frames' capture timestamps, but Camera2 stamps a surface feeding an encoder with
  MONOTONIC while analysis frames carry the sensor's clock (BOOTTIME on Pixels); the two differ
  by the time the phone slept since boot. As CameraX's recorder does, the clock of each is
  taken to be the one whose current time is closer to its first timestamp (`CameraClock.kt`,
  JVM-tested; logged once at debug level under the tag `NomolRecorder`), and the recorder works
  in BOOTTIME inside while JS gives and gets frame times, so time 0 is the first written frame's
  capture time. The encoder is suspended
  (`PARAMETER_KEY_SUSPEND`, frames dropped before encoding) unless recording or buffering.
  While waiting in an automatic mode it buffers the last 3 s in memory (`SampleBuffer.kt`,
  always starting at a keyframe, JVM-tested); an automatic start's video begins at the last
  buffered keyframe at least 1.5 s before the trigger (1.5–2 s), sign and button starts at the
  next keyframe. MediaMuxer writes the MP4 with CameraX's rotation as orientation hint; the clip
  ends at its last frame. Video stabilization is off (it crops, and the video would no longer
  match the detected frames). Front cameras: the video is never mirrored while the preview and
  live poses are, so a clip stores everything as in the video: poses are unmirrored (x flipped
  and the body's sides swapped back, core's `unmirrorPose`), stills are saved unmirrored and the
  clip's zone is mirrored; exports then match the video as the web app's do. An encoder error
  drops the encoder (a clip keeps what it has) and the next start or stop reports it; an encoder
  that can't be created declines the surface, so the camera still runs. If the camera is set up
  anew mid-clip (new encoder), the clip ends at the old encoder's last frame and detections
  after it are dropped. The screen orientation is locked while recording
  (`expo-screen-orientation`): turned, the poses would no longer match the video, whose
  orientation is fixed when it begins. Checked on the Pixel 8 (November 2026, front camera,
  button start, 38.5 s): 1440×1080 H.264 with rotation 90, ~28 fps, no gap over 46 ms,
  keyframes every 0.50–0.58 s, duration as in the export; poses unmirrored (head and sides
  match the video); detected frames in BOOTTIME, the encoder in MONOTONIC. Timestamps after a
  suspend and automatic starts still need a person moving in front of it. While recording, the frame worklet saves a still every 100 ms
  (`detect(..., stillPath)`: the frame already converted for detection, turned upright but not
  mirrored, long side 640, JPEG written on a background thread) with the tracked pose, for the replay skeleton
  and the thumbnail (the still nearest the routine's middle). While buffering it keeps the last
  3 s of detections and saves stills into the cache while someone is in the picture; on an
  automatic start the runner is traced back over them (core's `tracePreroll`, as in the web
  app) and their poses and stills join the clip, so the run-up gets a skeleton too.
- Android replay skeleton (`src/lib/skeleton.ts`): the web's pipeline with the same core logic
  (`createTracker`, `skeletonPasses`, `posesFromView`), one clip after the other, paused while
  recording. Kotlin (`HybridSkeletonLandmarker`, a second landmarker on the bundled heavy model,
  IMAGE mode, GPU with CPU fallback) is only a primitive: `open(still)` decodes a still, and
  `detect(centre, size, angle)` cuts the turned 512 px view out of it (the web worker's canvas
  transform as an Android `Matrix`) and returns landmarks normalized to the view, on Nitro's
  background threads (`Promise.async`). Since those answer asynchronously, core's tracker takes
  a detector returning a promise. The JS thread only picks views. Progress is stored every 3 s:
  the skeleton into the clip's `.nomol.txt` (written beside it and moved over it, so a closed
  app can't leave a cut-off JSON) and the number of done stills in `skeleton-done.json`. On the
  next start it continues there; the done stills' stored results are fed back to the tracker
  instead of being detected again, which restores its state exactly (tested in core). Once
  complete, `stills/`, `samples.json` and `skeleton-done.json` are deleted (the thumbnail
  stays): the web app keeps its frames only in memory, so nothing needs them afterwards.
- Android clips (`src/lib/clip-store.ts`): one folder per clip in the app's documents
  (`clips/<start ms>/`): `<export name>.mp4`, `<export name>.nomol.txt` (core's `exportData`,
  read back with `parseExport`), `thumbnail.jpg`, `stills/*.jpg` + `samples.json` (+
  `skeleton-done.json`) until the replay skeleton is complete. Kept until
  deleted (two taps, or all in the settings: everything under `clips/` except a recording
  running). A folder without a `.nomol.txt`, or one that isn't JSON, more than 10 minutes after
  its start is a recording the app was closed during and is deleted on the next start; one in
  another export format stays. `exportData` leaves out frames with NaN or Infinity, which JSON
  would turn into null and `parseExport` refuse. Export shares the video and the JSON together via
  `FileShare` (`ACTION_SEND_MULTIPLE` with expo-file-system's content URIs; Expo's and React
  Native's share take one file). Replay (`ClipPlayer.tsx`): expo-video (ExoPlayer, exact seeks,
  `playbackRate`, scrubbing mode while dragging the timeline, a `textureView` so it can sit
  under the live picture), looping `routineRange` through `timeUpdate` events; zoom resizes the
  video view instead of transforming it so the skeleton's lines stay thin. Gestures use React
  Native's responder props (the React Compiler lint refuses `PanResponder` built during
  render).
- React Router 8 (framework mode, SPA: `ssr: false`), React 19, Vite, TypeScript strict. Built
  as a static site and deployed to GitHub Pages under `/nomol/` (`BASE_PATH`); use
  `import.meta.env.BASE_URL` for links to files in `apps/web/public/`.
- Tailwind CSS v4, shadcn/ui (new-york, Radix, lucide icons) in `apps/web/app/components/ui/` —
  add components with `pnpm exec shadcn add <name>` in `apps/web`; join classes with `cn` from the `cn` package
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
  everything live (sign, tracking, stop, trimming). It only gets part of each frame
  (`detectionArea`): the start zone plus a quarter of its size on each side, widened to a square,
  and while recording also wherever the gymnast has been (`coverPose`). MediaPipe shrinks its
  input to a 256 px square, so on a whole 16:9 frame someone at the back of the hall was a few
  pixels tall. The crop is a `visibleRect` view of the `VideoFrame` (no copy; gives the same
  poses as a canvas crop), mapped back to whole-frame coordinates in the worker.
- Replay skeleton (`apps/web/app/lib/skeleton/`): MediaPipe heavy again, as a second landmarker in IMAGE
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
  (`clip-store.client.ts`) and can be exported as video + `.nomol.txt` (`export.client.ts`, format in core's `export.ts`).
- Offline: `apps/web/public/sw.js` caches network-first (app, MediaPipe WASM and model), production only.
- vitest + Testing Library (jsdom in the web app, node in core)
- pnpm only, Node >= 24
- Database (when needed): Prisma with Postgres. Not added yet; don't add it without a feature
  that needs persistence.

## Code map

`packages/core/src/` (pure, tested, shared):

- `detection/`: `pose.ts` landmarks and body measures, `session.ts` decides when recordings
  start and stop (`step(state, frame)`), `sign.ts` the start sign, `zone.ts` the start zone and
  floor line, `camera-frame.ts` crops of camera buffers (Android), `model-speed.ts` the heavy →
  lite switch.
- `recording/`: `clip.ts` clips, trimming (`routineRange`) and skeleton interpolation
  (`poseAt`), `export.ts` the export format (`exportData`, `parseExport`), `preroll.ts` the
  automatic start's look-back (`PREROLL_MAX_MS`, `tracePreroll`).
- `skeleton/rotation.ts`: the turned views, the tracking through a clip and the order of the
  passes (`skeletonPasses`) for the replay skeleton. `skeleton/lines.ts`: the skeleton's lines and colours, drawn by both apps.
- `zoom.ts`: replay pinch zoom.
- `settings.ts`: per-device settings (zone, start mode, camera, wide angle, beep): storage keys,
  parsing with fallbacks, default zone.
- `tests/poses.ts`: builds synthetic poses for tests.

`apps/native/`:

- `app.config.ts`: app name, id, permissions, SDK versions, version and build time (`extra`).
- `plugins/with-android-toolchain.js`: pins SDK, NDK and build-tools (see Stack).
- `src/App.tsx`: full screen, keep awake, camera permission. `src/components/Tablet.tsx`: the
  screen (camera preview sized to the picture's aspect ratio, zone overlay, controls,
  detection → session loop, starting and finishing recordings, live picture or replay with the
  small draggable live picture, person boxes in `PersonBox.tsx`);
  `LiveControls.tsx`, `ZoneEditor.tsx`, `StartHint.tsx`, `Settings.tsx`, `ClipStrip.tsx`,
  `ClipPlayer.tsx` (with `Timeline.tsx`, `SkeletonOverlay.tsx`) as in the web app;
  `theme.ts` shared colours and the floating style.
- `src/hooks/`: `use-pose-detection.ts` frame output, the frame worklet (detection and stills),
  model loading and the lite fallback; `use-clips.ts` the clip list and background skeleton;
  `use-drag-spot.ts` the movable live picture.
- `src/lib/`: `settings.ts` settings storage, `recording.ts` starting and finishing clips and
  the pre-roll's poses and stills,
  `clip-store.ts` clip folders, stored skeleton progress and export, `skeleton.ts` the replay
  skeleton's job queue, `app-version.ts` the build's commit.

`packages/native-modules/` (Android only): Nitro specs in `src/specs/`, Kotlin in
`android/src/main/java/com/margelo/nitro/nomol/` (`HybridPoseLandmarker.kt` also saves stills,
`HybridSkeletonLandmarker.kt` the replay skeleton's views, `Landmarkers.kt` model loading
shared by both, `HybridClipRecorder.kt`, `SampleBuffer.kt` and `CameraClock.kt` the recording,
`HybridStartSound.kt` (its `ToneGenerator` created on the first beep; a failure only costs the beep),
`HybridFileShare.kt`), JVM unit tests in `android/src/test/`, model download in
`android/build.gradle`.

`apps/web/app/` (paths below are relative to it):

- `lib/detection/`: MediaPipe itself: `pose-detector.client.ts` (models, lite fallback) talking
  to `pose.worker.ts`.
- `components/Tablet.tsx`: the screen. Runs the camera → detection → session loop, starts
  and finishes recordings, switches between live picture and replay.
- `components/LiveControls.tsx`, `Settings.tsx`, `StartHint.tsx`, `LoadingScreen.tsx`: the
  bar over the live picture, the settings dialog, the start hint, the loading/error screen.
- `components/ClipPlayer.tsx`, `ClipStrip.tsx`, `ZoneEditor.tsx`: replay, clip list, coach
  zone drawing.
- `hooks/`: `use-clips` (clip list, storage, background skeleton), `use-pose-detector`
  (MediaPipe loading), `use-tap-effects` (fullscreen and sound need a tap), camera hooks.
- `lib/recording/`: recorder, pre-roll, storage, export. `capture.client.ts` gathers poses,
  skeleton frames and stills while recording and turns them into a clip.
- `lib/skeleton/`: replay skeleton. `skeleton.worker.ts` MediaPipe on the turned views,
  `refiner.client.ts` frame capture and the job queue.

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
  people walking or running around than the first rule. Tracing the runner back over the
  pre-roll by nearest skeleton put the girl by the springboard into every frame of the wait (29
  at 30 detections per second) and the replay showed her; following the same trail as the start
  (gaps filled with the skeleton nearest the path) took 0–1 such frames at 3–30 per second.
- Rings (November 2026: 13 exports and three phone videos, a busy hall, MediaPipe on frames at
  10 per second): a gymnast at the back of the hall (torso ~0.08 image heights) showing the sign
  was found in 64 of 89 frames of the whole picture, in 88 cropped around the start zone. The
  swinging gymnast is often not found while blurred at the bottom of the swing, even cropped,
  and a swing left the picture at the side for up to 1.2 s; the walk-out rule at the side
  (`SIDE_TORSOS`) then refused him 0.26 further in and the recording stopped mid-swing.
  Walking measured ~2–2.5 torso lengths per second, swinging and running 5–12; "Auto bei Tempo"
  at 3 started on someone walking past, at 4 not. Its trail in any direction hopped between
  people waiting in a row, each detected in turn, and 0.8 s back across the picture; such
  sightings are refused when someone of the same size is still at the earlier spot or was
  already at the later one (`hopped`). On the five Sprung traces (every frame offset at 4–30
  detections per second) this cost left/right 3 of 125 starts, all at ≤ 10 per second, and
  mirrored false starts went from 29 to 26. "Auto bei Tempo" there starts reliably only from
  10 per second: part of a Sprung run-up comes towards the camera.
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
`button` or `runUp`, `runUp` the automatic start setting (`left`, `right`, `any` or null); all three are
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

## Building and testing the Android app

- `pnpm android:build` (from the root) runs `expo prebuild` and Gradle `assembleRelease` for
  arm64 only; the APK is `apps/native/android/app/build/outputs/apk/release/app-release.apk`,
  signed with the debug key, so it installs directly. `JAVA_HOME` defaults to
  `/usr/lib/jvm/java-21-openjdk` and `ANDROID_HOME` to `/opt/android-sdk`. Use Node 24
  (`nvm use`); the shell's default Node may be older. After changing `app.config.ts` or native
  dependencies, `pnpm --filter @nomol/native prebuild --clean` regenerates `android/`.
- The owner's test phone is a Pixel 8 over USB (`adb devices`: `37250DLJH000KS`).
  `pnpm android:install` installs the APK; then
  `adb shell pm grant ch.nomol.app android.permission.CAMERA`,
  `adb shell monkey -p ch.nomol.app 1` to launch, `adb exec-out screencap -p > shot.png` for
  screenshots (keep them outside the repo). Don't touch other apps or the phone's settings.
  The phone locks 30 s after the app leaves the foreground (force-stop, install), and only the
  owner can unlock it. Installing while the app is open makes Android 16 start the activity
  anew (`PackageUpdateActivity`, `FLAG_ACTIVITY_CLEAR_TASK`): the old screen goes away after
  the new one is up in the same JS runtime, so `App.tsx` lets only the newest screen hold the
  camera (VisionCamera's teardown unbinds all cameras) and keep the screen on.
- Release builds aren't minified (`enableMinifyInReleaseBuilds: false`): R8 broke MediaPipe,
  which reads protobuf fields and its logger's callers by name. Nitro creates the Hybrid
  classes by name from C++, so they carry `@Keep @DoNotStrip` (as VisionCamera's do) should
  minifying come back.
  Clips live in the app's private storage; `run-as ch.nomol.app ls files/clips` needs a
  debuggable APK (add `debuggable true` to the release build type in the generated
  `android/app/build.gradle` for a local test build only; it makes the app slower).
- Typecheck and lint cover the native app; there are no tests for it yet. Logic worth testing
  belongs in core. The Kotlin module's pure parts have JVM tests, not part of the root checks:
  in `apps/native/android` (after a build), `./gradlew :nomol_native-modules:testDebugUnitTest`
  with `JAVA_HOME` and `ANDROID_HOME` set.

## Conventions

- Routes are declared in `apps/web/app/routes.ts` (no file-system routing).
- In the web app, path alias `~/*` maps to `apps/web/app/*`; core is imported as
  `@nomol/core/...`, and imports inside core are relative. Use `import type` for type-only
  imports.
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
