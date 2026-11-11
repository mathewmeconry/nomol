import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Pause,
  Play,
  Share,
  Trash2,
} from 'lucide-react';
import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { Button } from '~/components/ui/button';
import { Progress } from '~/components/ui/progress';
import { Slider } from '~/components/ui/slider';
import { Toggle } from '~/components/ui/toggle';
import { LIMB_COLORS, drawSkeleton, prepareCanvas } from '~/lib/draw';
import { frameDuration, poseAt, routineRange, type Clip } from '~/lib/recording/clip';
import type { Point } from '~/lib/detection/pose';
import { exportClip } from '~/lib/recording/export.client';
import type { SkeletonProgress } from '~/lib/skeleton/refiner.client';
import { FULL_VIEW, zoomView, type View } from '~/lib/zoom';

/** One button cycles through these, to save space on phones. */
const SPEEDS = [
  { value: 1, label: '1×' },
  { value: 0.5, label: '½×' },
  { value: 0.25, label: '¼×' },
];

const STEPS = [
  { frames: -5, Icon: ChevronsLeft, name: '5 Bilder zurück' },
  { frames: -1, Icon: ChevronLeft, name: '1 Bild zurück' },
  { frames: 1, Icon: ChevronRight, name: '1 Bild vor' },
  { frames: 5, Icon: ChevronsRight, name: '5 Bilder vor' },
];

const CONTROLS_HIDE_MS = 3000;

const SKELETON_TEXT: Record<SkeletonProgress['stage'], string> = {
  download: 'Skelett-Modell wird geladen …',
  compute: 'Skelett wird berechnet …',
  failed: 'Skelett konnte nicht berechnet werden. Prüfe die Internetverbindung.',
};

function formatTime(ms: number) {
  const seconds = Math.max(0, ms) / 1000;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${(seconds - minutes * 60).toFixed(2).padStart(5, '0')}`;
}

/** Midpoint and spread of the first two fingers (spread 0 for one finger). */
function fingers(points: Point[]) {
  const [a, b = a] = points;
  return {
    center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
    spread: Math.hypot(a.x - b.x, a.y - b.y),
  };
}

type Props = {
  clip: Clip;
  /** The list of recent clips, shown above the controls. */
  clipStrip: ReactNode;
  /** While the skeleton is being computed; frames without one show no skeleton yet. */
  skeletonProgress: SkeletonProgress | null;
  onLive: () => void;
  onDelete: () => void;
};

/**
 * Plays a clip in a loop, with slow motion, frame stepping and the recorded skeleton on top.
 * Render it with `key={clip.id}` so switching clips starts fresh.
 */
export default function ClipPlayer({ clip, clipStrip, skeletonProgress, onLive, onDelete }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Follows the video's own play/pause events, so the button never disagrees with it.
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [skeleton, setSkeleton] = useState(true);
  const [timeMs, setTimeMs] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [exportFailed, setExportFailed] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [lastTouch, setLastTouch] = useState(0);
  /** Where to seek once the running seek is done (see `seek`). */
  const pendingSeekRef = useRef<number | null>(null);
  /** Applied in the render loop, so the video and its skeleton move in the same frame. */
  const viewRef = useRef<View>(FULL_VIEW);
  /** Fingers on the picture, in CSS pixels of the frame. */
  const pointersRef = useRef(new Map<number, Point>());

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
    const { startMs, endMs } = routineRange(clip);
    let frame = 0;
    let previousMs = 0;
    function render() {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (video && canvas) {
        // Loops the routine only. Seeking outside it stays possible, e.g. if the trim was wrong.
        if (!video.paused && previousMs < endMs && video.currentTime * 1000 >= endMs) {
          video.currentTime = startMs / 1000;
        }
        const time = video.currentTime * 1000;
        previousMs = time;
        setTimeMs(pendingSeekRef.current ?? time);
        const view = viewRef.current;
        video.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
        // While a seek decodes, the old frame is still on screen: keep its skeleton.
        if (!video.seeking) {
          const surface = prepareCanvas(canvas);
          const pose = skeleton ? poseAt(clip.skeleton, time) : null;
          if (surface && pose) {
            // Zoomed in the drawing rather than by CSS, so the lines stay thin and sharp.
            surface.ctx.translate(view.x, view.y);
            drawSkeleton(
              surface.ctx,
              pose,
              surface.width * view.scale,
              surface.height * view.scale,
            );
          }
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
    if (video.paused) void video.play();
    else video.pause();
  }

  /**
   * Seeks one at a time: phones decode a seek slowly (from the last keyframe), and a new seek
   * cancels the running one, so dragging the timeline would never show a frame.
   */
  function seek(ms: number) {
    const video = videoRef.current;
    if (!video) return;
    video.pause();
    const target = Math.min(Math.max(ms, 0), clip.durationMs);
    if (video.seeking) pendingSeekRef.current = target;
    else video.currentTime = target / 1000;
  }

  function onSeeked(video: HTMLVideoElement) {
    const pending = pendingSeekRef.current;
    if (pending === null) return;
    pendingSeekRef.current = null;
    video.currentTime = pending / 1000;
  }

  function stepFrames(frames: number) {
    const video = videoRef.current;
    if (video) seek(video.currentTime * 1000 + frames * frameDuration(clip));
  }

  function localPoint(event: PointerEvent<HTMLDivElement>): Point {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  /** Two fingers zoom, one finger moves the zoomed picture. */
  function onPinchMove(event: PointerEvent<HTMLDivElement>) {
    const pointers = pointersRef.current;
    if (!pointers.has(event.pointerId)) return;
    const before = fingers([...pointers.values()]);
    pointers.set(event.pointerId, localPoint(event));
    const after = fingers([...pointers.values()]);
    const factor = before.spread > 0 ? after.spread / before.spread : 1;
    const { clientWidth, clientHeight } = event.currentTarget;
    viewRef.current = zoomView(
      viewRef.current,
      factor,
      before.center,
      after.center,
      clientWidth,
      clientHeight,
    );
  }

  function onPinchEnd(event: PointerEvent<HTMLDivElement>) {
    pointersRef.current.delete(event.pointerId);
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
        className="relative touch-none overflow-hidden"
        // The clip's own shape: the phone may have been turned since it was recorded.
        style={{
          aspectRatio: clip.aspectRatio,
          width: `min(100%, calc(100dvh * ${clip.aspectRatio}))`,
        }}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          pointersRef.current.set(event.pointerId, localPoint(event));
        }}
        onPointerMove={onPinchMove}
        onPointerUp={onPinchEnd}
        onPointerCancel={onPinchEnd}
        onDoubleClick={() => (viewRef.current = FULL_VIEW)}
      >
        <video
          ref={videoRef}
          src={clip.url}
          className="absolute inset-0 h-full w-full origin-top-left"
          autoPlay
          muted
          playsInline
          onLoadedMetadata={(event) => {
            event.currentTarget.currentTime = routineRange(clip).startMs / 1000;
          }}
          // Instead of the loop attribute, which would restart at 0 rather than the routine.
          onEnded={(event) => {
            event.currentTarget.currentTime = routineRange(clip).startMs / 1000;
            void event.currentTarget.play();
          }}
          onSeeked={(event) => onSeeked(event.currentTarget)}
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
        {skeletonProgress && (
          <div className="flex items-center gap-3 text-xs text-slate-300" role="status">
            <span className="shrink-0">{SKELETON_TEXT[skeletonProgress.stage]}</span>
            {skeletonProgress.stage !== 'failed' && (
              <>
                <Progress value={skeletonProgress.percent} className="h-1.5" />
                <span className="w-10 shrink-0 text-right font-mono tabular-nums">
                  {skeletonProgress.percent}&nbsp;%
                </span>
              </>
            )}
          </div>
        )}
        <Slider
          aria-label="Zeitleiste"
          min={0}
          max={clip.durationMs}
          step={1}
          value={[Math.min(timeMs, clip.durationMs)]}
          onValueChange={([ms]) => seek(ms)}
          className="h-6 cursor-pointer"
        />

        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            size="icon"
            aria-label={playing ? 'Pause' : 'Abspielen'}
            onClick={togglePlay}
            className="w-12"
          >
            {playing ? <Pause /> : <Play />}
          </Button>
          <div className="flex gap-1" role="group" aria-label="Bild für Bild">
            {STEPS.map(({ frames, Icon, name }) => (
              <Button
                key={frames}
                variant="secondary"
                size="icon"
                aria-label={name}
                onClick={() => stepFrames(frames)}
              >
                <Icon />
              </Button>
            ))}
          </div>
          <Button
            variant="secondary"
            aria-label="Geschwindigkeit"
            onClick={() =>
              setSpeed(
                SPEEDS[(SPEEDS.findIndex((s) => s.value === speed) + 1) % SPEEDS.length].value,
              )
            }
            className="w-12 font-mono"
          >
            {SPEEDS.find((s) => s.value === speed)?.label}
          </Button>
          <Toggle
            variant="outline"
            pressed={skeleton}
            onPressedChange={setSkeleton}
            className="data-[state=on]:text-sky-300"
          >
            Skelett
          </Toggle>
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
          <Button
            variant="secondary"
            disabled={exporting}
            onClick={() => {
              setExporting(true);
              exportClip(clip)
                .catch((_error: unknown) => setExportFailed(true))
                .finally(() => setExporting(false));
            }}
          >
            <Share />
            {/* Icon only on narrow phones, so the controls fit in two rows. */}
            <span className={exportFailed ? '' : 'max-sm:sr-only'}>
              {exportFailed ? 'Export fehlgeschlagen' : exporting ? 'Export …' : 'Export'}
            </span>
          </Button>
          {/* Two taps, because the clip is gone for good. */}
          <Button
            variant={confirmingDelete ? 'destructive' : 'secondary'}
            onClick={() => (confirmingDelete ? onDelete() : setConfirmingDelete(true))}
            className={confirmingDelete ? '' : 'text-red-300'}
          >
            <Trash2 />
            <span className={confirmingDelete ? '' : 'max-sm:sr-only'}>
              {confirmingDelete ? 'Wirklich löschen?' : 'Löschen'}
            </span>
          </Button>
          <Button variant="secondary" onClick={onLive} className="text-emerald-300">
            Live
          </Button>
        </div>
      </div>
    </div>
  );
}
