import { Progress } from '~/components/ui/progress';

/** Covers the screen until camera and detection run, or explains why they don't. */
export default function LoadingScreen({
  message,
  progress,
}: {
  message: string;
  /** Model download in percent, shown while it is under way. */
  progress: number | null;
}) {
  return (
    <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-4 bg-black/70 p-6">
      <p className="max-w-md text-center text-lg">{message}</p>
      {progress !== null && (
        <div className="flex w-full max-w-xs items-center gap-3">
          <Progress value={progress} aria-label="Download der Erkennung" />
          <span className="w-12 shrink-0 text-right font-mono text-sm text-slate-300 tabular-nums">
            {progress}&nbsp;%
          </span>
        </div>
      )}
    </div>
  );
}
