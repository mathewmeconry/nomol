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
import { runUpSchema } from '~/lib/zone-storage';
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

type Props = {
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
 * The bar over the live picture. One wrapping row, so the two groups stack instead of
 * overlapping on narrow phones. Hidden while drawing the zone, whose own bar may need the top.
 */
export default function LiveControls({
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
  return (
    <div
      className={cn(
        'pointer-events-none absolute inset-x-3 top-3 z-20 flex flex-wrap items-center justify-between gap-2 *:pointer-events-auto',
        editingZone && 'hidden',
      )}
    >
      <span
        className={cn(
          floating,
          'inline-flex h-8 items-center gap-2 px-3 text-sm',
          STATUS_STYLE[status],
        )}
      >
        <span aria-hidden className="size-2 rounded-full bg-current" />
        {STATUS_TEXT[status]}
      </span>

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Select
          value={runUp ?? 'sign'}
          disabled={recording}
          onValueChange={(value) => onRunUp(runUpSchema.safeParse(value).data ?? null)}
        >
          <SelectTrigger
            size="sm"
            aria-label="Start"
            className={cn(floating, 'max-w-40 border-0 sm:max-w-60', runUp && 'text-sky-300')}
          >
            <Zap />
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
        <Toggle
          size="sm"
          pressed={editingZone}
          disabled={recording}
          onPressedChange={onEditZone}
          className={floating}
        >
          <SquareDashed />
          Startzone
        </Toggle>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Einstellungen"
          onClick={onSettings}
          className={floating}
        >
          <Settings />
        </Button>
        {recording ? (
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
            className={cn('rounded-full', armed && floating)}
          >
            {armed ? <X /> : <Circle className="fill-current" />}
          </Button>
        )}
      </div>
    </div>
  );
}
