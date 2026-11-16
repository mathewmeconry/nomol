import { ChevronDown, Circle, Settings, Square, SquareDashed, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '~/components/ui/button';
import StartModeSheet from '~/components/StartModeSheet';
import { startMode } from '@nomol/core/start-modes';
import type { RunUp } from '@nomol/core/detection/session';
import type { Dock } from '@nomol/core/layout';
import type { Clip } from '@nomol/core/recording/clip';
import { cn } from 'cn';

export type Status = 'idle' | 'sign' | 'armed' | 'recording';

const STATUS_TEXT: Record<Status, string> = {
  idle: 'Bereit',
  sign: 'Zeichen erkannt …',
  armed: 'Warte auf Person in der Startzone',
  recording: 'Aufnahme läuft',
};

const STATUS_STYLE: Record<Status, string> = {
  idle: 'text-emerald-300',
  sign: 'text-amber-300',
  armed: 'text-amber-300',
  recording: 'text-red-300',
};

/** Controls over the camera image get a dark, blurred backing. */
const floating = 'bg-black/60 backdrop-blur';

type Props = {
  /** Where the controls sit: in the strip beside or below the picture, or over it (null). */
  dock: Dock;
  status: Status;
  runUp: RunUp | null;
  onRunUp: (runUp: RunUp | null) => void;
  editingZone: boolean;
  onEditZone: (editing: boolean) => void;
  armed: boolean;
  /** Detection is ready, so "Aufnahme starten" can work. */
  canArm: boolean;
  onArm: (armed: boolean) => void;
  onStop: () => void;
  onSettings: () => void;
  /** A clip is on screen: only the status and a small record button stay. */
  replay: boolean;
  /** Newest first. */
  clips: Clip[];
  onClips: () => void;
  /** Docked: the zone editor's bar, in the strip's scrolling part. */
  children?: ReactNode;
  /** Docked on the side: the strip right of the picture, for the record button and its row. */
  recordSlot: HTMLElement | null;
};

/**
 * Laid out like a phone's camera app: status on top, then how recordings start, and a row with
 * the clips, a large round record button and the start zone, lowest within thumb reach. In
 * landscape that row stands upright right of the picture, the rest is left of it.
 */
export default function LiveControls({
  dock,
  status,
  runUp,
  onRunUp,
  editingZone,
  onEditZone,
  armed,
  canArm,
  onArm,
  onStop,
  onSettings,
  replay,
  clips,
  onClips,
  children,
  recordSlot,
}: Props) {
  const [choosingMode, setChoosingMode] = useState(false);
  const recording = status === 'recording';
  const live = !replay && !editingZone;
  const mode = startMode(runUp);
  const latest = clips[0];

  const statusLine = (
    <p
      role="status"
      className={cn(
        'flex min-w-0 items-center gap-2 leading-tight font-semibold',
        dock === 'bottom' && 'flex-1',
        // Left of a 16:9 picture the strip is narrow and longer states wrap over several lines.
        dock === 'side' && 'items-baseline @max-[9rem]:text-sm',
        !dock && cn(floating, 'rounded-full px-3 py-2 text-sm'),
        STATUS_STYLE[status],
      )}
    >
      <span aria-hidden className="size-2.5 shrink-0 rounded-full bg-current" />
      {STATUS_TEXT[status]}
    </p>
  );
  const settings = (
    <Button
      size="icon"
      variant="ghost"
      aria-label="Einstellungen"
      onClick={onSettings}
      className={cn('shrink-0 rounded-full text-slate-300', !dock && floating)}
    >
      <Settings />
    </Button>
  );
  // While a clip is on screen there's no room for the record row, but a recording can still run.
  const smallRecord = recording ? (
    <Button
      size="icon"
      variant="destructive"
      aria-label="Aufnahme stoppen"
      onClick={onStop}
      className="shrink-0 rounded-full"
    >
      <Square className="fill-current" />
    </Button>
  ) : (
    <Button
      size="icon"
      variant={armed ? 'ghost' : 'destructive'}
      aria-label={armed ? 'Abbrechen' : 'Aufnahme starten'}
      disabled={!canArm}
      onClick={() => onArm(!armed)}
      className={cn('shrink-0 rounded-full', armed && floating)}
    >
      {armed ? <X /> : <Circle className="fill-current" />}
    </Button>
  );
  const modeButton = (
    <Button
      variant="secondary"
      disabled={recording}
      onClick={() => setChoosingMode(true)}
      className={cn(
        'h-12 min-w-0 justify-between gap-2 rounded-xl text-left',
        // Left of the picture the strip may be narrow: the name wraps instead of being cut.
        dock === 'side'
          ? 'h-auto min-h-12 w-full py-2 whitespace-normal @max-[9rem]:px-2 @max-[9rem]:[&>svg]:hidden'
          : 'w-56',
        !dock && floating,
      )}
    >
      <span className="flex min-w-0 flex-col leading-tight">
        <span className="text-xs font-normal text-slate-400">Start</span>
        <span className={cn(dock !== 'side' && 'truncate')}>{mode.short}</span>
      </span>
      <ChevronDown />
    </Button>
  );
  // Docked it keeps its space when hidden: the strip's height sets the picture's size, which
  // shouldn't jump when a recording starts.
  const hint = (status === 'idle' || dock) && (
    <p
      className={cn(
        'text-sm leading-snug text-slate-300',
        !dock && 'max-w-sm text-center',
        status !== 'idle' && 'invisible',
      )}
    >
      {mode.description}
    </p>
  );

  const itemLabel = 'text-[11px] leading-none font-semibold whitespace-nowrap text-slate-300';
  // Smaller in a narrow strip, so the labels don't run into each other.
  const clipsItem = latest ? (
    <button type="button" onClick={onClips} className="flex flex-col items-center gap-1.5">
      <span className="size-12 overflow-hidden rounded-lg border-2 border-white/30 bg-slate-800 @max-2xs:size-11">
        {latest.thumbnail && (
          <img src={latest.thumbnail} alt="" className="h-full w-full object-cover" />
        )}
      </span>
      <span className={itemLabel}>Clips ({clips.length})</span>
    </button>
  ) : (
    <span />
  );
  const recordItem = (
    <button
      type="button"
      disabled={!recording && !canArm}
      onClick={() => (recording ? onStop() : onArm(!armed))}
      className="flex flex-col items-center gap-1.5 disabled:opacity-40"
    >
      <span
        className={cn(
          'flex size-16 items-center justify-center rounded-full border-4 @max-2xs:size-14',
          recording ? 'border-red-500' : armed ? 'border-amber-300' : 'border-white',
        )}
      >
        {recording ? (
          <Square className="size-7 fill-red-500 text-red-500" />
        ) : armed ? (
          <X className="size-8 text-amber-300" />
        ) : (
          <span className="size-12 rounded-full bg-red-600 @max-2xs:size-10" />
        )}
      </span>
      <span className={itemLabel}>{recording ? 'Stoppen' : armed ? 'Abbrechen' : 'Aufnehmen'}</span>
    </button>
  );
  const zoneItem = (
    <button
      type="button"
      disabled={recording}
      onClick={() => onEditZone(true)}
      className="flex flex-col items-center gap-1.5 disabled:opacity-40"
    >
      <span className="flex size-12 items-center justify-center rounded-full bg-white/10 @max-2xs:size-11">
        <SquareDashed className="size-6 text-sky-300" />
      </span>
      <span className={itemLabel}>Startzone</span>
    </button>
  );
  const recordRow = (
    <div className="grid grid-cols-[1fr_auto_1fr] items-end justify-items-center gap-1">
      {clipsItem}
      {recordItem}
      {zoneItem}
    </div>
  );
  // Right of the picture, as a phone's camera app held sideways: record button in the middle.
  const recordColumn = (
    <>
      <div className="flex justify-center">{settings}</div>
      <div className="flex flex-1 flex-col items-center justify-evenly">
        {zoneItem}
        {recordItem}
        {clipsItem}
      </div>
    </>
  );

  const sheet = (
    <StartModeSheet
      open={choosingMode}
      onOpenChange={setChoosingMode}
      runUp={runUp}
      onRunUp={onRunUp}
    />
  );

  if (dock === 'side') {
    return (
      <>
        {!editingZone && statusLine}
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-x-hidden overflow-y-auto overscroll-contain">
          {live && modeButton}
          {live && hint}
          {children}
        </div>
        {live && recordSlot && createPortal(recordColumn, recordSlot)}
        {sheet}
      </>
    );
  }
  if (dock) {
    return (
      <>
        {!editingZone && (
          <div className="flex items-center gap-2">
            {statusLine}
            {/* Below the picture the strip may be only 200 px high: one row for both. */}
            {live && modeButton}
            {settings}
          </div>
        )}
        {/* Scrolls if the strip is too short; status and record row stay put. */}
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain">
          {live && hint}
          {children && <div className="mt-auto flex flex-wrap items-center gap-2">{children}</div>}
        </div>
        {live && recordRow}
        {sheet}
      </>
    );
  }
  if (editingZone) return null;
  return (
    <>
      <div className="pointer-events-none absolute inset-x-3 top-3 z-20 flex items-start gap-2 *:pointer-events-auto">
        {statusLine}
        <span className="flex-1" />
        {live ? modeButton : smallRecord}
        {settings}
      </div>
      {live && (
        <div className="pointer-events-none absolute inset-x-3 bottom-3 z-20 flex flex-col items-center gap-2 *:pointer-events-auto">
          {hint && <div className={cn(floating, 'rounded-xl px-4 py-2')}>{hint}</div>}
          <div className={cn(floating, 'w-72 rounded-3xl px-2 py-2')}>{recordRow}</div>
        </div>
      )}
      {sheet}
    </>
  );
}
