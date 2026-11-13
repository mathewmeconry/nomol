import { Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '~/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select';
import { Switch } from '~/components/ui/switch';
import type useWideAngle from '~/hooks/use-wide-angle';

const BUILT_AT = new Date(__BUILD_TIME__).toLocaleString('de-CH', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Camera and zoom can't change during a recording. */
  recording: boolean;
  cameras: MediaDeviceInfo[];
  cameraId: string | undefined;
  onCamera: (deviceId: string) => void;
  wideAngle: ReturnType<typeof useWideAngle>;
  soundOn: boolean;
  onSound: (on: boolean) => void;
  clipCount: number;
  onDeleteAll: () => void;
};

/** What's set up once per device, kept off the live picture. */
export default function Settings({
  open,
  onOpenChange,
  recording,
  cameras,
  cameraId,
  onCamera,
  wideAngle,
  soundOn,
  onSound,
  clipCount,
  onDeleteAll,
}: Props) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setConfirmingDelete(false);
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Einstellungen</DialogTitle>
          <DialogDescription>Gelten für dieses Gerät.</DialogDescription>
        </DialogHeader>

        <section className="grid gap-2">
          <h3 className="text-sm font-semibold">Kamera</h3>
          {cameras.length > 1 ? (
            <Select value={cameraId ?? ''} disabled={recording} onValueChange={onCamera}>
              <SelectTrigger aria-label="Kamera" className="w-full">
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
          ) : (
            <p className="text-sm text-muted-foreground">Nur eine Kamera verfügbar.</p>
          )}
          {wideAngle.zoom !== undefined && (
            <div className="flex items-center justify-between gap-4 text-sm">
              <label htmlFor="settings-wide">
                {`Weitwinkel (${wideAngle.zoom.toLocaleString('de-CH')}×)`}
              </label>
              <Switch
                id="settings-wide"
                checked={wideAngle.wide}
                disabled={recording}
                onCheckedChange={wideAngle.toggle}
              />
            </div>
          )}
        </section>

        <section className="grid gap-2">
          <h3 className="text-sm font-semibold">Ton</h3>
          <div className="flex items-center justify-between gap-4 text-sm">
            <label htmlFor="settings-sound">Piepton beim Aufnahmestart</label>
            <Switch id="settings-sound" checked={soundOn} onCheckedChange={onSound} />
          </div>
        </section>

        <section className="grid gap-2">
          <h3 className="text-sm font-semibold">Aufnahmen</h3>
          <Button
            variant={confirmingDelete ? 'destructive' : 'secondary'}
            disabled={clipCount === 0}
            onClick={() => {
              if (!confirmingDelete) return setConfirmingDelete(true);
              setConfirmingDelete(false);
              onDeleteAll();
            }}
            className={confirmingDelete ? '' : 'text-red-300'}
          >
            <Trash2 />
            {confirmingDelete
              ? `Wirklich alle ${clipCount} löschen?`
              : `Alle Aufnahmen löschen (${clipCount})`}
          </Button>
        </section>

        <p className="text-xs text-muted-foreground">
          Version {__APP_VERSION__} · gebaut {BUILT_AT}
        </p>
      </DialogContent>
    </Dialog>
  );
}
