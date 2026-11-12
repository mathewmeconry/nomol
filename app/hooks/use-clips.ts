import { useEffect, useRef, useState } from 'react';
import { insertFrame, type Clip, type ClipFrame } from '~/lib/recording/clip';
import { deleteClip, loadClips, saveClip, saveSkeleton } from '~/lib/recording/clip-store.client';
import {
  createSkeletonRefiner,
  type SkeletonProgress,
  type SkeletonRefiner,
  type SkeletonSample,
} from '~/lib/skeleton/refiner.client';

/** Older clips are dropped to keep the tablet's memory in check. */
const MAX_CLIPS = 8;
const SKELETON_MODELS = {
  pose: `${import.meta.env.BASE_URL}models/rtmpose-m.onnx`,
  detector: `${import.meta.env.BASE_URL}models/yolox-s.onnx`,
};

/**
 * The recent clips, newest first: kept in IndexedDB, and each one's replay skeleton computed
 * in the background after it was recorded.
 */
export default function useClips() {
  const [clips, setClips] = useState<Clip[]>([]);
  const [skeletonProgress, setSkeletonProgress] = useState<Record<string, SkeletonProgress>>({});
  const refinerRef = useRef<SkeletonRefiner | null>(null);
  /** Clips deleted or dropped, so their skeleton computation stops. */
  const removedRef = useRef(new Set<string>());

  useEffect(() => {
    let cancelled = false;
    loadClips()
      .then((stored) => {
        if (cancelled) return stored.forEach((clip) => URL.revokeObjectURL(clip.url));
        // Clips recorded while loading come first; the list stays newest-first.
        setClips((recorded) => [...recorded, ...stored].slice(0, MAX_CLIPS));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => () => refinerRef.current?.close(), []);

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
    setClips((previous) => {
      for (const old of previous.slice(MAX_CLIPS - 1)) {
        removedRef.current.add(old.id);
        URL.revokeObjectURL(old.url);
        void deleteClip(old.id).catch(() => {});
      }
      return [clip, ...previous].slice(0, MAX_CLIPS);
    });
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

  /** Runs RTMPose on the saved frames in the background and fills in the clip's skeleton. */
  function computeSkeleton(
    clip: Clip,
    samples: SkeletonSample[],
    first: { startMs: number; endMs: number },
  ) {
    if (samples.length === 0) return;
    refinerRef.current ??= createSkeletonRefiner(SKELETON_MODELS);
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

  return { clips, skeletonProgress, add, remove };
}
