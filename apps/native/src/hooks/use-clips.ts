import type { Clip } from '@nomol/core/recording/clip';
import { useEffect, useRef, useState } from 'react';
import { deleteAllClips, deleteClip, loadClips } from '../lib/clip-store';
import { createSkeletonRefiner, type SkeletonProgress } from '../lib/skeleton';

/**
 * All clips, newest first, kept on the device until deleted by hand (they're test footage too),
 * and each one's replay skeleton computed in the background after it was recorded; one left
 * unfinished when the app closed continues on the next start.
 */
export function useClips() {
  const [clips, setClips] = useState<Clip[]>([]);
  const [skeletonProgress, setSkeletonProgress] = useState<Record<string, SkeletonProgress>>({});
  const [refiner] = useState(createSkeletonRefiner);
  /** Clips deleted meanwhile, so their skeleton computation stops. */
  const removedRef = useRef(new Set<string>());

  useEffect(() => {
    let cancelled = false;
    loadClips()
      .then((stored) => {
        if (cancelled) return;
        // Clips recorded while loading come first; the list stays newest-first.
        setClips((recorded) => [...recorded, ...stored]);
        stored.forEach(computeSkeleton);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // Once on start; computeSkeleton only uses state setters and refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function computeSkeleton(clip: Clip) {
    refiner.compute({
      clip,
      onSkeleton(skeleton) {
        setClips((previous) => previous.map((c) => (c.id === clip.id ? { ...c, skeleton } : c)));
      },
      onProgress(progress) {
        setSkeletonProgress((previous) => {
          const { [clip.id]: _done, ...others } = previous;
          return progress ? { ...others, [clip.id]: progress } : others;
        });
      },
      isCancelled: () => removedRef.current.has(clip.id),
    });
  }

  /** A clip just recorded (already stored by `finishRecording`). */
  function add(clip: Clip) {
    setClips((previous) => [clip, ...previous]);
    computeSkeleton(clip);
  }

  /** Returns the clips left. */
  function remove(clip: Clip): Clip[] {
    removedRef.current.add(clip.id);
    const remaining = clips.filter((other) => other.id !== clip.id);
    deleteClip(clip.id);
    setClips(remaining);
    return remaining;
  }

  /**
   * Also leftovers that never became a clip; not the folder of the recording running (`keep`).
   */
  function removeAll(keep: string | null) {
    for (const clip of clips) removedRef.current.add(clip.id);
    deleteAllClips(keep);
    setClips([]);
  }

  /** The skeleton waits while the phone needs its power, i.e. while recording. */
  function pauseSkeleton(paused: boolean) {
    if (paused) refiner.pause();
    else refiner.resume();
  }

  return { clips, skeletonProgress, add, remove, removeAll, pauseSkeleton };
}
