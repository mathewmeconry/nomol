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
        'flex flex-col gap-3 select-none',
        dock
          ? 'w-full'
          : 'fixed inset-x-3 z-30 mx-auto max-w-xl rounded-xl bg-slate-900/90 p-3 backdrop-blur transition-opacity',
        !dock && (drafts[selected].bottom > 0.5 ? 'top-3' : 'bottom-3'),
        !dock && anchor && 'pointer-events-none opacity-0',
      )}
    >
      <div>
        <p className="font-bold">{several ? `Startzone ${selected + 1}` : 'Startzone'}</p>
        {/* Where the bottom edge goes is what coaches got wrong: it's the floor line. */}
        <p className="mt-1 text-sm leading-snug text-slate-300">
          {tooSmall ? (
            'Zu klein. Zieh einen grösseren Bereich auf.'
          ) : (
            <>
              Zieh einen Rahmen um die Stelle, wo gestartet wird. Die{' '}
              <strong className="text-amber-300">untere Kante</strong> gehört dahin, wo die Füsse
              nach dem Element stehen (Sprung: auf oder hinter der Landematte).
            </>
          )}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
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
      </div>
      {/* Stacked in the narrow strip left of the picture. */}
      <div className="grid grid-cols-2 gap-2 @max-3xs:grid-cols-1">
        <Button variant="outline" size="lg" onClick={onCancel}>
          Abbrechen
        </Button>
        <Button
          size="lg"
          disabled={tooSmall}
          onClick={() => onSave(drafts)}
          className="bg-sky-400 text-slate-950 hover:bg-sky-300"
        >
          Speichern
        </Button>
      </div>
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
                ? 'border-sky-300 border-b-amber-300 bg-sky-400/15'
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
                'absolute -bottom-1 left-1/2 -translate-x-1/2 translate-y-full rounded px-1.5 text-xs font-semibold whitespace-nowrap text-slate-950',
                i === selected ? 'bg-amber-300' : 'bg-slate-300/80',
              )}
            >
              {i === selected ? 'Boden · hier stehen die Füsse' : 'Boden'}
            </span>
          </div>
        ))}
      </div>

      {dock ? createPortal(bar, dock) : bar}
    </>
  );
}
