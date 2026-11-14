import { Circle, Settings, Square, SquareDashed, X, Zap } from 'lucide-react';
import { Button } from '~/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select';
import { Toggle } from '~/components/ui/toggle';
import type { RunUp } from '@nomol/core/detection/session';
import type { Dock } from '@nomol/core/layout';
import { parseRunUp } from '@nomol/core/settings';
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

const START_MODES = [
  { value: 'sign', label: 'Start mit Zeichen' },
  { value: 'left', label: 'Auto von links' },
  { value: 'right', label: 'Auto von rechts' },
  { value: 'any', label: 'Auto bei Tempo' },
] as const;

/** Controls float over the camera image, so they get a dark, blurred backing. */
const floating =
  'rounded-full bg-black/60 font-semibold backdrop-blur hover:bg-black/75 data-[state=on]:bg-black/75 data-[state=on]:text-sky-300';
/** Beside the picture, on the strip's black. */
const docked =
  'rounded-full bg-white/10 font-semibold hover:bg-white/15 data-[state=on]:bg-white/15 data-[state=on]:text-sky-300';

type Props = {
  /** Where the bar sits: in the strip beside or below the picture, or over it (null). */
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
};

/**
 * The bar with status, start mode, start zone, settings and record button. Over the picture
 * it's one wrapping row, so the two groups stack instead of overlapping on narrow phones. In a
 * strip it's rows: three beside the picture, two below it with the record button lowest, within
 * thumb reach. Hidden while drawing the zone, whose own bar takes its place.
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
}: Props) {
  const recording = status === 'recording';
  const look = dock ? docked : floating;

  const statusPill = (
    <span
      className={cn(
        look,
        'inline-flex min-h-8 items-center gap-2 px-3 text-sm',
        dock && 'min-w-0 py-1 leading-tight',
        STATUS_STYLE[status],
      )}
    >
      <span aria-hidden className="size-2 shrink-0 rounded-full bg-current" />
      {STATUS_TEXT[status]}
    </span>
  );
  const startMode = (
    <Select
      value={runUp ?? 'sign'}
      disabled={recording}
      onValueChange={(value) => onRunUp(parseRunUp(value))}
    >
      <SelectTrigger
        size="sm"
        aria-label="Start"
        className={cn(
          look,
          'border-0',
          dock ? 'w-full min-w-0' : 'max-w-40 sm:max-w-60',
          runUp && 'text-sky-300',
        )}
      >
        {/* Beside the picture the icon would cut off "Auto bei Tempo". */}
        {dock !== 'side' && <Zap />}
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {START_MODES.map((mode) => (
          <SelectItem key={mode.value} value={mode.value}>
            {mode.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
  const zoneToggle = (
    <Toggle
      size="sm"
      pressed={editingZone}
      disabled={recording}
      onPressedChange={onEditZone}
      className={cn(look, dock && 'px-3')}
    >
      <SquareDashed />
      Startzone
    </Toggle>
  );
  const settings = (
    <Button
      size="icon-sm"
      variant="ghost"
      aria-label="Einstellungen"
      onClick={onSettings}
      className={look}
    >
      <Settings />
    </Button>
  );
  const record = recording ? (
    <Button
      size="icon-sm"
      variant="destructive"
      aria-label="Aufnahme stoppen"
      onClick={onStop}
      className="rounded-full"
    >
      <Square className="fill-current" />
    </Button>
  ) : (
    <Button
      size="icon-sm"
      variant={armed ? 'ghost' : 'destructive'}
      aria-label={armed ? 'Abbrechen' : 'Aufnahme starten'}
      disabled={!canArm || editingZone}
      onClick={() => onArm(!armed)}
      className={cn('rounded-full', armed && look)}
    >
      {armed ? <X /> : <Circle className="fill-current" />}
    </Button>
  );

  if (dock && editingZone) return null;
  if (dock === 'side') {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-start justify-between gap-2">
          {statusPill}
          {settings}
        </div>
        {startMode}
        <div className="flex items-center justify-between gap-2">
          {zoneToggle}
          {record}
        </div>
      </div>
    );
  }
  if (dock === 'bottom') {
    return (
      <div className="flex w-full flex-col gap-2 @xl:flex-row @xl:items-center">
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1 @xl:w-48 @xl:flex-none">{startMode}</div>
          {zoneToggle}
        </div>
        <div className="flex items-center gap-2 @xl:flex-1">
          <div className="flex min-w-0 flex-1">{statusPill}</div>
          {settings}
          {record}
        </div>
      </div>
    );
  }
  return (
    <div
      className={cn(
        'pointer-events-none absolute inset-x-3 top-3 z-20 flex flex-wrap items-center justify-between gap-2 *:pointer-events-auto',
        editingZone && 'hidden',
      )}
    >
      {statusPill}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {startMode}
        {zoneToggle}
        {settings}
        {record}
      </div>
    </div>
  );
}
