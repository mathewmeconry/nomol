import type { RunUp } from '@nomol/core/detection/session';
import { cn } from 'cn';

/** Tells the gymnast how to start a recording, above the clip strip if there is one. */
export default function StartHint({
  runUp,
  aboveClips,
}: {
  runUp: RunUp | null;
  aboveClips: boolean;
}) {
  return (
    <div
      className={cn(
        'pointer-events-none absolute left-1/2 w-max max-w-[calc(100%-1.5rem)] -translate-x-1/2 rounded-xl bg-black/70 px-5 py-3 text-center backdrop-blur',
        aboveClips ? 'bottom-28' : 'bottom-6',
      )}
    >
      {runUp ? (
        <>
          <p className="text-lg font-semibold">
            {runUp === 'any'
              ? 'Automatisch: Tempo in der Startzone startet die Aufnahme'
              : `Automatisch: Anlauf von ${runUp === 'left' ? 'links' : 'rechts'} startet die Aufnahme`}
          </p>
          <p className="text-sm text-slate-400">
            Startzone über Gerät und Landung · endet beim Weggehen
          </p>
        </>
      ) : (
        <>
          <p className="text-lg font-semibold">Aufnehmen? Arme über dem Kopf kreuzen</p>
          <p className="text-sm text-slate-400">
            in der Startzone · zur Kamera schauen · 1 Sekunde halten
          </p>
        </>
      )}
    </div>
  );
}
