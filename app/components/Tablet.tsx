import { useEffect, useEffectEvent, useRef, useState } from 'react';
import ClipPlayer from '~/components/ClipPlayer';
import ClipStrip from '~/components/ClipStrip';
import ZoneEditor from '~/components/ZoneEditor';
import useCamera from '~/hooks/use-camera';
import useWakeLock from '~/hooks/use-wake-lock';
import type { PoseDetector } from '~/lib/detection/pose-detector.client';
import type { Pose } from '~/lib/detection/pose';
import { initialSession, step, type SessionState } from '~/lib/detection/session';
import { isInZone, type Zone } from '~/lib/detection/zone';
import { drawPersonBox, drawZone, prepareCanvas } from '~/lib/draw';
import type { Clip, ClipFrame } from '~/lib/recording/clip';
import { startRecording, type Recording } from '~/lib/recording/recorder.client';
import { captureThumbnail } from '~/lib/recording/thumbnail.client';
import { playStartSound, unlockSound } from '~/lib/sound.client';
import { DEFAULT_ZONE, loadZone, saveZone } from '~/lib/zone-storage';

/** After "Aufnahme starten", wait this long for someone to step into the start zone. */
const ARMED_TIMEOUT_MS = 20_000;
/** Older clips are dropped to keep the tablet's memory in check. */
const MAX_CLIPS = 8;
/**
 * The clip's thumbnail should come from the middle of the recording, whose length isn't known
 * in advance, so candidate stills are grabbed this often and one is picked at the end.
 */
const STILL_EVERY_MS = 500;

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
  zone: Zone;
  aspectRatio: number;
};

const floating =
  'rounded-full bg-black/60 px-3 py-1.5 text-xs font-semibold backdrop-blur disabled:opacity-40 sm:px-4 sm:py-2 sm:text-sm';

export default function Tablet() {
  const camera = useCamera();
  useWakeLock();

  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const thumbnailCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const sessionRef = useRef<SessionState>(initialSession);
  const activeRef = useRef<ActiveRecording | null>(null);

  const [detector, setDetector] = useState<PoseDetector | null>(null);
  const [detectorError, setDetectorError] = useState(false);
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
      .then((module) => module.createPoseDetector())
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

  async function finishRecording(time: number) {
    const active = activeRef.current;
    if (!active) return;
    activeRef.current = null;
    const blob = await active.recording.stop();
    const durationMs = time - active.startedAt;
    const middle = active.stills.reduce<(typeof active.stills)[number] | null>(
      (best, still) =>
        !best || Math.abs(still.time - durationMs / 2) < Math.abs(best.time - durationMs / 2)
          ? still
          : best,
      null,
    );
    const clip: Clip = {
      id: crypto.randomUUID(),
      url: URL.createObjectURL(blob),
      startedAt: active.startedDate,
      durationMs,
      frames: active.frames,
      thumbnail: middle?.url ?? null,
      zone: active.zone,
      aspectRatio: active.aspectRatio,
    };
    setClips((previous) => {
      previous.slice(MAX_CLIPS - 1).forEach((old) => URL.revokeObjectURL(old.url));
      return [clip, ...previous].slice(0, MAX_CLIPS);
    });
    setCurrentId(clip.id);
    setView('replay');
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
        zone,
        aspectRatio,
      };
      playStartSound();
      setArmedAt(null);
    }
    const active = activeRef.current;
    if (active) {
      if (result.target) active.frames.push({ time: time - active.startedAt, pose: result.target });
      recordStill(active, time);
    }
    if (result.event?.type === 'stop') void finishRecording(time);

    const next: Status = activeRef.current
      ? 'recording'
      : armedAt !== null
        ? 'armed'
        : result.state.kind === 'idle' && result.state.signSince !== null
          ? 'sign'
          : 'idle';
    setStatus(next);

    const canvas = overlayRef.current;
    const surface = canvas && prepareCanvas(canvas);
    if (!surface) return;
    const { ctx, width, height } = surface;
    if (!editingZone) drawZone(ctx, zone, width, height);
    if (activeRef.current && result.target) {
      drawPersonBox(ctx, result.target, width, height, '#ff6b70', 'Aufnahme');
    } else if (!activeRef.current) {
      for (const pose of poses.filter((p) => isInZone(p, zone))) {
        drawPersonBox(ctx, pose, width, height, '#5ee6c8', 'In Startzone');
      }
    }
  });

  useEffect(() => {
    if (!detector || camera.status !== 'ready') return;
    const poseDetector = detector;
    const video = videoRef.current;
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
    return () => video.cancelVideoFrameCallback(handle);
  }, [detector, camera.status]);

  const loading =
    camera.status === 'error'
      ? camera.message
      : detectorError
        ? 'Die Erkennung läuft nicht. Prüfe die Internetverbindung, nutze einen aktuellen Browser und lade die Seite neu.'
        : camera.status === 'starting'
          ? 'Kamera startet …'
          : !detector
            ? 'Erkennung lädt …'
            : null;

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
          onLive={() => setView('live')}
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

      {/* One wrapping row, so the two groups stack instead of overlapping on narrow phones. */}
      <div className="pointer-events-none absolute inset-x-3 top-3 z-20 flex flex-wrap items-center justify-between gap-2 *:pointer-events-auto">
        <div className="flex items-center gap-2">
          <span className={`${floating} inline-flex items-center gap-2 ${STATUS_STYLE[status]}`}>
            <span aria-hidden className="size-2 rounded-full bg-current" />
            {STATUS_TEXT[status]}
          </span>
          {!soundReady && (
            <button type="button" className={`${floating} text-slate-300`}>
              Ton einschalten
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-pressed={editingZone}
            disabled={status === 'recording'}
            onClick={() => {
              setEditingZone(!editingZone);
              setView('live');
            }}
            className={`${floating} text-slate-300 aria-pressed:text-sky-300`}
          >
            Startzone
          </button>
          <button
            type="button"
            disabled={status === 'recording' || !detector || editingZone}
            onClick={() => setArmedAt(armedAt === null ? Date.now() : null)}
            className={`${floating} ${armedAt === null ? 'bg-red-500/90 text-white' : 'text-red-300'}`}
          >
            {armedAt === null ? '● Aufnahme starten' : 'Abbrechen'}
          </button>
        </div>
      </div>

      {!showReplay && !editingZone && status === 'idle' && !loading && (
        <div
          className={`pointer-events-none absolute left-1/2 -translate-x-1/2 rounded-xl bg-black/70 px-5 py-3 text-center backdrop-blur ${
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
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/70 p-6">
          <p className="max-w-md text-center text-lg">{loading}</p>
        </div>
      )}
    </div>
  );
}
