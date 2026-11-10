import { useEffect, useRef, useState } from 'react';
import { drawSkeleton, prepareCanvas } from '~/lib/draw';
import { frameAt, frameDuration, timelineThumbnails, type Clip } from '~/lib/recording/clip';

const SPEEDS = [
  { value: 0.25, label: '¼×' },
  { value: 0.5, label: '½×' },
  { value: 1, label: '1×' },
];

const STEPS = [
  { frames: -5, label: '‹‹ 5', name: '5 Bilder zurück' },
  { frames: -1, label: '‹ 1', name: '1 Bild zurück' },
  { frames: 1, label: '1 ›', name: '1 Bild vor' },
  { frames: 5, label: '5 ››', name: '5 Bilder vor' },
];

const TIMELINE_SLOTS = 12;

function formatTime(ms: number) {
  const seconds = Math.max(0, ms) / 1000;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${(seconds - minutes * 60).toFixed(2).padStart(5, '0')}`;
}

type Props = {
  clip: Clip;
  aspectRatio: number;
  /** Null when there is no older/newer clip. */
  onOlder: (() => void) | null;
  onNewer: (() => void) | null;
  onLive: () => void;
};

const button =
  'h-10 rounded-lg bg-white/10 px-3 text-sm font-semibold backdrop-blur hover:bg-white/20 disabled:opacity-30';

/**
 * Plays a clip in a loop, with slow motion, frame stepping and the recorded skeleton on top.
 * Render it with `key={clip.id}` so switching clips starts fresh.
 */
export default function ClipPlayer({ clip, aspectRatio, onOlder, onNewer, onLive }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [skeleton, setSkeleton] = useState(true);
  const [timeMs, setTimeMs] = useState(0);
  const thumbnails = timelineThumbnails(clip, TIMELINE_SLOTS);

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
        if (surface && current) {
          drawSkeleton(surface.ctx, current.pose, surface.width, surface.height);
        }
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
    video.currentTime = Math.min(Math.max(ms, 0), clip.durationMs) / 1000;
  }

  function stepFrames(frames: number) {
    const video = videoRef.current;
    if (video) seek(video.currentTime * 1000 + frames * frameDuration(clip));
  }

  return (
    <div className="absolute inset-0 flex items-center justify-center bg-black">
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
        />
        <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" />
      </div>

      <div className="absolute inset-x-0 bottom-0 space-y-2 bg-linear-to-t from-black/90 via-black/60 to-transparent px-4 pt-12 pb-3">
        <div className="relative h-14 overflow-hidden rounded-lg bg-white/5">
          <div className="absolute inset-0 flex">
            {thumbnails.map((thumbnail) => (
              <img
                key={thumbnail.time}
                src={thumbnail.url}
                alt=""
                className="h-full min-w-0 flex-1 object-cover opacity-80"
              />
            ))}
          </div>
          <input
            type="range"
            aria-label="Zeitleiste"
            min={0}
            max={clip.durationMs}
            step="any"
            value={Math.min(timeMs, clip.durationMs)}
            onChange={(event) => seek(Number(event.target.value))}
            className="timeline-range absolute inset-0 h-full w-full cursor-pointer"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={togglePlay}
            className="h-10 min-w-24 rounded-lg bg-white px-4 font-semibold text-slate-950"
          >
            {playing ? 'Pause' : 'Abspielen'}
          </button>
          <div className="flex gap-1" role="group" aria-label="Bild für Bild">
            {STEPS.map((step) => (
              <button
                key={step.frames}
                type="button"
                aria-label={step.name}
                onClick={() => stepFrames(step.frames)}
                className={`${button} font-mono`}
              >
                {step.label}
              </button>
            ))}
          </div>
          <div className="flex gap-1" role="group" aria-label="Geschwindigkeit">
            {SPEEDS.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={speed === option.value}
                onClick={() => setSpeed(option.value)}
                className={`${button} font-mono aria-pressed:bg-white aria-pressed:text-slate-950`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            aria-pressed={skeleton}
            onClick={() => setSkeleton(!skeleton)}
            className={`${button} aria-pressed:text-sky-300`}
          >
            Skelett
          </button>
          <span className="font-mono text-sm text-slate-300 tabular-nums">
            {formatTime(timeMs)} / {formatTime(clip.durationMs)}
          </span>

          <span className="flex-1" />

          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-label="Älterer Clip"
              disabled={!onOlder}
              onClick={() => onOlder?.()}
              className={button}
            >
              ‹
            </button>
            <span className="px-1 font-mono text-sm text-slate-300">
              {clip.startedAt.toLocaleTimeString('de-CH')}
            </span>
            <button
              type="button"
              aria-label="Neuerer Clip"
              disabled={!onNewer}
              onClick={() => onNewer?.()}
              className={button}
            >
              ›
            </button>
          </div>
          <button type="button" onClick={onLive} className={`${button} text-emerald-300`}>
            Live
          </button>
        </div>
      </div>
    </div>
  );
}
