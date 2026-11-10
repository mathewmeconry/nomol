import { useEffect, useRef, useState } from 'react';
import { drawSkeleton, prepareCanvas } from '~/lib/draw';
import { frameAt, type Clip } from '~/lib/recording/clip';

const SPEEDS = [
  { value: 0.25, label: '¼×' },
  { value: 0.5, label: '½×' },
  { value: 1, label: '1×' },
];

export function formatTime(ms: number) {
  const seconds = Math.max(0, ms) / 1000;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${(seconds - minutes * 60).toFixed(2).padStart(5, '0')}`;
}

type Props = { clip: Clip; aspectRatio: number };

/**
 * Plays the latest clip in a loop, with slow motion and the recorded skeleton on top.
 * Render it with `key={clip.id}` so switching clips starts fresh.
 */
export default function ClipPlayer({ clip, aspectRatio }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [skeleton, setSkeleton] = useState(true);
  const [timeMs, setTimeMs] = useState(0);

  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = speed;
  }, [speed]);

  useEffect(() => {
    let frame = 0;
    function render() {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (video && canvas) {
        const time = video.currentTime * 1000;
        setTimeMs(time);
        const surface = prepareCanvas(canvas);
        const current = skeleton ? frameAt(clip.frames, time) : null;
        if (surface && current)
          drawSkeleton(surface.ctx, current.pose, surface.width, surface.height);
      }
      frame = requestAnimationFrame(render);
    }
    frame = requestAnimationFrame(render);
    return () => cancelAnimationFrame(frame);
  }, [clip, skeleton]);

  function togglePlay() {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      void video.play();
      setPlaying(true);
    } else {
      video.pause();
      setPlaying(false);
    }
  }

  function seek(ms: number) {
    const video = videoRef.current;
    if (!video) return;
    video.pause();
    setPlaying(false);
    video.currentTime = ms / 1000;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-0 flex-1 items-center justify-center bg-black">
        <div className="relative max-h-full w-full" style={{ aspectRatio }}>
          <video
            ref={videoRef}
            src={clip.url}
            className="absolute inset-0 h-full w-full"
            autoPlay
            loop
            muted
            playsInline
          />
          <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" />
          <span className="absolute bottom-3 left-3 rounded bg-black/70 px-2 py-0.5 font-mono text-xs text-slate-200">
            Clip {clip.startedAt.toLocaleTimeString('de-CH')}
            {speed !== 1 && ` · ${SPEEDS.find((s) => s.value === speed)?.label}`}
          </span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-slate-800 bg-slate-900 px-4 py-3">
        <button
          type="button"
          onClick={togglePlay}
          className="h-11 min-w-20 rounded-lg bg-slate-100 px-4 font-semibold text-slate-950"
        >
          {playing ? 'Pause' : 'Abspielen'}
        </button>
        <div
          className="flex overflow-hidden rounded-lg border border-slate-700"
          role="group"
          aria-label="Geschwindigkeit"
        >
          {SPEEDS.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={speed === option.value}
              onClick={() => setSpeed(option.value)}
              className="h-11 px-4 font-mono aria-pressed:bg-slate-100 aria-pressed:text-slate-950"
            >
              {option.label}
            </button>
          ))}
        </div>
        <input
          type="range"
          aria-label="Zeitleiste"
          min={0}
          max={clip.durationMs}
          value={Math.min(timeMs, clip.durationMs)}
          onChange={(event) => seek(Number(event.target.value))}
          className="h-11 min-w-32 flex-1 accent-sky-400"
        />
        <span className="min-w-36 text-right font-mono text-sm text-slate-400 tabular-nums">
          {formatTime(timeMs)} / {formatTime(clip.durationMs)}
        </span>
        <button
          type="button"
          aria-pressed={skeleton}
          onClick={() => setSkeleton(!skeleton)}
          className="h-11 rounded-lg border border-slate-700 px-4 font-semibold aria-pressed:border-sky-400 aria-pressed:text-sky-300"
        >
          Skelett
        </button>
      </div>
    </div>
  );
}
