import { useState, type PointerEvent } from 'react';
import { Button } from '~/components/ui/button';
import { normalizeZone, type Zone } from '~/lib/detection/zone';
import type { Point } from '~/lib/detection/pose';
import { DEFAULT_ZONE } from '~/lib/zone-storage';

/** Smaller than about one body width is almost certainly a slip of the finger. */
const MIN_SIZE = 0.05;

type Props = {
  zone: Zone;
  onSave: (zone: Zone) => void;
  onCancel: () => void;
};

function toPoint(event: PointerEvent<HTMLDivElement>): Point {
  const rect = event.currentTarget.getBoundingClientRect();
  return {
    x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
    y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
  };
}

/** Coach draws the start zone on the live image. Its bottom edge marks the floor. */
export default function ZoneEditor({ zone, onSave, onCancel }: Props) {
  const [draft, setDraft] = useState<Zone>(zone);
  const [anchor, setAnchor] = useState<Point | null>(null);
  const tooSmall = draft.right - draft.left < MIN_SIZE || draft.bottom - draft.top < MIN_SIZE;

  return (
    <>
      <div
        className="absolute inset-0 cursor-crosshair touch-none bg-black/30"
        aria-label="Startzone zeichnen"
        role="application"
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          const point = toPoint(event);
          setAnchor(point);
          setDraft(normalizeZone(point, point));
        }}
        onPointerMove={(event) => {
          if (anchor) setDraft(normalizeZone(anchor, toPoint(event)));
        }}
        onPointerUp={() => setAnchor(null)}
      >
        <div
          className="absolute border-2 border-sky-300 bg-sky-400/15"
          style={{
            left: `${draft.left * 100}%`,
            top: `${draft.top * 100}%`,
            width: `${(draft.right - draft.left) * 100}%`,
            height: `${(draft.bottom - draft.top) * 100}%`,
          }}
        />
      </div>

      <div className="absolute inset-x-0 bottom-0 flex flex-wrap items-center gap-3 bg-slate-900/95 px-4 py-3">
        <p className="min-w-48 flex-1 text-sm text-slate-300">
          {tooSmall
            ? 'Zu klein. Zieh einen grösseren Bereich auf.'
            : 'Zieh die Startzone mit dem Finger auf. Die untere Kante ist der Boden, auf dem die Turnerinnen stehen.'}
        </p>
        <Button variant="outline" size="lg" onClick={() => setDraft(DEFAULT_ZONE)}>
          Standard
        </Button>
        <Button variant="outline" size="lg" onClick={onCancel}>
          Abbrechen
        </Button>
        <Button size="lg" disabled={tooSmall} onClick={() => onSave(draft)}>
          Speichern
        </Button>
      </div>
    </>
  );
}
