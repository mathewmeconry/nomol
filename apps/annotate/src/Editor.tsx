import { useEffect, useRef, useState, type PointerEvent, type WheelEvent } from 'react';
import { cn } from 'cn';
import { LIMB_COLORS } from '@nomol/core/skeleton/lines';
import { Skeleton } from './Skeleton';
import { KEYPOINT_NAMES, fromCandidate, swapSides } from './lib/keypoints';
import type { Keypoint, Label, Task } from './lib/tasks';

type Props = {
  task: Task;
  label: Label | undefined;
  onSave: (keypoints: Keypoint[], seconds: number) => void;
  onDiscard: (keypoints: Keypoint[], seconds: number) => void;
  onPrevious: () => void;
};

type Rect = { x: number; y: number; w: number; h: number };
type Drag =
  | { kind: 'joint'; index: number; moved: boolean }
  | { kind: 'pan'; clientX: number; clientY: number; view: Rect; moved: boolean };

const VISIBILITY = ['nicht im Bild', 'verdeckt', 'sichtbar'];
const LEGEND: [string, string][] = [
  [LIMB_COLORS.leftArm, 'linker Arm'],
  [LIMB_COLORS.leftLeg, 'linkes Bein'],
  [LIMB_COLORS.rightArm, 'rechter Arm'],
  [LIMB_COLORS.rightLeg, 'rechtes Bein'],
  [LIMB_COLORS.body, 'Kopf und Rumpf'],
];

function initial(task: Task, label: Label | undefined): Keypoint[] {
  if (label && !label.discarded) return label.keypoints;
  const [x, y, w, h] = task.box;
  const best = task.candidates[0];
  return best
    ? fromCandidate(best.keypoints, task.width, task.height)
    : Array.from({ length: 17 }, (): Keypoint => [x + w / 2, y + h / 2, 0]);
}

/** The frame zoomed to the person, the skeleton to correct, the candidates and the neighbours. */
export function Editor({ task, label, onSave, onDiscard, onPrevious }: Props) {
  const [keypoints, setKeypoints] = useState(() => initial(task, label));
  const [history, setHistory] = useState<Keypoint[][]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [chosen, setChosen] = useState<number | null>(label ? null : 0);
  const crop = { x: task.crop[0], y: task.crop[1], w: task.crop[2], h: task.crop[3] };
  const [view, setView] = useState<Rect>(crop);
  const [size, setSize] = useState({ width: 1, height: 1 });
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<Drag | null>(null);
  const started = useRef(0);

  useEffect(() => {
    started.current = performance.now();
    const element = svg.current!;
    const measure = () => setSize({ width: element.clientWidth, height: element.clientHeight });
    // Measured right away too: the observer's first call can wait while the window is hidden.
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // The SVG fits the view into itself (meet), so the tighter side sets the scale.
  const unit = Math.max(view.w / size.width, view.h / size.height);

  function change(next: Keypoint[]) {
    setHistory((h) => [...h, keypoints]);
    setKeypoints(next);
  }

  function update(index: number, point: Keypoint) {
    return keypoints.map((p, i) => (i === index ? point : p));
  }

  function choose(index: number) {
    const candidate = task.candidates[index];
    if (!candidate) return;
    change(fromCandidate(candidate.keypoints, task.width, task.height));
    setChosen(index);
  }

  function undo() {
    if (history.length === 0) return;
    setKeypoints(history[history.length - 1]);
    setHistory(history.slice(0, -1));
  }

  function seconds() {
    return Math.round((performance.now() - started.current) / 100) / 10;
  }

  function toImage(event: { clientX: number; clientY: number }) {
    const matrix = svg.current!.getScreenCTM()!.inverse();
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix);
    return { x: point.x, y: point.y };
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.ctrlKey || event.metaKey || event.altKey) {
        if (event.key === 'z') undo();
        return;
      }
      const key = event.key.toLowerCase();
      if (/^[1-9]$/.test(key)) choose(Number(key) - 1);
      else if (key === 's') change(swapSides(keypoints));
      else if (key === 'tab') {
        event.preventDefault();
        const step = event.shiftKey ? 16 : 1;
        setSelected((s) => (s === null ? (event.shiftKey ? 16 : 0) : (s + step) % 17));
      } else if (key === 'h' && selected !== null) {
        const [x, y, v] = keypoints[selected];
        change(update(selected, [x, y, v === 1 ? 2 : 1]));
      } else if ((key === 'delete' || key === 'backspace') && selected !== null) {
        const [x, y] = keypoints[selected];
        change(update(selected, [x, y, 0]));
      } else if (key.startsWith('arrow') && selected !== null) {
        event.preventDefault();
        const step = (event.shiftKey ? 10 : 1) * unit;
        const [x, y, v] = keypoints[selected];
        const dx = key === 'arrowleft' ? -step : key === 'arrowright' ? step : 0;
        const dy = key === 'arrowup' ? -step : key === 'arrowdown' ? step : 0;
        change(update(selected, [x + dx, y + dy, v]));
      } else if (key === ' ') {
        event.preventDefault();
        onSave(keypoints, seconds());
      } else if (key === 'x') onDiscard(keypoints, seconds());
      else if (key === 'z') undo();
      else if (key === 'p') onPrevious();
      else if (key === 'r') setView(crop);
      else if (key === 'escape') setSelected(null);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  function grab(index: number, event: PointerEvent) {
    event.stopPropagation();
    setSelected(index);
    drag.current = { kind: 'joint', index, moved: false };
    svg.current!.setPointerCapture(event.pointerId);
  }

  function onPointerDown(event: PointerEvent<SVGSVGElement>) {
    drag.current = {
      kind: 'pan',
      clientX: event.clientX,
      clientY: event.clientY,
      view,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: PointerEvent<SVGSVGElement>) {
    const current = drag.current;
    if (!current) return;
    if (current.kind === 'joint') {
      const { x, y } = toImage(event);
      const v = keypoints[current.index][2] || 2;
      const next = update(current.index, [x, y, v]);
      // One undo step per drag, not per move.
      if (current.moved) setKeypoints(next);
      else change(next);
      current.moved = true;
    } else {
      const dx = event.clientX - current.clientX;
      const dy = event.clientY - current.clientY;
      if (!current.moved && Math.hypot(dx, dy) < 4) return;
      current.moved = true;
      setView({ ...current.view, x: current.view.x - dx * unit, y: current.view.y - dy * unit });
    }
  }

  function onPointerUp(event: PointerEvent<SVGSVGElement>) {
    const current = drag.current;
    drag.current = null;
    // A click beside the skeleton puts the selected point there.
    if (current?.kind === 'pan' && !current.moved && selected !== null) {
      const { x, y } = toImage(event);
      const v = keypoints[selected][2] || 2;
      change(update(selected, [x, y, v]));
    }
  }

  function onWheel(event: WheelEvent<SVGSVGElement>) {
    const { x, y } = toImage(event);
    const factor = Math.pow(1.0015, -event.deltaY);
    setView({
      x: x - (x - view.x) / factor,
      y: y - (y - view.y) / factor,
      w: view.w / factor,
      h: view.h / factor,
    });
  }

  const [bx, by, bw, bh] = task.box;
  const thumb = Math.max(bw, bh) * 1.15;
  const context = (offset: number) => task.context.find((c) => c.offset === offset);

  return (
    <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_260px] grid-rows-[minmax(0,1fr)_auto] gap-2 p-2">
      <svg
        ref={svg}
        className="h-full w-full touch-none rounded-md bg-black select-none"
        viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onWheel={onWheel}
      >
        <image href={`/work/${task.image}`} width={task.width} height={task.height} />
        <rect
          x={bx}
          y={by}
          width={bw}
          height={bh}
          fill="none"
          stroke="#ffffff"
          strokeOpacity={0.3}
          strokeWidth={unit}
          strokeDasharray={`${4 * unit} ${4 * unit}`}
        />
        <Skeleton keypoints={keypoints} unit={unit} selected={selected} onGrab={grab} />
      </svg>

      <div className="grid min-h-0 grid-cols-2 content-start gap-2 overflow-y-auto">
        {task.candidates.map((candidate, i) => (
          <button
            key={candidate.name}
            type="button"
            onClick={() => choose(i)}
            className={cn(
              'overflow-hidden rounded-md border text-left text-xs',
              i === chosen ? 'border-sky-400' : 'border-neutral-700',
            )}
          >
            {/* Zoomed to the person: the candidates often differ only in a limb. */}
            <svg
              className="block aspect-square w-full bg-black"
              viewBox={`${bx + bw / 2 - thumb / 2} ${by + bh / 2 - thumb / 2} ${thumb} ${thumb}`}
            >
              <image href={`/work/${task.image}`} width={task.width} height={task.height} />
              <Skeleton
                keypoints={fromCandidate(candidate.keypoints, task.width, task.height)}
                unit={thumb / 120}
              />
            </svg>
            <span className="block px-2 py-1">
              <b className="font-medium">{i + 1}</b> {candidate.name}
            </span>
          </button>
        ))}
      </div>

      <div className="col-span-2 grid grid-cols-5 gap-2">
        {[-0.2, -0.1, 0, 0.1, 0.2].map((offset) => {
          const frame = context(offset);
          return (
            <figure key={offset} className="text-center text-xs text-neutral-400">
              {offset === 0 ? (
                <svg
                  className="mx-auto block h-28 w-full rounded-md border border-sky-400 bg-black"
                  viewBox={`${crop.x} ${crop.y} ${crop.w} ${crop.h}`}
                >
                  <image href={`/work/${task.image}`} width={task.width} height={task.height} />
                </svg>
              ) : frame ? (
                <img
                  src={`/work/${frame.image}`}
                  alt=""
                  className="mx-auto block h-28 w-full rounded-md bg-black object-contain"
                />
              ) : (
                <div className="h-28 rounded-md bg-neutral-900" />
              )}
              <figcaption>
                {offset === 0 ? 'jetzt' : `${offset > 0 ? '+' : '−'}${Math.abs(offset)} s`}
              </figcaption>
            </figure>
          );
        })}
      </div>

      <div className="col-span-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-neutral-400">
        <p className="mr-auto">
          {selected === null
            ? 'Kein Punkt ausgewählt (Tab oder Punkt anklicken)'
            : `${KEYPOINT_NAMES[selected]}: ${VISIBILITY[keypoints[selected][2]]}`}
        </p>
        {LEGEND.map(([color, name]) => (
          <span key={name} className="flex items-center gap-1.5">
            <span className="size-3 rounded-full" style={{ background: color }} />
            {name}
          </span>
        ))}
        <span className="flex items-center gap-1.5">
          <span className="size-3 rounded-full border-2 border-neutral-300" />
          verdeckt
        </span>
        <span className="text-neutral-500">Seiten aus Sicht der Person</span>
      </div>
    </div>
  );
}
