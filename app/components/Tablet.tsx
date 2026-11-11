import { Camera, Circle, SquareDashed, Volume2 } from 'lucide-react';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import ClipPlayer from '~/components/ClipPlayer';
import ClipStrip from '~/components/ClipStrip';
import { Button } from '~/components/ui/button';
import { Progress } from '~/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select';
import { Toggle } from '~/components/ui/toggle';
import ZoneEditor from '~/components/ZoneEditor';
import useCamera from '~/hooks/use-camera';
import useCameras from '~/hooks/use-cameras';
import useWideAngle from '~/hooks/use-wide-angle';
import { loadCameraId, saveCameraId } from '~/lib/camera-choice';
import useWakeLock from '~/hooks/use-wake-lock';
import type { PoseDetector } from '~/lib/detection/pose-detector.client';
import type { Pose } from '~/lib/detection/pose';
import { initialSession, step, type SessionState } from '~/lib/detection/session';
import { isInZone, type Zone } from '~/lib/detection/zone';
import { drawPersonBox, drawStartSign, drawZone, prepareCanvas } from '~/lib/draw';
import { insertFrame, routineRange, type Clip, type ClipFrame } from '~/lib/recording/clip';
import { deleteClip, loadClips, saveClip, saveSkeleton } from '~/lib/recording/clip-store.client';
import { startRecording, type Recording } from '~/lib/recording/recorder.client';
import { captureThumbnail } from '~/lib/recording/thumbnail.client';
import {
  captureFrame,
  createSkeletonRefiner,
  frameSize,
  type SkeletonProgress,
  type SkeletonRefiner,
  type SkeletonSample,
} from '~/lib/skeleton/refiner.client';
import { cropAround } from '~/lib/skeleton/rtmpose';
import { playStartSound, unlockSound } from '~/lib/sound.client';
import { cn } from '~/lib/utils';
import { DEFAULT_ZONE, loadZone, saveZone } from '~/lib/zone-storage';

/** After "Aufnahme starten", wait this long for someone to step into the start zone. */
const ARMED_TIMEOUT_MS = 20_000;
/** Older clips are dropped to keep the tablet's memory in check. */
const MAX_CLIPS = 8;
/**
 * The clip's thumbnail should come from the middle of the routine, whose timing isn't known
 * in advance, so candidate stills are grabbed this often and one is picked at the end.
 */
const STILL_EVERY_MS = 500;
/**
 * How often a frame is saved for the RTMPose skeleton. 10 per second look smooth with
 * interpolation and keep the computation after a recording short.
 */
const SAMPLE_EVERY_MS = 100;
/** The fallback crop covers the gymnast's poses over this long (see `cropAround`). */
const CROP_WINDOW_MS = 500;
const SKELETON_MODELS = {
  pose: `${import.meta.env.BASE_URL}models/rtmpose-m.onnx`,
  detector: `${import.meta.env.BASE_URL}models/yolox-s.onnx`,
};

type Status = 'idle' | 'sign' | 'armed' | 'recording';

const STATUS_TEXT: Record<Status, string> = {
  idle: 'Bereit',
  sign: 'Zeichen erkannt …',
  armed: 'Warte auf Person in der Startzone',
  recording: 'Aufnahme läuft',
};

const STATUS_STYLE: Record<Status, string> = {
  idle: 'text-emerald-300',
  sign: 'text-amber-300',
  armed: 'text-amber-300',
  recording: 'text-red-300',
};

type ActiveRecording = {
  recording: Recording;
  startedAt: number;
  startedDate: Date;
  frames: ClipFrame[];
  stills: { time: number; url: string }[];
  samples: SkeletonSample[];
  zone: Zone;
  aspectRatio: number;
};

/** Controls float over the camera image, so they get a dark, blurred backing. */
const floating =
  'rounded-full bg-black/60 font-semibold backdrop-blur hover:bg-black/75 data-[state=on]:bg-black/75 data-[state=on]:text-sky-300';

export default function Tablet() {
  // Not rendered into the HTML, so reading local storage on the first client render is safe.
  const [cameraId, setCameraId] = useState<string | null>(() =>
    typeof window === 'undefined' ? null : loadCameraId(),
  );
  const camera = useCamera(cameraId);
  const cameras = useCameras(camera.status === 'ready');
  const activeCameraId =
    camera.status === 'ready'
      ? camera.stream.getVideoTracks()[0]?.getSettings().deviceId
      : undefined;
  const wideAngle = useWideAngle(camera.status === 'ready' ? camera.stream : null);
  useWakeLock();

  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const thumbnailCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const sessionRef = useRef<SessionState>(initialSession);
  const activeRef = useRef<ActiveRecording | null>(null);
  const refinerRef = useRef<SkeletonRefiner | null>(null);
  /** Clips deleted or dropped, so their skeleton computation stops. */
  const removedRef = useRef(new Set<string>());
  const [skeletonProgress, setSkeletonProgress] = useState<Record<string, SkeletonProgress>>({});

  const [detector, setDetector] = useState<PoseDetector | null>(null);
  const [detectorError, setDetectorError] = useState(false);
  /** Download progress of the detection model in percent; null until it is known. */
  const [modelProgress, setModelProgress] = useState<number | null>(null);
  // Local storage only exists in the browser. The zone is never rendered into the HTML, so
  // reading it during the first client render causes no hydration mismatch.
  const [zone, setZone] = useState<Zone>(() =>
    typeof window === 'undefined' ? DEFAULT_ZONE : loadZone(),
  );
  const [armedAt, setArmedAt] = useState<number | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [clips, setClips] = useState<Clip[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [view, setView] = useState<'live' | 'replay'>('live');
  const [editingZone, setEditingZone] = useState(false);
  const [aspectRatio, setAspectRatio] = useState(16 / 9);
  const [soundReady, setSoundReady] = useState(false);

  const current = clips.find((clip) => clip.id === currentId) ?? null;
  const showReplay = view === 'replay' && current !== null && !editingZone;

  useEffect(() => {
    const video = videoRef.current;
    if (camera.status !== 'ready' || !video) return;
    video.srcObject = camera.stream;
    void video.play();
  }, [camera]);

  useEffect(() => {
    let created: PoseDetector | null = null;
    let cancelled = false;
    import('~/lib/detection/pose-detector.client')
      // A cancelled load (e.g. React's double effect in development) keeps downloading; its
      // progress must not mix with the current one.
      .then((module) =>
        module.createPoseDetector((percent) => {
          if (!cancelled) setModelProgress(percent);
        }),
      )
      .then((result) => {
        if (cancelled) return result.close();
        created = result;
        setDetector(result);
      })
      .catch((_error: unknown) => setDetectorError(true));
    return () => {
      cancelled = true;
      created?.close();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadClips()
      .then((stored) => {
        if (cancelled) return stored.forEach((clip) => URL.revokeObjectURL(clip.url));
        // Clips recorded while loading come first; the list stays newest-first.
        setClips((recorded) => [...recorded, ...stored].slice(0, MAX_CLIPS));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => () => refinerRef.current?.close(), []);

  useEffect(() => {
    if (armedAt === null) return;
    const timer = setTimeout(() => setArmedAt(null), ARMED_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [armedAt]);

  // Sound may only start after a touch, so unlock it on the first one anywhere on the screen.
  useEffect(() => {
    function unlock() {
      void unlockSound().then(setSoundReady);
    }
    window.addEventListener('pointerdown', unlock, { once: true });
    return () => window.removeEventListener('pointerdown', unlock);
  }, []);

  // The browser's address bar takes much of a phone's height. Fullscreen needs a tap, so every
  // tap restores it, e.g. after the share sheet or the back gesture. iPhones don't support it.
  useEffect(() => {
    function enterFullscreen() {
      if (document.fullscreenElement || !document.fullscreenEnabled) return;
      void document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
    }
    window.addEventListener('pointerdown', enterFullscreen);
    return () => window.removeEventListener('pointerdown', enterFullscreen);
  }, []);

  async function finishRecording(time: number) {
    const active = activeRef.current;
    if (!active) return;
    activeRef.current = null;
    const blob = await active.recording.stop();
    const durationMs = time - active.startedAt;
    const { startMs, endMs } = routineRange({ ...active, durationMs });
    const target = (startMs + endMs) / 2;
    const middle = active.stills.reduce<(typeof active.stills)[number] | null>(
      (best, still) =>
        !best || Math.abs(still.time - target) < Math.abs(best.time - target) ? still : best,
      null,
    );
    const clip: Clip = {
      id: crypto.randomUUID(),
      url: URL.createObjectURL(blob),
      startedAt: active.startedDate,
      durationMs,
      frames: active.frames,
      skeleton: [],
      thumbnail: middle?.url ?? null,
      zone: active.zone,
      aspectRatio: active.aspectRatio,
    };
    setClips((previous) => {
      for (const old of previous.slice(MAX_CLIPS - 1)) {
        removedRef.current.add(old.id);
        URL.revokeObjectURL(old.url);
        void deleteClip(old.id).catch(() => {});
      }
      return [clip, ...previous].slice(0, MAX_CLIPS);
    });
    setCurrentId(clip.id);
    setView('replay');
    // A full or blocked storage only means the clip won't survive a reload.
    void saveClip(clip, blob).catch(() => {});
    computeSkeleton(clip, active.samples, { startMs, endMs });
  }

  /** Runs RTMPose on the saved frames in the background and fills in the clip's skeleton. */
  function computeSkeleton(
    clip: Clip,
    samples: SkeletonSample[],
    first: { startMs: number; endMs: number },
  ) {
    if (samples.length === 0) return;
    refinerRef.current ??= createSkeletonRefiner(SKELETON_MODELS);
    let skeleton: ClipFrame[] = [];
    const setProgress = (progress: SkeletonProgress | null) =>
      setSkeletonProgress((previous) => {
        const { [clip.id]: _done, ...others } = previous;
        return progress ? { ...others, [clip.id]: progress } : others;
      });
    refinerRef.current
      .refine({
        samples,
        first,
        onFrame(frame) {
          skeleton = insertFrame(skeleton, frame);
          setClips((previous) => previous.map((c) => (c.id === clip.id ? { ...c, skeleton } : c)));
        },
        onProgress: setProgress,
        isCancelled: () => removedRef.current.has(clip.id),
      })
      .then(() => {
        setProgress(null);
        if (!removedRef.current.has(clip.id)) void saveSkeleton(clip.id, skeleton).catch(() => {});
      })
      .catch(() => setProgress({ stage: 'failed', percent: 0 }));
  }

  /** Call after adding the current frame to `active.frames`. */
  function recordSample(active: ActiveRecording, time: number) {
    const video = videoRef.current;
    const now = time - active.startedAt;
    const last = active.samples[active.samples.length - 1];
    if (!video || (last && now - last.time < SAMPLE_EVERY_MS)) return;
    const recent = active.frames.filter((frame) => frame.time >= now - CROP_WINDOW_MS);
    const { width, height } = frameSize(video);
    active.samples.push({
      time: now,
      image: captureFrame(video),
      tracked: recent[recent.length - 1].pose,
      fallback: cropAround(
        recent.map((frame) => frame.pose),
        width,
        height,
      ),
    });
  }

  function recordStill(active: ActiveRecording, time: number) {
    const video = videoRef.current;
    const last = active.stills[active.stills.length - 1];
    if (!video || (last && time - active.startedAt - last.time < STILL_EVERY_MS)) return;
    thumbnailCanvasRef.current ??= document.createElement('canvas');
    active.stills.push({
      time: time - active.startedAt,
      url: captureThumbnail(video, thumbnailCanvasRef.current),
    });
  }

  /**
   * @param time when the camera captured the frame
   * @param deliveredAt when the frame reached the page, before detection ran on it
   */
  const onFrame = useEffectEvent((time: number, deliveredAt: number, poses: Pose[]) => {
    const result = step(sessionRef.current, {
      time,
      poses,
      zone,
      armed: armedAt !== null,
      aspectRatio,
    });
    sessionRef.current = result.state;

    if (result.event?.type === 'start' && camera.status === 'ready') {
      activeRef.current = {
        recording: startRecording(camera.stream),
        // The recorder only receives frames delivered from now on. Those were captured one
        // delivery latency earlier, so the video's time 0 is the trigger frame's capture time
        // plus the time detection took. Measured against the replay this lines up within a frame.
        startedAt: time + (performance.now() - deliveredAt),
        startedDate: new Date(),
        frames: [],
        stills: [],
        samples: [],
        zone,
        aspectRatio,
      };
      playStartSound();
      setArmedAt(null);
    }
    const active = activeRef.current;
    if (active) {
      if (result.target) {
        active.frames.push({ time: time - active.startedAt, pose: result.target });
        recordSample(active, time);
      }
      recordStill(active, time);
    }
    if (result.event?.type === 'stop') void finishRecording(time);

    const next: Status = activeRef.current
      ? 'recording'
      : armedAt !== null
        ? 'armed'
        : result.state.kind === 'idle' &&
            result.state.signSince !== null &&
            !result.state.waitForRelease
          ? 'sign'
          : 'idle';
    setStatus(next);

    const canvas = overlayRef.current;
    const surface = canvas && prepareCanvas(canvas);
    if (!surface) return;
    const { ctx, width, height } = surface;
    drawZone(ctx, zone, width, height);
    if (!activeRef.current) drawStartSign(ctx, zone, width, height, performance.now());
    if (activeRef.current && result.target) {
      drawPersonBox(ctx, result.target, width, height, '#ff6b70', 'Aufnahme');
    } else if (!activeRef.current) {
      for (const pose of poses.filter((p) => isInZone(p, zone))) {
        drawPersonBox(ctx, pose, width, height, '#5ee6c8', 'In Startzone');
      }
    }
  });

  useEffect(() => {
    // Paused while the coach draws the zone, so nobody starts a recording in the meantime.
    if (!detector || camera.status !== 'ready' || editingZone) return;
    const poseDetector = detector;
    const video = videoRef.current;
    const overlay = overlayRef.current;
    if (!video) return;
    let handle = 0;
    let lastTime = -Infinity;
    // Runs once per new camera frame. Frames are timed by when the camera captured them, not
    // when detection gets to them, so the replay skeleton lines up with the recorded video.
    function onVideoFrame(deliveredAt: number, metadata: VideoFrameCallbackMetadata) {
      const time = metadata.captureTime ?? metadata.presentationTime;
      // MediaPipe requires strictly increasing timestamps.
      if (time > lastTime) {
        lastTime = time;
        let poses: Pose[];
        try {
          poses = poseDetector.detect(video!, time);
        } catch (_error) {
          // MediaPipe needs WebGL even on the CPU; without it every frame fails.
          setDetectorError(true);
          return;
        }
        onFrame(time, deliveredAt, poses);
      }
      handle = video!.requestVideoFrameCallback(onVideoFrame);
    }
    handle = video.requestVideoFrameCallback(onVideoFrame);
    return () => {
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
      : detectorError
        ? 'Die Erkennung läuft nicht. Prüfe die Internetverbindung, nutze einen aktuellen Browser und lade die Seite neu.'
        : camera.status === 'starting'
          ? 'Kamera startet …'
          : !detector
            ? modelProgress === null || modelProgress === 100
              ? 'Erkennung startet …'
              : 'Erkennung wird geladen …'
            : null;
  // Only the first visit downloads the model (~30 MB); after that it comes from the cache.
  const downloading = !detector && !detectorError && modelProgress !== null && modelProgress < 100;

  const clipStrip = (
    <ClipStrip
      clips={clips}
      currentId={showReplay ? currentId : null}
      onSelect={(clip) => {
        setCurrentId(clip.id);
        setView('replay');
      }}
    />
  );

  return (
    <div className="relative h-dvh overflow-hidden bg-black text-slate-100">
      {showReplay && current && (
        <ClipPlayer
          key={current.id}
          clip={current}
          aspectRatio={aspectRatio}
          clipStrip={clipStrip}
          skeletonProgress={skeletonProgress[current.id] ?? null}
          onLive={() => setView('live')}
          onDelete={() => {
            removedRef.current.add(current.id);
            const remaining = clips.filter((clip) => clip.id !== current.id);
            URL.revokeObjectURL(current.url);
            void deleteClip(current.id).catch(() => {});
            setClips(remaining);
            setCurrentId(remaining[0]?.id ?? null);
            if (remaining.length === 0) setView('live');
          }}
        />
      )}

      <div
        className={
          showReplay
            ? 'absolute top-24 right-3 z-10 w-1/3 overflow-hidden rounded-lg border-2 border-white/25 shadow-2xl sm:top-16 sm:w-1/4'
            : 'absolute inset-0 flex items-center justify-center'
        }
      >
        <div
          className="relative"
          style={{
            aspectRatio,
            width: showReplay ? '100%' : `min(100%, calc(100dvh * ${aspectRatio}))`,
          }}
        >
          <video
            ref={videoRef}
            className="absolute inset-0 h-full w-full"
            muted
            playsInline
            onLoadedMetadata={(event) => {
              const { videoWidth, videoHeight } = event.currentTarget;
              if (videoWidth && videoHeight) setAspectRatio(videoWidth / videoHeight);
            }}
          />
          <canvas ref={overlayRef} className="pointer-events-none absolute inset-0 h-full w-full" />
          {editingZone && (
            <ZoneEditor
              zone={zone}
              onCancel={() => setEditingZone(false)}
              onSave={(next) => {
                saveZone(next);
                setZone(next);
                setEditingZone(false);
              }}
            />
          )}
          {showReplay && (
            <button
              type="button"
              aria-label="Live-Bild gross anzeigen"
              onClick={() => setView('live')}
              className="absolute inset-0"
            >
              <span
                className={`absolute top-2 left-2 rounded bg-black/70 px-2 py-0.5 text-xs font-semibold ${
                  status === 'recording' ? 'text-red-300' : 'text-emerald-300'
                }`}
              >
                {status === 'recording' ? '● Live · Aufnahme' : 'Live'}
              </span>
            </button>
          )}
        </div>
      </div>

      {/*
        One wrapping row, so the two groups stack instead of overlapping on narrow phones. Hidden
        while drawing the zone, whose own bar may need the top.
      */}
      <div
        className={cn(
          'pointer-events-none absolute inset-x-3 top-3 z-20 flex flex-wrap items-center justify-between gap-2 *:pointer-events-auto',
          editingZone && 'hidden',
        )}
      >
        <div className="flex items-center gap-2">
          <span
            className={cn(
              floating,
              'inline-flex h-8 items-center gap-2 px-3 text-sm',
              STATUS_STYLE[status],
            )}
          >
            <span aria-hidden className="size-2 rounded-full bg-current" />
            {STATUS_TEXT[status]}
          </span>
          {!soundReady && (
            <Button variant="ghost" size="sm" className={floating}>
              <Volume2 />
              Ton einschalten
            </Button>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          {cameras.length > 1 && (
            <Select
              value={activeCameraId ?? ''}
              disabled={status === 'recording'}
              onValueChange={(deviceId) => {
                saveCameraId(deviceId);
                setCameraId(deviceId);
              }}
            >
              <SelectTrigger
                size="sm"
                aria-label="Kamera"
                className={cn(floating, 'max-w-40 border-0 sm:max-w-52')}
              >
                <Camera />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {cameras.map((device, index) => (
                  <SelectItem key={device.deviceId} value={device.deviceId}>
                    {device.label || `Kamera ${index + 1}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {wideAngle.zoom !== undefined && (
            <Toggle
              size="sm"
              pressed={wideAngle.wide}
              disabled={status === 'recording'}
              onPressedChange={wideAngle.toggle}
              className={floating}
            >
              {`${wideAngle.zoom.toLocaleString('de-CH')}×`}
            </Toggle>
          )}
          <Toggle
            size="sm"
            pressed={editingZone}
            disabled={status === 'recording'}
            onPressedChange={(pressed) => {
              setEditingZone(pressed);
              setView('live');
              if (pressed) {
                setArmedAt(null);
                setStatus('idle');
              }
            }}
            className={floating}
          >
            <SquareDashed />
            Startzone
          </Toggle>
          <Button
            size="sm"
            variant={armedAt === null ? 'destructive' : 'ghost'}
            disabled={status === 'recording' || !detector || editingZone}
            onClick={() => setArmedAt(armedAt === null ? Date.now() : null)}
            className={cn('rounded-full', armedAt !== null && floating)}
          >
            {armedAt === null ? (
              <>
                <Circle className="fill-current" />
                Aufnahme starten
              </>
            ) : (
              'Abbrechen'
            )}
          </Button>
        </div>
      </div>

      {!showReplay && !editingZone && status === 'idle' && !loading && (
        <div
          className={`pointer-events-none absolute left-1/2 w-max max-w-[calc(100%-1.5rem)] -translate-x-1/2 rounded-xl bg-black/70 px-5 py-3 text-center backdrop-blur ${
            clips.length > 0 ? 'bottom-28' : 'bottom-6'
          }`}
        >
          <p className="text-lg font-semibold">Aufnehmen? Arme über dem Kopf kreuzen</p>
          <p className="text-sm text-slate-400">
            in der Startzone · zur Kamera schauen · 1 Sekunde halten
          </p>
        </div>
      )}

      {!showReplay && !editingZone && clips.length > 0 && (
        <div className="absolute inset-x-4 bottom-4 z-20">{clipStrip}</div>
      )}

      {loading && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-4 bg-black/70 p-6">
          <p className="max-w-md text-center text-lg">{loading}</p>
          {downloading && (
            <div className="flex w-full max-w-xs items-center gap-3">
              <Progress value={modelProgress} aria-label="Download der Erkennung" />
              <span className="w-12 shrink-0 text-right font-mono text-sm text-slate-300 tabular-nums">
                {modelProgress}&nbsp;%
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
