import { Check } from 'lucide-react';
import type { ReactNode } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog';
import type { RunUp } from '@nomol/core/detection/session';
import { START_MODES, START_MODES_NOTE } from '@nomol/core/start-modes';
import { cn } from 'cn';

const strokes = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2.5,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

function zoneRect(x: number) {
  return (
    <rect
      x={x}
      y="12"
      width="20"
      height="32"
      fill="none"
      className="stroke-sky-400"
      strokeWidth="2"
      strokeDasharray="3 3"
    />
  );
}

/** A small picture of each way to start, by its `runUp` (`sign` for the start sign). */
const PICTURES: Record<RunUp | 'sign', ReactNode> = {
  sign: (
    <>
      <path d="M28 24v14M28 38l-4 10M28 38l4 10M25 26l-6-8 15-9M31 26l6-8-15-9" {...strokes} />
      <circle cx="28" cy="20" r="3.5" fill="currentColor" />
    </>
  ),
  left: (
    <>
      {zoneRect(30)}
      <path d="M6 30h20m-6-6 6 6-6 6" {...strokes} />
    </>
  ),
  right: (
    <>
      {zoneRect(6)}
      <path d="M50 30H30m6-6-6 6 6 6" {...strokes} />
    </>
  ),
  any: (
    <>
      <path d="M14 40 28 16l14 24" {...strokes} />
      <path d="M8 30h6M8 36h4M42 30h6M44 36h4" {...strokes} className="text-sky-400" />
    </>
  ),
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  runUp: RunUp | null;
  onRunUp: (runUp: RunUp | null) => void;
};

/** How recordings start, each way with a picture, a sentence and where it fits. */
export default function StartModeSheet({ open, onOpenChange, runUp, onRunUp }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* A sheet from the bottom, within thumb reach. */}
      <DialogContent className="top-auto bottom-0 max-h-dvh translate-y-0 gap-3 overflow-y-auto rounded-t-2xl rounded-b-none p-4 max-sm:max-w-none sm:max-w-3xl">
        <DialogHeader className="text-left">
          <DialogTitle className="text-xl">Wie soll die Aufnahme starten?</DialogTitle>
          <DialogDescription>{START_MODES_NOTE}</DialogDescription>
        </DialogHeader>
        <div role="radiogroup" aria-label="Start" className="grid gap-2 sm:grid-cols-2">
          {START_MODES.map((mode) => {
            const chosen = mode.runUp === runUp;
            return (
              <button
                key={mode.title}
                type="button"
                role="radio"
                aria-checked={chosen}
                onClick={() => {
                  onRunUp(mode.runUp);
                  onOpenChange(false);
                }}
                className={cn(
                  'flex items-center gap-3 rounded-2xl border-2 p-3 text-left',
                  chosen ? 'border-sky-400 bg-sky-950/60' : 'border-transparent bg-white/8',
                )}
              >
                <svg
                  viewBox="0 0 56 56"
                  aria-hidden
                  className="size-14 shrink-0 rounded-xl bg-black text-slate-100"
                >
                  {PICTURES[mode.runUp ?? 'sign']}
                </svg>
                <span className="min-w-0 flex-1">
                  <span className="block font-bold">{mode.title}</span>
                  <span className="mt-0.5 block text-sm leading-snug text-slate-300">
                    {mode.description}
                  </span>
                  <span className="mt-1 block text-xs font-semibold text-sky-300">
                    {mode.goodFor}
                  </span>
                </span>
                {chosen && (
                  <Check className="size-6 shrink-0 rounded-full bg-sky-400 p-1 text-black" />
                )}
              </button>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
