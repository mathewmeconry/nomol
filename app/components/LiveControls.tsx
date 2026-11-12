import { Camera, Circle, SquareDashed, Volume2, Zap } from 'lucide-react';
import { Button } from '~/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select';
import { Toggle } from '~/components/ui/toggle';
import type useWideAngle from '~/hooks/use-wide-angle';
import type { RunUp } from '~/lib/detection/session';
import { cn } from '~/lib/utils';

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
] as const;

/** Controls float over the camera image, so they get a dark, blurred backing. */
const floating =
  'rounded-full bg-black/60 font-semibold backdrop-blur hover:bg-black/75 data-[state=on]:bg-black/75 data-[state=on]:text-sky-300';

type Props = {
  status: Status;
  soundReady: boolean;
  cameras: MediaDeviceInfo[];
  cameraId: string | undefined;
  onCamera: (deviceId: string) => void;
  wideAngle: ReturnType<typeof useWideAngle>;
  runUp: RunUp | null;
  onRunUp: (runUp: RunUp | null) => void;
  editingZone: boolean;
  onEditZone: (editing: boolean) => void;
  armed: boolean;
  /** Detection is ready, so "Aufnahme starten" can work. */
  canArm: boolean;
  onArm: (armed: boolean) => void;
};

/**
 * The bar over the live picture. One wrapping row, so the two groups stack instead of
 * overlapping on narrow phones. Hidden while drawing the zone, whose own bar may need the top.
 */
export default function LiveControls({
  status,
  soundReady,
  cameras,
  cameraId,
  onCamera,
  wideAngle,
  runUp,
  onRunUp,
  editingZone,
  onEditZone,
  armed,
  canArm,
  onArm,
}: Props) {
  const recording = status === 'recording';
  return (
    <div
      className={cn(
        'pointer-events-none absolute inset-x-3 top-3 z-20 flex flex-wrap items-center justify-between gap-2 *:pointer-events-auto',
        editingZone && 'hidden',
      )}
    >
      <div className="flex items-center gap-2">
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
        {!soundReady && (
          <Button variant="ghost" size="sm" className={floating}>
            <Volume2 />
            Ton einschalten
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2">
        {cameras.length > 1 && (
          <Select value={cameraId ?? ''} disabled={recording} onValueChange={onCamera}>
            <SelectTrigger
              size="sm"
              aria-label="Kamera"
              className={cn(floating, 'max-w-40 border-0 sm:max-w-52')}
            >
              <Camera />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {cameras.map((device, index) => (
                <SelectItem key={device.deviceId} value={device.deviceId}>
                  {device.label || `Kamera ${index + 1}`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {wideAngle.zoom !== undefined && (
          <Toggle
            size="sm"
            pressed={wideAngle.wide}
            disabled={recording}
            onPressedChange={wideAngle.toggle}
            className={floating}
          >
            {`${wideAngle.zoom.toLocaleString('de-CH')}×`}
          </Toggle>
        )}
        <Select
          value={runUp ?? 'sign'}
          disabled={recording}
          onValueChange={(value) => onRunUp(value === 'left' || value === 'right' ? value : null)}
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
          size="sm"
          variant={armed ? 'ghost' : 'destructive'}
          disabled={recording || !canArm || editingZone}
          onClick={() => onArm(!armed)}
          className={cn('rounded-full', armed && floating)}
        >
          {armed ? (
            'Abbrechen'
          ) : (
            <>
              <Circle className="fill-current" />
              Aufnahme starten
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
