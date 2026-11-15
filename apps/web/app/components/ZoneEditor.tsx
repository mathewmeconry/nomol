import { useState, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '~/components/ui/button';
import { MAX_ZONES, normalizeZone, secondZone, type Zone } from '@nomol/core/detection/zone';
import type { Point } from '@nomol/core/detection/pose';
import { cn } from 'cn';
import { DEFAULT_ZONE } from '@nomol/core/settings';

/** Smaller than about one body width is almost certainly a slip of the finger. */
const MIN_SIZE = 0.05;

type Props = {
  zones: Zone[];
  onSave: (zones: Zone[]) => void;
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

function isTooSmall(zone: Zone) {
  return zone.right - zone.left < MIN_SIZE || zone.bottom - zone.top < MIN_SIZE;
}

/**
 * Coach draws the start zones on the live image; their bottom edges mark the floor. Dragging
 * draws the selected one; a second one is for gymnasts starting at the other end of the floor
 * track.
 */
export default function ZoneEditor({ zones, onSave, onCancel, dock }: Props) {
  const [drafts, setDrafts] = useState<Zone[]>(zones);
  const [selected, setSelected] = useState(0);
  const [anchor, setAnchor] = useState<Point | null>(null);
  const tooSmall = drafts.some(isTooSmall);
  const several = drafts.length > 1;

  function draw(zone: Zone) {
    setDrafts(drafts.map((draft, i) => (i === selected ? zone : draft)));
  }

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
        !dock && (drafts[selected].bottom > 0.5 ? 'top-3' : 'bottom-3'),
        !dock && anchor && 'pointer-events-none opacity-0',
      )}
    >
      <p className="min-w-40 flex-1 text-sm text-slate-300">
        {tooSmall
          ? 'Zu klein. Zieh einen grösseren Bereich auf.'
          : several
            ? `Zieh Startzone ${selected + 1} auf. Die untere Kante ist der Boden.`
            : 'Zieh die Startzone auf. Die untere Kante ist der Boden.'}
      </p>
      {several &&
        drafts.map((_draft, i) => (
          <Button
            key={i}
            variant={i === selected ? 'default' : 'outline'}
            aria-pressed={i === selected}
            onClick={() => setSelected(i)}
          >
            Zone {i + 1}
          </Button>
        ))}
      {several ? (
        <Button
          variant="outline"
          onClick={() => {
            setDrafts(drafts.filter((_draft, i) => i !== selected));
            setSelected(0);
          }}
        >
          Zone {selected + 1} entfernen
        </Button>
      ) : (
        drafts.length < MAX_ZONES && (
          <Button
            variant="outline"
            onClick={() => {
              setDrafts([...drafts, secondZone(drafts[0])]);
              setSelected(drafts.length);
            }}
          >
            Zweite Zone
          </Button>
        )
      )}
      <Button
        variant="outline"
        onClick={() => {
          setDrafts([DEFAULT_ZONE]);
          setSelected(0);
        }}
      >
        Standard
      </Button>
      <Button variant="outline" onClick={onCancel}>
        Abbrechen
      </Button>
      <Button disabled={tooSmall} onClick={() => onSave(drafts)}>
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
          draw(normalizeZone(point, point));
        }}
        onPointerMove={(event) => {
          if (anchor) draw(normalizeZone(anchor, toPoint(event)));
        }}
        onPointerUp={() => setAnchor(null)}
      >
        {drafts.map((draft, i) => (
          <div
            key={i}
            className={cn(
              'absolute border-2 border-b-4',
              i === selected
                ? 'border-sky-300 bg-sky-400/15'
                : 'border-slate-300/60 bg-slate-300/10',
            )}
            style={{
              left: `${draft.left * 100}%`,
              top: `${draft.top * 100}%`,
              width: `${(draft.right - draft.left) * 100}%`,
              height: `${(draft.bottom - draft.top) * 100}%`,
            }}
          >
            {several && (
              <span className="absolute top-1 left-1 text-sm font-semibold text-slate-100">
                {i + 1}
              </span>
            )}
            <span
              className={cn(
                'absolute -bottom-1 left-1/2 -translate-x-1/2 translate-y-full rounded px-1.5 text-xs font-semibold text-slate-950',
                i === selected ? 'bg-sky-300' : 'bg-slate-300/80',
              )}
            >
              Boden
            </span>
          </div>
        ))}
      </div>

      {dock ? createPortal(bar, dock) : bar}
    </>
  );
}
