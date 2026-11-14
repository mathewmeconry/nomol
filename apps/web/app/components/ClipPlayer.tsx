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
import { createPortal } from 'react-dom';
import { Button } from '~/components/ui/button';
import { Progress } from '~/components/ui/progress';
import { Slider } from '~/components/ui/slider';
import { Toggle } from '~/components/ui/toggle';
import { drawSkeleton, prepareCanvas } from '~/lib/draw';
import { LIMB_COLORS } from '@nomol/core/skeleton/lines';
import { frameDuration, poseAt, routineRange, type Clip } from '@nomol/core/recording/clip';
import type { Point } from '@nomol/core/detection/pose';
import type { Dock, Rect } from '@nomol/core/layout';
import { exportClip } from '~/lib/recording/export.client';
import type { SkeletonProgress } from '~/lib/skeleton/refiner.client';
import { cn } from 'cn';
import { FULL_VIEW, zoomView, type View } from '@nomol/core/zoom';

/** Over the picture one button cycles through these, to save space on phones. */
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
  compute: 'Skelett wird berechnet …',
  failed: 'Skelett konnte nicht berechnet werden.',
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
  /** Where the video goes on the screen (`screenLayout`). */
  picture: Rect;
  /** Beside or below the picture, the controls go into the strip there; null: over the video. */
  dock: Dock;
  /** The strip's place for the controls, once it's on the page. */
  dockElement: HTMLElement | null;
  /** Where the small live picture goes among the docked controls. */
  liveSlot: ReactNode;
  /** The list of recent clips. */
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
export default function ClipPlayer({
  clip,
  picture,
  dock,
  dockElement,
  liveSlot,
  clipStrip,
  skeletonProgress,
  onLive,
  onDelete,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Follows the video's own play/pause events, so the button never disagrees with it.
  const [playing, setPlaying] = useState(false);
  // Half speed by default: elements are fast, and at 60 fps recording it still plays smoothly.
  const [speed, setSpeed] = useState(0.5);
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

  // Over the picture the controls cover much of it on phones, so they fade out during playback.
  useEffect(() => {
    if (dock || !playing || !controlsVisible) return;
    const timer = setTimeout(() => setControlsVisible(false), CONTROLS_HIDE_MS);
    return () => clearTimeout(timer);
  }, [dock, playing, controlsVisible, lastTouch]);

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

  /** In a wide strip below the picture, rows of controls join into one line (`@xl`). */
  const joinRows = dock === 'bottom';
  const routine = routineRange(clip);
  const timeline = (
    <div className="w-full space-y-1">
      {skeletonProgress && (
        <div className="flex items-center gap-3 text-xs text-slate-300" role="status">
          <span className={cn('shrink-0', dock === 'side' && 'sr-only')}>
            {SKELETON_TEXT[skeletonProgress.stage]}
          </span>
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
      <div className="relative">
        {/* The looped routine, so the coach sees what the trim kept. */}
        <span
          aria-hidden
          className="absolute bottom-0 h-0.5 rounded-full bg-sky-400/70"
          style={{
            left: `${(routine.startMs / clip.durationMs) * 100}%`,
            width: `${((routine.endMs - routine.startMs) / clip.durationMs) * 100}%`,
          }}
        />
        <Slider
          aria-label="Zeitleiste"
          min={0}
          max={clip.durationMs}
          step={1}
          value={[Math.min(timeMs, clip.durationMs)]}
          onValueChange={([ms]) => seek(ms)}
          className="h-6 cursor-pointer"
        />
      </div>
    </div>
  );
  const playButton = (
    <Button
      size="icon"
      aria-label={playing ? 'Pause' : 'Abspielen'}
      onClick={togglePlay}
      className={cn(dock ? 'min-w-0 flex-1' : 'w-12', joinRows && '@xl:w-12 @xl:flex-none')}
    >
      {playing ? <Pause /> : <Play />}
    </Button>
  );
  function stepButton({ frames, Icon, name }: (typeof STEPS)[number]) {
    return (
      <Button
        key={frames}
        variant="secondary"
        size="icon"
        aria-label={name}
        onClick={() => stepFrames(frames)}
        className={cn(dock && 'min-w-0 flex-1', joinRows && '@xl:flex-none')}
      >
        <Icon />
      </Button>
    );
  }
  const skeletonToggle = (
    <Toggle
      size={dock ? 'sm' : 'default'}
      variant="outline"
      pressed={skeleton}
      onPressedChange={setSkeleton}
      className="data-[state=on]:text-sky-300"
    >
      Skelett
    </Toggle>
  );
  /** The strip beside the picture only has room for icons here. */
  const iconsOnly = dock === 'side';
  const exportButton = (
    <Button
      variant="secondary"
      size={iconsOnly ? 'icon-sm' : dock ? 'sm' : 'default'}
      disabled={exporting}
      onClick={() => {
        setExporting(true);
        exportClip(clip)
          .catch((_error: unknown) => setExportFailed(true))
          .finally(() => setExporting(false));
      }}
      className={cn(iconsOnly && exportFailed && 'text-red-300')}
    >
      <Share />
      {/* Icon only on narrow phones, so the controls fit in two rows. */}
      <span
        className={cn(
          iconsOnly ? 'sr-only' : !exportFailed && !dock && 'max-sm:sr-only',
          dock && 'truncate',
        )}
      >
        {exportFailed ? 'Teilen fehlgeschlagen' : exporting ? 'Teilen …' : 'Teilen'}
      </span>
    </Button>
  );
  // Two taps, because the clip is gone for good.
  const deleteButton = (
    <Button
      variant={confirmingDelete ? 'destructive' : 'secondary'}
      size={dock && (iconsOnly || !confirmingDelete) ? 'icon-sm' : dock ? 'sm' : 'default'}
      onClick={() => (confirmingDelete ? onDelete() : setConfirmingDelete(true))}
      className={cn(!confirmingDelete && 'text-red-300')}
    >
      <Trash2 />
      <span
        className={cn(
          (iconsOnly || !confirmingDelete) && (dock ? 'sr-only' : 'max-sm:sr-only'),
          dock && 'truncate',
        )}
      >
        {confirmingDelete ? 'Wirklich löschen?' : 'Löschen'}
      </span>
    </Button>
  );
  const time = (
    <span className="font-mono text-xs text-slate-300 tabular-nums">
      {formatTime(timeMs)} / {formatTime(clip.durationMs)}
    </span>
  );

  const overlay = (
    <div
      className={cn(
        'absolute inset-x-0 bottom-0 space-y-1.5 bg-linear-to-t from-black/90 via-black/60 to-transparent px-3 pt-8 pb-2 transition-opacity',
        !controlsVisible && 'pointer-events-none opacity-0',
      )}
    >
      {clipStrip}
      {timeline}

      <div className="flex flex-wrap items-center gap-1.5">
        {playButton}
        <div className="flex gap-1" role="group" aria-label="Bild für Bild">
          {STEPS.map(stepButton)}
        </div>
        <Button
          variant="secondary"
          aria-label="Geschwindigkeit"
          onClick={() =>
            setSpeed(SPEEDS[(SPEEDS.findIndex((s) => s.value === speed) + 1) % SPEEDS.length].value)
          }
          className="w-12 font-mono"
        >
          {SPEEDS.find((s) => s.value === speed)?.label}
        </Button>
        {skeletonToggle}
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
        {time}

        <span className="flex-1" />
        {exportButton}
        {deleteButton}
        <Button variant="secondary" onClick={onLive} className="text-emerald-300">
          Live
        </Button>
      </div>
    </div>
  );

  return (
    <div
      className="absolute inset-0 bg-black"
      onPointerDown={() => {
        setControlsVisible(true);
        setLastTouch(Date.now());
      }}
    >
      <div
        className="absolute touch-none overflow-hidden"
        // Laid out for the clip's own shape: the phone may have been turned since it was recorded.
        style={picture}
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

      {dock
        ? dockElement &&
          createPortal(
            <>
              {dock === 'bottom' && timeline}
              <div
                className={cn('flex w-full gap-1', joinRows && '@xl:w-auto')}
                role="group"
                aria-label="Bild für Bild"
              >
                {stepButton(STEPS[0])}
                {stepButton(STEPS[1])}
                {playButton}
                {stepButton(STEPS[2])}
                {stepButton(STEPS[3])}
              </div>
              <div className={cn('flex w-full gap-1', joinRows && '@xl:w-auto')}>
                <div className="flex flex-1 gap-1" role="group" aria-label="Geschwindigkeit">
                  {[...SPEEDS].reverse().map((option) => (
                    <Toggle
                      key={option.value}
                      size="sm"
                      variant="outline"
                      pressed={speed === option.value}
                      onPressedChange={() => setSpeed(option.value)}
                      className="min-w-0 flex-1 px-1 font-mono data-[state=on]:text-sky-300"
                    >
                      {option.label}
                    </Toggle>
                  ))}
                </div>
                {skeletonToggle}
              </div>
              <div
                className={cn(
                  'flex w-full gap-2',
                  dock === 'bottom' && 'grow items-center @xl:w-auto @xl:basis-96',
                )}
              >
                {liveSlot}
                {dock === 'side' ? (
                  // Too narrow for text: icon buttons beside the live picture, time below.
                  <div className="flex flex-col gap-1">
                    {exportButton}
                    {deleteButton}
                  </div>
                ) : (
                  <div className="flex min-w-0 flex-1 flex-col gap-1.5 @xl:flex-row @xl:items-center @xl:gap-2">
                    <span className="shrink-0">{time}</span>
                    <div className="flex shrink-0 gap-1">
                      {exportButton}
                      {deleteButton}
                    </div>
                    <div className="min-w-0 flex-1">{clipStrip}</div>
                  </div>
                )}
              </div>
              {dock === 'side' && time}
              {dock === 'side' && timeline}
              {dock === 'side' && <div className="mt-auto">{clipStrip}</div>}
            </>,
            dockElement,
          )
        : overlay}
    </div>
  );
}
