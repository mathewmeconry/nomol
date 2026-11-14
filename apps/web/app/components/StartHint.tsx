import type { RunUp } from '@nomol/core/detection/session';
import { cn } from 'cn';

/**
 * Tells the gymnast how to start a recording: in the strip beside the picture when `docked`,
 * otherwise over it, above the clip strip if there is one.
 */
export default function StartHint({
  runUp,
  aboveClips,
  docked,
}: {
  runUp: RunUp | null;
  aboveClips: boolean;
  docked: boolean;
}) {
  return (
    <div
      className={cn(
        docked
          ? 'w-full rounded-xl bg-white/5 px-3 py-2'
          : 'pointer-events-none absolute left-1/2 w-max max-w-[calc(100%-1.5rem)] -translate-x-1/2 rounded-xl bg-black/70 px-5 py-3 text-center backdrop-blur',
        !docked && (aboveClips ? 'bottom-28' : 'bottom-6'),
      )}
    >
      <p className={cn('font-semibold', docked ? 'text-sm' : 'text-lg')}>
        {runUp
          ? runUp === 'any'
            ? 'Automatisch: Tempo in der Startzone startet die Aufnahme'
            : `Automatisch: Anlauf von ${runUp === 'left' ? 'links' : 'rechts'} startet die Aufnahme`
          : 'Aufnehmen? Arme über dem Kopf kreuzen'}
      </p>
      <p className={cn('text-slate-400', docked ? 'text-xs' : 'text-sm')}>
        {runUp
          ? 'Startzone über Gerät und Landung · endet beim Weggehen'
          : 'in der Startzone · zur Kamera schauen · 1 Sekunde halten'}
      </p>
    </div>
  );
}
