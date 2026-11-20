import { useEffect, useState, type ReactNode } from 'react';
import { cn } from 'cn';
import { Skeleton } from './Skeleton';
import type { Label, Task } from './lib/tasks';

type Status = 'open' | 'done' | 'discarded';
type Props = {
  /** In labelling order. */
  order: Task[];
  labels: Map<string, Label>;
  /** Ids in the order saved, oldest first. */
  saved: string[];
  onOpen: (id: string) => void;
  onClose: () => void;
};

const STATUS: [Status, string][] = [
  ['open', 'Offen'],
  ['done', 'Gelabelt'],
  ['discarded', 'Verworfen'],
];
const SETS: [Task['set'], string][] = [
  ['test', 'Test'],
  ['train', 'Training'],
];

function statusOf(label: Label | undefined): Status {
  if (!label) return 'open';
  return label.discarded ? 'discarded' : 'done';
}

/** All frames as thumbnails, by state, to pick one to (re)label. */
export function Overview({ order, labels, saved, onOpen, onClose }: Props) {
  const [status, setStatus] = useState<Status>('done');
  const [set, setSet] = useState<Task['set']>('test');

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape' || event.key.toLowerCase() === 'o') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const ofSet = order.filter((task) => task.set === set);
  const count = (s: Status) => ofSet.filter((task) => statusOf(labels.get(task.id)) === s).length;
  // Open ones as they come up for labelling, labelled ones newest first.
  const shown =
    status === 'open'
      ? ofSet.filter((task) => !labels.has(task.id))
      : saved
          .toReversed()
          .map((id) => ofSet.find((task) => task.id === id))
          .filter((task): task is Task => !!task && statusOf(labels.get(task.id)) === status);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
        {SETS.map(([value, name]) => (
          <Tab key={value} active={set === value} onClick={() => setSet(value)}>
            {name}
          </Tab>
        ))}
        <span className="mx-2 h-5 border-l border-neutral-700" />
        {STATUS.map(([value, name]) => (
          <Tab key={value} active={status === value} onClick={() => setStatus(value)}>
            {name} ({count(value)})
          </Tab>
        ))}
      </div>
      <div className="grid min-h-0 grid-cols-[repeat(auto-fill,minmax(150px,1fr))] content-start gap-2 overflow-y-auto p-3">
        {shown.map((task) => (
          <Thumbnail
            key={task.id}
            task={task}
            label={labels.get(task.id)}
            onClick={() => onOpen(task.id)}
          />
        ))}
        {shown.length === 0 && <p className="text-neutral-500">Keine Bilder.</p>}
      </div>
    </div>
  );
}

function Tab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-md px-3 py-1',
        active ? 'bg-neutral-700 text-neutral-100' : 'text-neutral-400 hover:bg-neutral-800',
      )}
    >
      {children}
    </button>
  );
}

/**
 * The frame zoomed to the person. A lazily loaded <img> moved inside a square, since an SVG
 * <image> would load every frame at once; the skeleton is drawn over it in frame coordinates.
 */
function Thumbnail({
  task,
  label,
  onClick,
}: {
  task: Task;
  label: Label | undefined;
  onClick: () => void;
}) {
  const [bx, by, bw, bh] = task.box;
  const side = Math.max(bw, bh) * 1.15;
  const x = bx + bw / 2 - side / 2;
  const y = by + bh / 2 - side / 2;
  return (
    <button
      type="button"
      onClick={onClick}
      title={`${task.video} · ${task.time.toFixed(1)} s`}
      className="overflow-hidden rounded-md border border-neutral-700 text-left text-xs hover:border-sky-400"
    >
      <div className="relative aspect-square overflow-hidden bg-black">
        <img
          src={`/work/${task.image}`}
          alt=""
          loading="lazy"
          className="absolute max-w-none"
          style={{
            width: `${(task.width / side) * 100}%`,
            left: `${(-x / side) * 100}%`,
            top: `${(-y / side) * 100}%`,
          }}
        />
        {label && !label.discarded && (
          <svg className="absolute inset-0 h-full w-full" viewBox={`${x} ${y} ${side} ${side}`}>
            {/* Thumbnails are ~160 px wide. */}
            <Skeleton keypoints={label.keypoints} unit={(side / 160) * 0.6} />
          </svg>
        )}
      </div>
      <span className="block truncate px-2 py-1 text-neutral-400">
        {task.video.replace(/^\w+\/nomol-/, '').replace(/\.\w+$/, '')} · {task.time.toFixed(1)} s
      </span>
    </button>
  );
}
