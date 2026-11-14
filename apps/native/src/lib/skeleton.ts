import { posesInArea } from '@nomol/core/detection/camera-frame';
import type { Pose } from '@nomol/core/detection/pose';
import { insertFrame, routineRange, type Clip, type ClipFrame } from '@nomol/core/recording/clip';
import { createTracker, posesFromView, skeletonPasses } from '@nomol/core/skeleton/rotation';
import {
  createSkeletonLandmarker,
  type SkeletonLandmarker,
  type StillSize,
} from '@nomol/native-modules';
import { finishSkeleton, loadPendingSkeleton, saveSkeleton } from './clip-store';

/** How often the skeleton computed so far is stored, so little is lost when the app closes. */
const SAVE_EVERY_MS = 3000;

const VIEW = { left: 0, top: 0, right: 1, bottom: 1 };

export type SkeletonProgress = { stage: 'compute' | 'failed'; percent: number };

export type SkeletonJob = {
  clip: Clip;
  onSkeleton: (skeleton: ClipFrame[]) => void;
  /** Null once done. */
  onProgress: (progress: SkeletonProgress | null) => void;
  /** e.g. the clip was deleted meanwhile */
  isCancelled: () => boolean;
};

/**
 * Computes the replay skeleton from the frames saved while recording, one clip after the other,
 * as the web app does (`skeleton/rotation.ts` in core): MediaPipe heavy in native code on views
 * turned so the gymnast appears upright. The JS thread only decides which views to look at.
 * Stored as it goes; after a restart the done frames are fed back to the tracker instead of
 * being detected again, which puts it where it was.
 */
export function createSkeletonRefiner() {
  let queue = Promise.resolve();
  /** Pending while paused (see `pause`). */
  let unpaused = Promise.resolve();
  let resume: (() => void) | null = null;
  let landmarker: Promise<SkeletonLandmarker> | null = null;

  async function load() {
    const created = createSkeletonLandmarker();
    await created.load();
    return created;
  }

  async function run(job: SkeletonJob) {
    const { clip } = job;
    const pending = await loadPendingSkeleton(clip.id);
    if (!pending || job.isCancelled()) return;
    const { samples, done } = pending;
    job.onProgress({ stage: 'compute', percent: Math.floor((done / samples.length) * 100) });
    landmarker ??= load();
    // A failed load is tried again with the next clip.
    const target = await landmarker.catch((error: unknown) => {
      landmarker = null;
      throw error;
    });
    const stored = new Map(clip.skeleton.map((frame) => [frame.time, frame.pose]));
    let skeleton = clip.skeleton;
    let index = 0;
    let savedAt = Date.now();

    for (const pass of skeletonPasses(samples, routineRange(clip).startMs)) {
      // Saved in the background while recording, so some may be missing; `detect` skips those.
      let size: StillSize | null = null;
      for (const sample of pass) {
        size = await target.open(pending.still(sample)).catch(() => null);
        if (size) break;
      }
      // Gymnasts start each pass upright. Without any still nothing is detected in the pass, so
      // the size doesn't matter.
      const next = createTracker(size?.width ?? 1, size?.height ?? 1);
      for (const sample of pass) {
        await unpaused;
        if (job.isCancelled()) return;
        if (index < done) {
          const pose = stored.get(sample.time);
          await next(sample.tracked, () => (pose ? [pose] : []));
        } else {
          const pose = await detect(target, next, sample.tracked, pending.still(sample));
          if (pose) {
            const frame = { time: sample.time, pose };
            skeleton = insertFrame(
              skeleton.filter((other) => other.time !== frame.time),
              frame,
            );
            job.onSkeleton(skeleton);
          }
        }
        index++;
        job.onProgress({ stage: 'compute', percent: Math.floor((index / samples.length) * 100) });
        if (index > done && Date.now() - savedAt > SAVE_EVERY_MS) {
          await saveSkeleton(clip.id, skeleton, index);
          savedAt = Date.now();
        }
      }
    }
    if (!job.isCancelled()) await finishSkeleton(clip.id, skeleton);
  }

  /** The gymnast's pose in a saved frame. */
  async function detect(
    target: SkeletonLandmarker,
    next: ReturnType<typeof createTracker>,
    tracked: Pose | null,
    still: string,
  ) {
    const size = await target.open(still).catch(() => null);
    // Saved in the background while recording, so the last one may be missing.
    if (!size) return next(tracked, () => []);
    return next(tracked, async (view) =>
      posesFromView(
        posesInArea(await target.detect(view.center.x, view.center.y, view.size, view.angle), VIEW),
        view,
        size.width,
        size.height,
      ),
    );
  }

  return {
    compute(job: SkeletonJob) {
      const result = queue.then(() => run(job));
      queue = result.then(
        () => job.onProgress(null),
        () => job.onProgress({ stage: 'failed', percent: 0 }),
      );
    },
    /**
     * Holds off between frames while recording: in the web app, computing the skeleton
     * alongside dropped recordings on a Pixel 8 from ~43 to ~25 fps and slowed live detection.
     */
    pause() {
      if (resume) return;
      unpaused = new Promise((resolve) => (resume = resolve));
    },
    resume() {
      resume?.();
      resume = null;
    },
  };
}
