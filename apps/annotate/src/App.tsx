import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Editor } from './Editor';
import { Overview } from './Overview';
import { toCoco } from './lib/coco';
import {
  afterSave,
  firstOpen,
  labelSchema,
  labellingOrder,
  nextDiscarded,
  previousSaved,
  tasksFileSchema,
  type Keypoint,
  type Label,
  type Task,
} from './lib/tasks';

const KEYS: [string, string][] = [
  ['1–9', 'Kandidat'],
  ['S', 'Seiten tauschen'],
  ['Tab', 'nächster Punkt'],
  ['Klick', 'Punkt hierhin'],
  ['H', 'verdeckt'],
  ['Entf', 'nicht im Bild'],
  ['Pfeile', 'verschieben'],
  ['Leertaste', 'speichern, weiter'],
  ['X', 'verwerfen'],
  ['Z', 'rückgängig'],
  ['P', 'zurück'],
  ['V', 'nächstes verworfenes'],
  ['O', 'Übersicht'],
  ['R', 'Zoom zurück'],
];

type Loaded = { tasks: Task[]; labels: Map<string, Label> };

async function load(): Promise<Loaded | string> {
  const response = await fetch('/work/tasks.json');
  if (!response.ok) return 'Keine tasks.json im Arbeitsordner: zuerst prepare.py laufen lassen.';
  const parsed = tasksFileSchema.safeParse(await response.json());
  if (!parsed.success) return `tasks.json ist ungültig: ${parsed.error.message}`;
  const stored: unknown[] = await (await fetch('/work/labels.json')).json();
  const labels = stored.flatMap((entry) => {
    const label = labelSchema.safeParse(entry);
    return label.success ? [label.data] : [];
  });
  return { tasks: parsed.data.tasks, labels: new Map(labels.map((l) => [l.id, l])) };
}

async function put(path: string, data: unknown) {
  const response = await fetch(`/work/${path}`, { method: 'PUT', body: JSON.stringify(data) });
  if (!response.ok) throw new Error(`${path} konnte nicht gespeichert werden.`);
}

export default function App() {
  const [loaded, setLoaded] = useState<Loaded | string | null>(null);

  useEffect(() => {
    load().then(setLoaded, (error: Error) => setLoaded(error.message));
  }, []);

  if (loaded === null) return <Message>Lädt …</Message>;
  if (typeof loaded === 'string') return <Message>{loaded}</Message>;
  return <Labelling tasks={loaded.tasks} initialLabels={loaded.labels} />;
}

function Labelling({ tasks, initialLabels }: { tasks: Task[]; initialLabels: Map<string, Label> }) {
  const order = useMemo(() => labellingOrder(tasks), [tasks]);
  const [labels, setLabels] = useState(initialLabels);
  // Labels arrive oldest first, so going back works across reloads.
  const [saved, setSaved] = useState(() => [...initialLabels.keys()]);
  const [current, setCurrent] = useState(() => firstOpen(order, initialLabels));
  const [notice, setNotice] = useState('');
  const [overview, setOverview] = useState(false);

  async function store(label: Label) {
    try {
      await put(`labels/${label.id}.json`, label);
      const next = new Map(labels).set(label.id, label);
      setLabels(next);
      const open = firstOpen(order, next);
      // Going through the discarded frames (V), Space and X lead to the next one.
      const discarded = labels.get(label.id)?.discarded
        ? nextDiscarded(saved, next, label.id)
        : null;
      setCurrent(
        discarded && discarded !== label.id ? discarded : afterSave(saved, label.id, open),
      );
      if (!saved.includes(label.id)) setSaved([...saved, label.id]);
      setNotice('');
    } catch (error) {
      setNotice((error as Error).message);
    }
  }

  async function exportCoco() {
    try {
      const sets = ['test', 'train'] as const;
      const files = sets.map((set) => toCoco(tasks, labels, set));
      await Promise.all(sets.map((set, i) => put(`coco_${set}.json`, files[i])));
      setNotice(
        `Exportiert: ${files[0].images.length} Test-, ${files[1].images.length} Trainingsbilder`,
      );
    } catch (error) {
      setNotice((error as Error).message);
    }
  }

  const task = tasks.find((t) => t.id === current);
  const times = [...labels.values()].map((l) => l.seconds);
  const average = times.length ? times.reduce((a, b) => a + b, 0) / times.length : 0;
  const progress = (set: Task['set']) => {
    const all = tasks.filter((t) => t.set === set);
    return `${all.filter((t) => labels.has(t.id)).length} / ${all.length}`;
  };

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex flex-wrap items-center gap-x-6 gap-y-1 border-b border-neutral-800 px-3 py-2 text-sm">
        <span>Test {progress('test')}</span>
        <span>Training {progress('train')}</span>
        <span className="text-neutral-400">
          {[...labels.values()].filter((l) => l.discarded).length} verworfen
        </span>
        <span className="text-neutral-400">Ø {average.toFixed(1)} s pro Bild</span>
        {task && (
          <span className="text-neutral-400">
            {task.video} · {task.time.toFixed(1)} s · Uneinigkeit {task.disagreement.toFixed(2)}
            {labels.get(task.id)?.discarded && ' · verworfen'}
          </span>
        )}
        <span className="ml-auto text-amber-300">{notice}</span>
        <button
          type="button"
          onClick={() => setOverview(!overview)}
          className="rounded-md border border-neutral-600 px-3 py-1 hover:bg-neutral-800"
        >
          {overview ? 'Zurück zum Bild' : 'Übersicht'}
        </button>
        <button
          type="button"
          onClick={exportCoco}
          className="rounded-md border border-neutral-600 px-3 py-1 hover:bg-neutral-800"
        >
          COCO exportieren
        </button>
      </header>

      {overview ? (
        <Overview
          order={order}
          labels={labels}
          saved={saved}
          onOpen={(id) => {
            setCurrent(id);
            setOverview(false);
          }}
          onClose={() => setOverview(false)}
        />
      ) : task ? (
        <Editor
          key={task.id}
          task={task}
          label={labels.get(task.id)}
          onSave={(keypoints: Keypoint[], seconds) =>
            store({ id: task.id, keypoints, discarded: false, seconds })
          }
          onDiscard={(keypoints: Keypoint[], seconds) =>
            store({ id: task.id, keypoints, discarded: true, seconds })
          }
          onPrevious={() => setCurrent(previousSaved(saved, current))}
          onNextDiscarded={() => setCurrent(nextDiscarded(saved, labels, current) ?? current)}
          onOverview={() => setOverview(true)}
        />
      ) : (
        <Message>
          Alle Bilder gelabelt. «COCO exportieren» schreibt die Dateien.{' '}
          <button
            type="button"
            onClick={() => setCurrent(previousSaved(saved, null))}
            className="underline"
          >
            Zum letzten Bild
          </button>
        </Message>
      )}

      <footer className="flex flex-wrap gap-x-4 gap-y-1 border-t border-neutral-800 px-3 py-2 text-xs text-neutral-400">
        {KEYS.map(([key, action]) => (
          <span key={key}>
            <b className="font-medium text-neutral-100">{key}</b> {action}
          </span>
        ))}
      </footer>
    </div>
  );
}

function Message({ children }: { children: ReactNode }) {
  return <p className="m-auto max-w-md p-6 text-center text-neutral-300">{children}</p>;
}
