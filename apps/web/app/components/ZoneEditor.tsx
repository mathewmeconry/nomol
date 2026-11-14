import { useState, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '~/components/ui/button';
import { normalizeZone, type Zone } from '@nomol/core/detection/zone';
import type { Point } from '@nomol/core/detection/pose';
import { cn } from 'cn';
import { DEFAULT_ZONE } from '@nomol/core/settings';

/** Smaller than about one body width is almost certainly a slip of the finger. */
const MIN_SIZE = 0.05;

type Props = {
  zone: Zone;
  onSave: (zone: Zone) => void;
  onCancel: () => void;
  /** The strip beside the picture, when the controls are docked there. */
  dock?: HTMLElement | null;
};

function toPoint(event: PointerEvent<HTMLDivElement>): Point {
  const rect = event.currentTarget.getBoundingClientRect();
  return {
    x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
    y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
  };
}

/** Coach draws the start zone on the live image. Its bottom edge marks the floor. */
export default function ZoneEditor({ zone, onSave, onCancel, dock }: Props) {
  const [draft, setDraft] = useState<Zone>(zone);
  const [anchor, setAnchor] = useState<Point | null>(null);
  const tooSmall = draft.right - draft.left < MIN_SIZE || draft.bottom - draft.top < MIN_SIZE;

  /*
    In the strip beside the picture when docked. Otherwise anchored to the screen, not the
    picture: in portrait it sits in the empty space around the video. It takes the side away
    from the floor line and steps aside while drawing.
  */
  const bar = (
    <div
      className={cn(
        'flex flex-wrap items-center gap-2 select-none',
        dock
          ? 'w-full'
          : 'fixed inset-x-3 z-30 rounded-xl bg-slate-900/85 px-3 py-2 backdrop-blur transition-opacity',
        !dock && (draft.bottom > 0.5 ? 'top-3' : 'bottom-3'),
        !dock && anchor && 'pointer-events-none opacity-0',
      )}
    >
      <p className="min-w-40 flex-1 text-sm text-slate-300">
        {tooSmall
          ? 'Zu klein. Zieh einen grösseren Bereich auf.'
          : 'Zieh die Startzone auf. Die untere Kante ist der Boden.'}
      </p>
      <Button variant="outline" onClick={() => setDraft(DEFAULT_ZONE)}>
        Standard
      </Button>
      <Button variant="outline" onClick={onCancel}>
        Abbrechen
      </Button>
      <Button disabled={tooSmall} onClick={() => onSave(draft)}>
        Speichern
      </Button>
    </div>
  );

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
          className="absolute border-2 border-b-4 border-sky-300 bg-sky-400/15"
          style={{
            left: `${draft.left * 100}%`,
            top: `${draft.top * 100}%`,
            width: `${(draft.right - draft.left) * 100}%`,
            height: `${(draft.bottom - draft.top) * 100}%`,
          }}
        >
          <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 translate-y-full rounded bg-sky-300 px-1.5 text-xs font-semibold text-slate-950">
            Boden
          </span>
        </div>
      </div>

      {dock ? createPortal(bar, dock) : bar}
    </>
  );
}
