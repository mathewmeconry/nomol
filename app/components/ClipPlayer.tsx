import { useEffect, useRef, useState, type ReactNode } from 'react';
import { LIMB_COLORS, drawSkeleton, prepareCanvas } from '~/lib/draw';
import { frameDuration, poseAt, type Clip } from '~/lib/recording/clip';
import { exportClip } from '~/lib/recording/export.client';

/** One button cycles through these, to save space on phones. */
const SPEEDS = [
  { value: 1, label: '1×' },
  { value: 0.5, label: '½×' },
  { value: 0.25, label: '¼×' },
];

const STEPS = [
  { frames: -5, label: '«', name: '5 Bilder zurück' },
  { frames: -1, label: '‹', name: '1 Bild zurück' },
  { frames: 1, label: '›', name: '1 Bild vor' },
  { frames: 5, label: '»', name: '5 Bilder vor' },
];

const CONTROLS_HIDE_MS = 3000;

function formatTime(ms: number) {
  const seconds = Math.max(0, ms) / 1000;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${(seconds - minutes * 60).toFixed(2).padStart(5, '0')}`;
}

type Props = {
  clip: Clip;
  aspectRatio: number;
  /** The list of recent clips, shown above the controls. */
  clipStrip: ReactNode;
  onLive: () => void;
};

const button =
  'h-9 min-w-9 rounded-lg bg-white/10 px-2.5 text-sm font-semibold backdrop-blur hover:bg-white/20 disabled:opacity-30';

/**
 * Plays a clip in a loop, with slow motion, frame stepping and the recorded skeleton on top.
 * Render it with `key={clip.id}` so switching clips starts fresh.
 */
export default function ClipPlayer({ clip, aspectRatio, clipStrip, onLive }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Follows the video's own play/pause events, so the button never disagrees with it.
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [skeleton, setSkeleton] = useState(true);
  const [timeMs, setTimeMs] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [exportFailed, setExportFailed] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [lastTouch, setLastTouch] = useState(0);

  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = speed;
  }, [speed]);

  // On phones the controls cover much of the picture, so they fade out during playback.
  useEffect(() => {
    if (!playing || !controlsVisible) return;
    const timer = setTimeout(() => setControlsVisible(false), CONTROLS_HIDE_MS);
    return () => clearTimeout(timer);
  }, [playing, controlsVisible, lastTouch]);

  useEffect(() => {
    let frame = 0;
    function render() {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (video && canvas) {
        const time = video.currentTime * 1000;
        setTimeMs(time);
        const surface = prepareCanvas(canvas);
        const pose = skeleton ? poseAt(clip.frames, time) : null;
        if (surface && pose) drawSkeleton(surface.ctx, pose, surface.width, surface.height);
      }
      frame = requestAnimationFrame(render);
    }
    frame = requestAnimationFrame(render);
    return () => cancelAnimationFrame(frame);
  }, [clip, skeleton]);

  function togglePlay() {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) void video.play();
    else video.pause();
  }

  function seek(ms: number) {
    const video = videoRef.current;
    if (!video) return;
    video.pause();
    video.currentTime = Math.min(Math.max(ms, 0), clip.durationMs) / 1000;
  }

  function stepFrames(frames: number) {
    const video = videoRef.current;
    if (video) seek(video.currentTime * 1000 + frames * frameDuration(clip));
  }

  return (
    <div
      className="absolute inset-0 flex items-center justify-center bg-black"
      onPointerDown={() => {
        setControlsVisible(true);
        setLastTouch(Date.now());
      }}
    >
      <div
        className="relative"
        style={{ aspectRatio, width: `min(100%, calc(100dvh * ${aspectRatio}))` }}
      >
        <video
          ref={videoRef}
          src={clip.url}
          className="absolute inset-0 h-full w-full"
          autoPlay
          loop
          muted
          playsInline
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
        />
        <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" />
      </div>

      <div
        className={`absolute inset-x-0 bottom-0 space-y-1.5 bg-linear-to-t from-black/90 via-black/60 to-transparent px-3 pt-8 pb-2 transition-opacity ${
          controlsVisible ? '' : 'pointer-events-none opacity-0'
        }`}
      >
        {clipStrip}
        <input
          type="range"
          aria-label="Zeitleiste"
          min={0}
          max={clip.durationMs}
          step="any"
          value={Math.min(timeMs, clip.durationMs)}
          onChange={(event) => seek(Number(event.target.value))}
          className="h-6 w-full cursor-pointer accent-sky-400"
        />

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            aria-label={playing ? 'Pause' : 'Abspielen'}
            onClick={togglePlay}
            className="h-9 w-12 rounded-lg bg-white font-semibold text-slate-950"
          >
            {playing ? '❚❚' : '▶'}
          </button>
          <div className="flex gap-1" role="group" aria-label="Bild für Bild">
            {STEPS.map((step) => (
              <button
                key={step.frames}
                type="button"
                aria-label={step.name}
                onClick={() => stepFrames(step.frames)}
                className={button}
              >
                {step.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            aria-label="Geschwindigkeit"
            onClick={() =>
              setSpeed(
                SPEEDS[(SPEEDS.findIndex((s) => s.value === speed) + 1) % SPEEDS.length].value,
              )
            }
            className={`${button} w-12 font-mono`}
          >
            {SPEEDS.find((s) => s.value === speed)?.label}
          </button>
          <button
            type="button"
            aria-pressed={skeleton}
            onClick={() => setSkeleton(!skeleton)}
            className={`${button} aria-pressed:text-sky-300`}
          >
            Skelett
          </button>
          {skeleton && (
            <span className="hidden gap-3 text-xs text-slate-300 lg:flex">
              {(
                [
                  ['Links', LIMB_COLORS.leftArm, LIMB_COLORS.leftLeg],
                  ['Rechts', LIMB_COLORS.rightArm, LIMB_COLORS.rightLeg],
                ] as const
              ).map(([side, arm, leg]) => (
                <span key={side} className="flex items-center gap-1">
                  {side}
                  <span className="ml-1 h-1 w-3 rounded" style={{ background: arm }} />
                  Arm
                  <span className="ml-1 h-1 w-3 rounded" style={{ background: leg }} />
                  Bein
                </span>
              ))}
            </span>
          )}
          <span className="font-mono text-xs text-slate-300 tabular-nums">
            {formatTime(timeMs)} / {formatTime(clip.durationMs)}
          </span>

          <span className="flex-1" />
          <button
            type="button"
            disabled={exporting}
            onClick={() => {
              setExporting(true);
              exportClip(clip)
                .catch((_error: unknown) => setExportFailed(true))
                .finally(() => setExporting(false));
            }}
            className={button}
          >
            {exportFailed ? 'Export fehlgeschlagen' : exporting ? 'Export …' : 'Export'}
          </button>
          <button type="button" onClick={onLive} className={`${button} text-emerald-300`}>
            Live
          </button>
        </div>
      </div>
    </div>
  );
}
