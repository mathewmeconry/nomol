import type { Clip } from '~/lib/recording/clip';

type Props = {
  clips: Clip[];
  /** Highlighted clip, if one is open. */
  currentId: string | null;
  onSelect: (clip: Clip) => void;
};

/** The latest recordings as thumbnails, newest first. */
export default function ClipStrip({ clips, currentId, onSelect }: Props) {
  return (
    <div className="flex max-w-full gap-2 overflow-x-auto" aria-label="Letzte Aufnahmen">
      {clips.map((clip) => (
        <button
          key={clip.id}
          type="button"
          aria-current={clip.id === currentId}
          onClick={() => onSelect(clip)}
          className="relative aspect-video w-28 shrink-0 overflow-hidden rounded-lg border-2 border-white/20 bg-slate-800 aria-current:border-sky-400"
        >
          {clip.thumbnail && (
            <img src={clip.thumbnail} alt="" className="h-full w-full object-cover" />
          )}
          <span className="absolute inset-x-0 bottom-0 bg-black/70 px-1 py-0.5 text-center font-mono text-xs text-slate-200">
            {clip.startedAt.toLocaleTimeString('de-CH')}
          </span>
        </button>
      ))}
    </div>
  );
}
