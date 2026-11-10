import { useEffect, useEffectEvent, useRef, useState } from 'react';
import ClipPlayer, { formatTime } from '~/components/ClipPlayer';
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
import { DEFAULT_ZONE, loadZone, saveZone } from '~/lib/zone-storage';

/** After "Aufnahme starten", wait this long for someone to step into the start zone. */
const ARMED_TIMEOUT_MS = 20_000;
/** Older clips are dropped to keep the tablet's memory in check. */
const MAX_CLIPS = 8;

type Status = 'idle' | 'sign' | 'armed' | 'recording';

const STATUS_TEXT: Record<Status, string> = {
  idle: 'Bereit',
  sign: 'Zeichen erkannt …',
  armed: 'Warte auf Person in der Startzone',
  recording: 'Aufnahme läuft',
};

const STATUS_STYLE: Record<Status, string> = {
  idle: 'bg-emerald-400/15 text-emerald-300',
  sign: 'bg-amber-400/15 text-amber-300',
  armed: 'bg-amber-400/15 text-amber-300',
  recording: 'bg-red-500/20 text-red-300',
};

type ActiveRecording = {
  recording: Recording;
  startedAt: number;
  startedDate: Date;
  frames: ClipFrame[];
};

export default function Tablet() {
  const camera = useCamera();
  useWakeLock();

  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
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

  async function finishRecording(time: number) {
    const active = activeRef.current;
    if (!active) return;
    activeRef.current = null;
    const blob = await active.recording.stop();
    const clip: Clip = {
      id: crypto.randomUUID(),
      url: URL.createObjectURL(blob),
      startedAt: active.startedDate,
      durationMs: time - active.startedAt,
      frames: active.frames,
    };
    setClips((previous) => {
      previous.slice(MAX_CLIPS - 1).forEach((old) => URL.revokeObjectURL(old.url));
      return [clip, ...previous].slice(0, MAX_CLIPS);
    });
    setCurrentId(clip.id);
    setView('replay');
  }

  const onFrame = useEffectEvent((time: number, poses: Pose[]) => {
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
        startedAt: time,
        startedDate: new Date(),
        frames: [],
      };
      setArmedAt(null);
    }
    const active = activeRef.current;
    if (active && result.target) {
      active.frames.push({ time: time - active.startedAt, pose: result.target });
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
    let frame = 0;
    let lastVideoTime = -1;
    function tick() {
      const video = videoRef.current;
      // Only run detection on new camera frames; the screen may refresh faster.
      if (video && video.readyState >= 2 && video.currentTime !== lastVideoTime) {
        lastVideoTime = video.currentTime;
        const time = performance.now();
        let poses: Pose[];
        try {
          poses = poseDetector.detect(video, time);
        } catch (_error) {
          // MediaPipe needs WebGL even on the CPU; without it every frame fails.
          setDetectorError(true);
          return;
        }
        onFrame(time, poses);
      }
      frame = requestAnimationFrame(tick);
    }
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
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

  return (
    <div className="flex h-dvh flex-col bg-[#0b1017] text-slate-100">
      <header className="flex flex-wrap items-center gap-3 border-b border-slate-800 bg-slate-900 px-4 py-2">
        <span className="text-xl font-bold tracking-wide">Nomol</span>
        <span
          className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-semibold ${STATUS_STYLE[status]}`}
        >
          <span aria-hidden className="size-2 rounded-full bg-current" />
          {STATUS_TEXT[status]}
        </span>
        <span className="flex-1" />
        <button
          type="button"
          aria-pressed={editingZone}
          disabled={status === 'recording'}
          onClick={() => {
            setEditingZone(!editingZone);
            setView('live');
          }}
          className="h-10 rounded-lg border border-slate-700 px-3 text-sm font-semibold text-slate-300 disabled:opacity-40 aria-pressed:border-sky-400 aria-pressed:text-sky-300"
        >
          Startzone
        </button>
        <button
          type="button"
          disabled={status === 'recording' || !detector || editingZone}
          onClick={() => setArmedAt(armedAt === null ? Date.now() : null)}
          className={`h-10 rounded-lg px-4 font-semibold disabled:opacity-40 ${
            armedAt === null ? 'bg-red-500 text-white' : 'border border-red-400 text-red-300'
          }`}
        >
          {armedAt === null ? '● Aufnahme starten' : 'Abbrechen'}
        </button>
      </header>

      <main className="relative min-h-0 flex-1">
        {showReplay && current && (
          <ClipPlayer key={current.id} clip={current} aspectRatio={aspectRatio} />
        )}

        <div
          className={
            showReplay
              ? 'absolute right-4 bottom-24 w-1/4 overflow-hidden rounded-lg border-2 border-white/25 shadow-2xl'
              : 'flex h-full items-center justify-center bg-black'
          }
        >
          <div className="relative max-h-full w-full" style={{ aspectRatio }}>
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
            <canvas
              ref={overlayRef}
              className="pointer-events-none absolute inset-0 h-full w-full"
            />
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
                  className={`absolute top-2 left-2 rounded px-2 py-0.5 text-xs font-semibold ${
                    status === 'recording'
                      ? 'bg-black/70 text-red-300'
                      : 'bg-black/70 text-emerald-300'
                  }`}
                >
                  {status === 'recording' ? '● Live · Aufnahme' : 'Live · bereit'}
                </span>
              </button>
            )}
          </div>
        </div>

        {!showReplay && !editingZone && status === 'idle' && !loading && (
          <div className="pointer-events-none absolute bottom-6 left-1/2 -translate-x-1/2 rounded-xl border border-white/10 bg-black/80 px-5 py-3 text-center">
            <p className="text-lg font-semibold">Aufnehmen? Arme über dem Kopf kreuzen</p>
            <p className="text-sm text-slate-400">
              in der Startzone · zur Kamera schauen · 1 Sekunde halten · oder «Aufnahme starten»
              tippen
            </p>
          </div>
        )}

        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/70 p-6">
            <p className="max-w-md text-center text-lg">{loading}</p>
          </div>
        )}
      </main>

      <footer className="flex items-center gap-3 overflow-x-auto border-t border-slate-800 bg-slate-950 px-4 py-3">
        {clips.length === 0 ? (
          <span className="text-sm text-slate-500">Aufgenommene Clips erscheinen hier.</span>
        ) : (
          <>
            {view === 'live' && current && !editingZone && (
              <button
                type="button"
                onClick={() => setView('replay')}
                className="h-11 shrink-0 rounded-lg border border-slate-700 px-4 font-semibold"
              >
                Zurück zum Clip
              </button>
            )}
            {clips.map((clip) => (
              <button
                key={clip.id}
                type="button"
                aria-current={showReplay && clip.id === currentId}
                onClick={() => {
                  setCurrentId(clip.id);
                  setView('replay');
                  setEditingZone(false);
                }}
                className="h-11 shrink-0 rounded-lg border-2 border-transparent bg-slate-900 px-3 font-mono text-sm text-slate-300 aria-current:border-sky-400"
              >
                {clip.startedAt.toLocaleTimeString('de-CH')} ·{' '}
                {formatTime(clip.durationMs).slice(0, 4)}
              </button>
            ))}
          </>
        )}
      </footer>
    </div>
  );
}
