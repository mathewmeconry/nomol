import { useEffect, useRef, useState } from 'react';
import type { PoseDetector } from '~/lib/detection/pose-detector.client';
import { insertFrame, type Clip, type ClipFrame } from '~/lib/recording/clip';
import { deleteClip, loadClips, saveClip, saveSkeleton } from '~/lib/recording/clip-store.client';
import {
  createSkeletonRefiner,
  type SkeletonProgress,
  type SkeletonRefiner,
  type SkeletonSample,
} from '~/lib/skeleton/refiner.client';

/**
 * All clips, newest first: kept in IndexedDB until deleted by hand (they're test footage too),
 * and each one's replay skeleton computed in the background after it was recorded.
 *
 * @param detector computes the skeleton; clips are only recorded once it's loaded
 */
export default function useClips(detector: PoseDetector | null) {
  const [clips, setClips] = useState<Clip[]>([]);
  const [skeletonProgress, setSkeletonProgress] = useState<Record<string, SkeletonProgress>>({});
  const refinerRef = useRef<SkeletonRefiner | null>(null);
  /** Clips deleted meanwhile, so their skeleton computation stops. */
  const removedRef = useRef(new Set<string>());
  const pausedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    // Otherwise the browser may clear the clips when the device runs low on space.
    void navigator.storage?.persist?.().catch(() => {});
    loadClips()
      .then((stored) => {
        if (cancelled) return stored.forEach((clip) => URL.revokeObjectURL(clip.url));
        // Clips recorded while loading come first; the list stays newest-first.
        setClips((recorded) => [...recorded, ...stored]);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * @param samples frames for the skeleton
   * @param first the part to compute first (the routine)
   */
  function add(
    clip: Clip,
    video: Blob,
    samples: SkeletonSample[],
    first: { startMs: number; endMs: number },
  ) {
    setClips((previous) => [clip, ...previous]);
    // A full or blocked storage only means the clip won't survive a reload.
    void saveClip(clip, video).catch(() => {});
    computeSkeleton(clip, samples, first);
  }

  /** Returns the clips left. */
  function remove(clip: Clip): Clip[] {
    removedRef.current.add(clip.id);
    const remaining = clips.filter((other) => other.id !== clip.id);
    URL.revokeObjectURL(clip.url);
    void deleteClip(clip.id).catch(() => {});
    setClips(remaining);
    return remaining;
  }

  /** Runs MediaPipe on the saved frames in the background and fills in the clip's skeleton. */
  function computeSkeleton(
    clip: Clip,
    samples: SkeletonSample[],
    first: { startMs: number; endMs: number },
  ) {
    if (samples.length === 0 || !detector) return;
    if (!refinerRef.current) {
      refinerRef.current = createSkeletonRefiner(detector.heavyModel);
      if (pausedRef.current) refinerRef.current.pause();
    }
    let skeleton: ClipFrame[] = [];
    const setProgress = (progress: SkeletonProgress | null) =>
      setSkeletonProgress((previous) => {
        const { [clip.id]: _done, ...others } = previous;
        return progress ? { ...others, [clip.id]: progress } : others;
      });
    refinerRef.current
      .refine({
        samples,
        first,
        onFrame(frame) {
          skeleton = insertFrame(skeleton, frame);
          setClips((previous) => previous.map((c) => (c.id === clip.id ? { ...c, skeleton } : c)));
        },
        onProgress: setProgress,
        isCancelled: () => removedRef.current.has(clip.id),
      })
      .then(() => {
        setProgress(null);
        if (!removedRef.current.has(clip.id)) void saveSkeleton(clip.id, skeleton).catch(() => {});
      })
      .catch(() => setProgress({ stage: 'failed', percent: 0 }));
  }

  function removeAll() {
    for (const clip of clips) {
      removedRef.current.add(clip.id);
      URL.revokeObjectURL(clip.url);
      void deleteClip(clip.id).catch(() => {});
    }
    setClips([]);
  }

  /** The skeleton waits while the phone needs its power, e.g. while recording. */
  function pauseSkeleton(paused: boolean) {
    pausedRef.current = paused;
    if (paused) refinerRef.current?.pause();
    else refinerRef.current?.resume();
  }

  return { clips, skeletonProgress, add, remove, removeAll, pauseSkeleton };
}
