import { useEffect, useEffectEvent, useRef, useState } from 'react';
import ClipPlayer from '~/components/ClipPlayer';
import ClipStrip from '~/components/ClipStrip';
import FloorLineNote from '~/components/FloorLineNote';
import LiveControls, { type Status } from '~/components/LiveControls';
import LoadingScreen from '~/components/LoadingScreen';
import Settings from '~/components/Settings';
import ZoneEditor from '~/components/ZoneEditor';
import useCamera from '~/hooks/use-camera';
import useCameras from '~/hooks/use-cameras';
import useClips from '~/hooks/use-clips';
import useDragSpot from '~/hooks/use-drag-spot';
import useElementSize from '~/hooks/use-element-size';
import usePoseDetector from '~/hooks/use-pose-detector';
import useTapEffects from '~/hooks/use-tap-effects';
import useWakeLock from '~/hooks/use-wake-lock';
import useWideAngle from '~/hooks/use-wide-angle';
import { loadCameraId, saveCameraId } from '~/lib/camera-choice';
import type { Pose } from '@nomol/core/detection/pose';
import {
  gymnastArea,
  initialSession,
  step,
  type RunUp,
  type SessionState,
} from '@nomol/core/detection/session';
import { detectionAreas, isInZone, type Zone } from '@nomol/core/detection/zone';
import { drawPersonBox, drawStartSign, drawZone, prepareCanvas } from '~/lib/draw';
import {
  addPreroll,
  beginRecording,
  recordPose,
  recordStill,
  rememberFrame,
  toClip,
  type ActiveRecording,
  type Seen,
} from '~/lib/recording/capture.client';
import { startPreroll, type Preroll } from '~/lib/recording/preroll.client';
import { startRecording } from '~/lib/recording/recorder.client';
import { loadSoundOn, playStartSound, saveSoundOn } from '~/lib/sound.client';
import { cn } from 'cn';
import { loadRunUp, loadZones, saveRunUp, saveZones } from '~/lib/zone-storage';
import { DEFAULT_ZONE } from '@nomol/core/settings';
import { screenLayout } from '@nomol/core/layout';
import type { Clip } from '@nomol/core/recording/clip';
import { learnFloor, type FloorHint } from '@nomol/core/recording/floor-line';

/** After "Aufnahme starten", wait this long for someone to step into the start zone. */
const ARMED_TIMEOUT_MS = 20_000;

/**
 * The screen: runs camera → detection → session, records, and switches between the live
 * picture and the replay.
 */
export default function Tablet() {
  // Not rendered into the HTML, so reading local storage on the first client render is safe.
  const [cameraId, setCameraId] = useState<string | null>(() =>
    typeof window === 'undefined' ? null : loadCameraId(),
  );
  const camera = useCamera(cameraId);
  const cameras = useCameras(camera.status === 'ready');
  const wideAngle = useWideAngle(camera.status === 'ready' ? camera.stream : null);
  const poseDetector = usePoseDetector();
  const { detector } = poseDetector;
  const {
    clips,
    skeletonProgress,
    add: addClip,
    remove: removeClip,
    removeAll: removeAllClips,
    pauseSkeleton,
  } = useClips(detector);
  useTapEffects();
  useWakeLock();

  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const sessionRef = useRef<SessionState>(initialSession);
  const activeRef = useRef<ActiveRecording | null>(null);
  const prerollRef = useRef<Preroll | null>(null);
  const seenRef = useRef<Seen[]>([]);
  /** Where detection looks (`detectionAreas`); the whole picture until the first frame. */
  const areasRef = useRef<Zone[]>([{ left: 0, top: 0, right: 1, bottom: 1 }]);
  /** Capture time of the last detected frame: where a recording stopped by hand ends. */
  const lastFrameTimeRef = useRef(0);
  const clipStripScrollRef = useRef(0);

  const [zones, setZones] = useState<Zone[]>(() =>
    typeof window === 'undefined' ? [DEFAULT_ZONE] : loadZones(),
  );
  const [runUp, setRunUp] = useState<RunUp | null>(() =>
    typeof window === 'undefined' ? null : loadRunUp(),
  );
  const [armedAt, setArmedAt] = useState<number | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [view, setView] = useState<'live' | 'replay'>('live');
  const [editingZone, setEditingZone] = useState(false);
  /** Recent `floorHint`s per zone; forgotten when the zones are drawn anew. */
  const floorHintsRef = useRef<FloorHint[][]>([]);
  /** The zones before the floor line last moved by itself, while that can be undone. */
  const [floorUndo, setFloorUndo] = useState<Zone[] | null>(null);
  const [aspectRatio, setAspectRatio] = useState(16 / 9);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [soundOn, setSoundOn] = useState(() =>
    typeof window === 'undefined' ? true : loadSoundOn(),
  );
  /** The small live picture over the replay can be moved off the part the coach looks at. */
  const livePictureRef = useRef<HTMLDivElement>(null);
  const livePicture = useDragSpot();
  const [screen, observeScreen] = useElementSize();
  /** Below the picture the strip is as high as its controls; this measures them. */
  const [strip, observeStrip] = useElementSize();
  /** In the strip, where the zone editor's bar goes. */
  const [stripSlot, setStripSlot] = useState<HTMLDivElement | null>(null);

  const current = clips.find((clip) => clip.id === currentId) ?? null;
  const showReplay = view === 'replay' && current !== null && !editingZone;
  const recording = status === 'recording';
  const layout = screenLayout(screen.width, screen.height, aspectRatio, strip.height);
  // The replay fills the screen with its controls over it, so nothing is docked meanwhile.
  const dock = showReplay ? null : layout.dock;

  useEffect(() => {
    const video = videoRef.current;
    if (camera.status !== 'ready' || !video) return;
    video.srcObject = camera.stream;
    void video.play();
  }, [camera]);

  useEffect(() => {
    if (armedAt === null) return;
    const timer = setTimeout(() => setArmedAt(null), ARMED_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [armedAt]);

  const onRecording = useEffectEvent(pauseSkeleton);
  useEffect(() => onRecording(recording), [recording]);

  // Automatic starts come late (see `startPreroll`), so recorders run ahead while waiting.
  useEffect(() => {
    if (!runUp || camera.status !== 'ready' || !detector || editingZone || recording) return;
    const preroll = startPreroll(camera.stream);
    prerollRef.current = preroll;
    return () => {
      prerollRef.current = null;
      seenRef.current = [];
      preroll.close();
    };
  }, [runUp, camera, detector, editingZone, recording]);

  function updateAspectRatio({ videoWidth, videoHeight }: HTMLVideoElement) {
    if (videoWidth && videoHeight) setAspectRatio(videoWidth / videoHeight);
  }

  async function finishRecording(time: number) {
    const active = activeRef.current;
    if (!active) return;
    activeRef.current = null;
    const blob = await active.recording.stop();
    const { clip, routine } = toClip(active, blob, time);
    adjustFloor(clip);
    addClip(clip, blob, active.samples, routine);
    setCurrentId(clip.id);
    setView('replay');
  }

  /** Moves the floor line of the zone the clip started in up to where gymnasts stand. */
  function adjustFloor(clip: Clip) {
    const learned = learnFloor(zones, clip.zone, clip, floorHintsRef.current);
    floorHintsRef.current = learned.hints;
    if (!learned.zones) return;
    saveZones(learned.zones);
    setZones(learned.zones);
    setFloorUndo(zones);
  }

  /**
   * @param frame the camera frame the poses were detected in
   * @param time when the camera captured the frame
   * @param deliveredAt when the frame reached the page, before detection ran on it
   */
  const onFrame = useEffectEvent(
    (frame: VideoFrame, time: number, deliveredAt: number, poses: Pose[]) => {
      lastFrameTimeRef.current = time;
      const result = step(sessionRef.current, {
        time,
        poses,
        zones,
        armed: armedAt !== null,
        runUp,
        aspectRatio,
      });
      sessionRef.current = result.state;

      if (result.event?.type === 'start' && camera.status === 'ready') {
        const preroll = prerollRef.current?.take() ?? null;
        prerollRef.current = null;
        const started = preroll ?? {
          recording: startRecording(camera.stream),
          startedAt: performance.now(),
        };
        // A recorder only receives frames delivered after it started. Those were captured one
        // delivery latency earlier, so the video's time 0 is its start minus that latency.
        // Measured against the replay this lines up within a frame.
        const active = beginRecording(
          started.recording,
          started.startedAt - (deliveredAt - time),
          result.event.zone,
          aspectRatio,
          { startReason: result.event.reason, runUp },
        );
        activeRef.current = active;
        if (preroll) addPreroll(active, seenRef.current, result.event.pose, poses, time);
        if (soundOn) playStartSound();
        setArmedAt(null);
      } else if (prerollRef.current) {
        seenRef.current = rememberFrame(seenRef.current, frame, time, poses);
      }
      const active = activeRef.current;
      if (active) {
        if (result.target) recordPose(active, frame, time, result.target);
        recordStill(active, frame, time);
      }
      if (result.event?.type === 'stop') void finishRecording(time);
      areasRef.current = detectionAreas(
        zones,
        aspectRatio,
        gymnastArea(result.state, aspectRatio),
        runUp !== null,
      );

      setStatus(
        activeRef.current
          ? 'recording'
          : armedAt !== null
            ? 'armed'
            : result.state.kind === 'idle' &&
                result.state.signSince !== null &&
                !result.state.waitForRelease
              ? 'sign'
              : 'idle',
      );

      const canvas = overlayRef.current;
      const surface = canvas && prepareCanvas(canvas);
      if (!surface) return;
      const { ctx, width, height } = surface;
      for (const zone of zones) {
        drawZone(ctx, zone, width, height);
        if (!activeRef.current && !runUp) {
          drawStartSign(ctx, zone, width, height, performance.now());
        }
      }
      if (activeRef.current && result.target) {
        drawPersonBox(ctx, result.target, width, height, '#ff6b70', 'Aufnahme');
      } else if (!activeRef.current) {
        for (const pose of poses.filter((p) => zones.some((zone) => isInZone(p, zone)))) {
          drawPersonBox(ctx, pose, width, height, '#5ee6c8', 'In Startzone');
        }
      }
    },
  );

  const onDetectionFailed = useEffectEvent(poseDetector.fail);

  useEffect(() => {
    // Paused while the coach draws the zone, so nobody starts a recording in the meantime.
    if (!detector || camera.status !== 'ready' || editingZone) return;
    const running = detector;
    const video = videoRef.current;
    const overlay = overlayRef.current;
    if (!video) return;
    type Waiting = { frame: VideoFrame; time: number; deliveredAt: number };
    let handle = 0;
    let lastTime = -Infinity;
    let busy = false;
    let stopped = false;
    /** The newest frame that arrived during a detection, detected right after it. */
    let waiting: Waiting | null = null;

    function detect({ frame, time, deliveredAt }: Waiting) {
      busy = true;
      running
        .detect(frame, time, areasRef.current)
        .then(({ frame: detected, poses }) => {
          if (!stopped) onFrame(detected, time, deliveredAt, poses);
          detected.close();
        })
        .catch((_error: unknown) => {
          // MediaPipe needs WebGL even on the CPU; without it every frame fails.
          if (!stopped) onDetectionFailed();
          stopped = true;
          video!.cancelVideoFrameCallback(handle);
        })
        .finally(() => {
          busy = false;
          const next = waiting;
          waiting = null;
          if (next && !stopped) detect(next);
          else next?.frame.close();
        });
    }

    // Runs once per new camera frame. Frames are timed by when the camera captured them, not
    // when detection gets to them, so the replay skeleton lines up with the recorded video.
    function onVideoFrame(deliveredAt: number, metadata: VideoFrameCallbackMetadata) {
      handle = video!.requestVideoFrameCallback(onVideoFrame);
      const time = metadata.captureTime ?? metadata.presentationTime;
      // MediaPipe requires strictly increasing timestamps.
      if (time <= lastTime) return;
      lastTime = time;
      const frame = { frame: new VideoFrame(video!), time, deliveredAt };
      if (!busy) return detect(frame);
      waiting?.frame.close();
      waiting = frame;
    }
    handle = video.requestVideoFrameCallback(onVideoFrame);
    return () => {
      stopped = true;
      waiting?.frame.close();
      waiting = null;
      video.cancelVideoFrameCallback(handle);
      // Stopping only happens outside a recording (the zone button is disabled during one), so
      // a half-held sign can be dropped, and the last boxes would otherwise stay on screen.
      sessionRef.current = initialSession;
      if (overlay) prepareCanvas(overlay);
    };
  }, [detector, camera.status, editingZone]);

  const loading =
    camera.status === 'error'
      ? camera.message
      : poseDetector.failed
        ? 'Die Erkennung läuft nicht. Prüfe die Internetverbindung, nutze einen aktuellen Browser und lade die Seite neu.'
        : camera.status === 'starting'
          ? 'Kamera startet …'
          : !detector
            ? poseDetector.progress === null || poseDetector.progress === 100
              ? 'Erkennung startet …'
              : 'Erkennung wird geladen …'
            : null;
  // Only the first visit downloads the model (~30 MB); after that it comes from the cache.
  const downloadProgress =
    !detector &&
    !poseDetector.failed &&
    poseDetector.progress !== null &&
    poseDetector.progress < 100
      ? poseDetector.progress
      : null;

  const clipStrip = (
    <ClipStrip
      clips={clips}
      currentId={showReplay ? currentId : null}
      scrollLeftRef={clipStripScrollRef}
      onSelect={(clip) => {
        setCurrentId(clip.id);
        setView('replay');
      }}
    />
  );

  // A `contents` box: what's portalled into it takes part in the strip's own layout.
  const slot = editingZone && <div ref={setStripSlot} className="contents" />;

  const bar = (
    <LiveControls
      dock={dock}
      status={status}
      runUp={runUp}
      onRunUp={(next) => {
        saveRunUp(next);
        setRunUp(next);
      }}
      editingZone={editingZone}
      onEditZone={(editing) => {
        setEditingZone(editing);
        setView('live');
        if (editing) {
          setArmedAt(null);
          setStatus('idle');
        }
      }}
      armed={armedAt !== null}
      canArm={detector !== null}
      onArm={(armed) => setArmedAt(armed ? Date.now() : null)}
      onStop={() => {
        // Back to waiting for a start, as after a stop by sign, idling or leaving.
        sessionRef.current = initialSession;
        setStatus('idle');
        void finishRecording(lastFrameTimeRef.current);
      }}
      onSettings={() => setSettingsOpen(true)}
      replay={showReplay}
      clips={clips}
      onClips={() => {
        setCurrentId(clips[0].id);
        setView('replay');
      }}
    >
      {slot}
    </LiveControls>
  );

  return (
    <div ref={observeScreen} className="relative h-dvh overflow-hidden bg-black text-slate-100">
      {showReplay && current && (
        <ClipPlayer
          key={current.id}
          clip={current}
          clipStrip={clipStrip}
          skeletonProgress={skeletonProgress[current.id] ?? null}
          onLive={() => setView('live')}
          onDelete={() => {
            const remaining = removeClip(current);
            setCurrentId(remaining[0]?.id ?? null);
            if (remaining.length === 0) setView('live');
          }}
        />
      )}

      {/*
        One video element throughout, only moved: the camera stream and the detection loop are
        attached to it. Over the replay it's small and can be dragged anywhere.
      */}
      <div
        ref={livePictureRef}
        className={cn(
          'absolute',
          showReplay &&
            'z-10 w-1/3 overflow-hidden rounded-lg border-2 border-white/25 shadow-2xl sm:w-1/4',
          showReplay && !livePicture.style && 'top-24 right-3 sm:top-16',
        )}
        style={showReplay ? livePicture.style : layout.picture}
      >
        <div
          className="relative"
          style={showReplay ? { aspectRatio, width: '100%' } : { width: '100%', height: '100%' }}
        >
          <video
            ref={videoRef}
            className="absolute inset-0 h-full w-full"
            muted
            playsInline
            onLoadedMetadata={(event) => updateAspectRatio(event.currentTarget)}
            // Turning the phone swaps the camera picture between portrait and landscape.
            onResize={(event) => updateAspectRatio(event.currentTarget)}
          />
          <canvas ref={overlayRef} className="pointer-events-none absolute inset-0 h-full w-full" />
          {editingZone && (
            <ZoneEditor
              zones={zones}
              dock={dock && stripSlot}
              onCancel={() => setEditingZone(false)}
              onSave={(next) => {
                saveZones(next);
                setZones(next);
                setEditingZone(false);
                floorHintsRef.current = [];
                setFloorUndo(null);
              }}
            />
          )}
          {showReplay && (
            <button
              type="button"
              aria-label="Live-Bild gross anzeigen, zum Verschieben ziehen"
              onPointerDown={(event) => livePicture.onPointerDown(event, livePictureRef.current)}
              onPointerMove={livePicture.onPointerMove}
              onClick={() => {
                if (!livePicture.wasDragged()) setView('live');
              }}
              className="absolute inset-0 cursor-move touch-none"
            >
              <span
                className={cn(
                  'absolute top-2 left-2 rounded bg-black/70 px-2 py-0.5 text-xs font-semibold',
                  recording ? 'text-red-300' : 'text-emerald-300',
                )}
              >
                {recording ? '● Live · Aufnahme' : 'Live'}
              </span>
            </button>
          )}
        </div>
      </div>

      {/*
        Docked: the strip beside or below the picture. Its width decides whether rows join into
        lines (`@container`). Below the picture it takes its controls' height, measured for
        `screenLayout`, up to what's left beside the picture; beyond that its middle scrolls.
      */}
      {dock && layout.strip ? (
        <div
          ref={observeStrip}
          className={cn(
            '@container absolute flex flex-col gap-2 bg-zinc-950',
            dock === 'side' ? 'border-l border-white/10 p-2' : 'border-t border-white/10 p-3',
          )}
          style={
            dock === 'side'
              ? layout.strip
              : {
                  left: layout.strip.left,
                  top: layout.strip.top,
                  width: layout.strip.width,
                  maxHeight: screen.height - layout.picture.height,
                }
          }
        >
          {bar}
        </div>
      ) : (
        bar
      )}

      <Settings
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        recording={recording}
        cameras={cameras}
        cameraId={
          camera.status === 'ready'
            ? camera.stream.getVideoTracks()[0]?.getSettings().deviceId
            : undefined
        }
        onCamera={(deviceId) => {
          saveCameraId(deviceId);
          setCameraId(deviceId);
        }}
        wideAngle={wideAngle}
        soundOn={soundOn}
        onSound={(on) => {
          saveSoundOn(on);
          setSoundOn(on);
        }}
        clipCount={clips.length}
        onDeleteAll={() => {
          removeAllClips();
          setCurrentId(null);
          setView('live');
        }}
      />

      {floorUndo && !editingZone && (
        <FloorLineNote
          onUndo={() => {
            saveZones(floorUndo);
            setZones(floorUndo);
            // Otherwise the next landing would move it straight back.
            floorHintsRef.current = [];
            setFloorUndo(null);
          }}
          onClose={() => setFloorUndo(null)}
        />
      )}

      {loading && <LoadingScreen message={loading} progress={downloadProgress} />}
    </div>
  );
}
