import { useLayoutEffect, useRef, type RefObject } from 'react';
import type { Clip } from '@nomol/core/recording/clip';

type Props = {
  clips: Clip[];
  /** Highlighted clip, if one is open. */
  currentId: string | null;
  onSelect: (clip: Clip) => void;
  /**
   * Scroll position, kept by the parent: the strip is remounted with each clip it opens, and
   * would otherwise jump back to the newest clip.
   */
  scrollLeftRef: RefObject<number>;
};

/** The latest recordings as thumbnails, newest first. */
export default function ClipStrip({ clips, currentId, onSelect, scrollLeftRef }: Props) {
  const stripRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (stripRef.current) stripRef.current.scrollLeft = scrollLeftRef.current;
  }, [scrollLeftRef]);

  return (
    <div
      ref={stripRef}
      onScroll={(event) => (scrollLeftRef.current = event.currentTarget.scrollLeft)}
      className="flex max-w-full gap-2 overflow-x-auto"
      aria-label="Letzte Aufnahmen"
    >
      {clips.map((clip) => (
        <button
          key={clip.id}
          type="button"
          aria-current={clip.id === currentId}
          onClick={() => onSelect(clip)}
          className="relative aspect-video w-20 shrink-0 sm:w-28 overflow-hidden rounded-lg border-2 border-white/20 bg-slate-800 aria-current:border-sky-400"
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
