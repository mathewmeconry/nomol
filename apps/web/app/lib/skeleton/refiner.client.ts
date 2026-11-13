import type { Pose } from '@nomol/core/detection/pose';
import type { ClipFrame } from '@nomol/core/recording/clip';
import type { WorkerRequest, WorkerResponse } from './skeleton.worker';

/** Long side of the saved frames. Enough for MediaPipe, which sees 256 px of the gymnast. */
const FRAME_SIZE = 640;

/** A frame saved while recording; the skeleton is computed from it afterwards. */
export type SkeletonSample = {
  /** ms since the recording started, like `ClipFrame.time` */
  time: number;
  /** The video frame at `FRAME_SIZE` (JPEG). */
  image: Promise<Blob>;
  /** The live tracking's pose of the gymnast in this frame. */
  tracked: Pose;
};

export type SkeletonProgress = { stage: 'compute' | 'failed'; percent: number };

export type SkeletonJob = {
  samples: SkeletonSample[];
  /** Computed first, so the part of the clip the replay loops is ready soonest. */
  first: { startMs: number; endMs: number };
  onFrame: (frame: ClipFrame) => void;
  onProgress: (progress: SkeletonProgress) => void;
  /** e.g. the clip was deleted meanwhile */
  isCancelled: () => boolean;
};

/** A camera frame at `FRAME_SIZE`, as JPEG to keep long recordings small in memory. */
export function captureFrame(frame: VideoFrame): Promise<Blob> {
  const scale = Math.min(1, FRAME_SIZE / Math.max(frame.displayWidth, frame.displayHeight));
  const canvas = new OffscreenCanvas(
    Math.round(frame.displayWidth * scale),
    Math.round(frame.displayHeight * scale),
  );
  canvas.getContext('2d')!.drawImage(frame, 0, 0, canvas.width, canvas.height);
  return canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
}

/**
 * Computes the replay skeleton with MediaPipe (see `rotation.ts`) in a worker, one clip after
 * the other: on the page it blocked the replay for up to ~0.5 s per frame on a Pixel 8. From
 * the routine's start, where the gymnast is upright, forwards to the end, then backwards over
 * the wait before it.
 *
 * @param model the heavy MediaPipe model, already downloaded for live detection
 */
export function createSkeletonRefiner(model: Uint8Array) {
  let queue = Promise.resolve();
  /** Pending while paused (see `pause`). */
  let unpaused = Promise.resolve();
  let resume: (() => void) | null = null;
  let worker: Promise<Worker> | null = null;

  /** Sends one request and waits for its answer; the worker handles one at a time. */
  function ask(target: Worker, request: WorkerRequest) {
    return new Promise<WorkerResponse>((resolve) => {
      target.onmessage = (event: MessageEvent<WorkerResponse>) => resolve(event.data);
      target.postMessage(request);
    });
  }

  async function startWorker() {
    const created = new Worker(new URL('./skeleton.worker.ts', import.meta.url), {
      type: 'module',
    });
    const answer = await ask(created, { type: 'load', model });
    if (answer.type === 'error') throw new Error(answer.message);
    return created;
  }

  async function run(job: SkeletonJob) {
    worker ??= startWorker();
    const target = await worker;
    const start = job.samples.findIndex((sample) => sample.time >= job.first.startMs);
    const split = start === -1 ? 0 : start;
    const passes = [job.samples.slice(split), job.samples.slice(0, split).reverse()];
    let done = 0;
    for (const pass of passes) {
      let restart = true;
      for (const sample of pass) {
        await unpaused;
        if (job.isCancelled()) return;
        job.onProgress({
          stage: 'compute',
          percent: Math.floor((done++ / job.samples.length) * 100),
        });
        const answer = await ask(target, {
          type: 'frame',
          image: await sample.image,
          tracked: sample.tracked,
          restart,
        });
        restart = false;
        if (answer.type === 'error') throw new Error(answer.message);
        if (answer.type === 'frame' && answer.pose) {
          job.onFrame({ time: sample.time, pose: answer.pose });
        }
      }
    }
    job.onProgress({ stage: 'compute', percent: 100 });
  }

  return {
    /** Resolves when the clip is done (or cancelled); rejects if MediaPipe can't start. */
    refine(job: SkeletonJob) {
      const result = queue.then(() => run(job));
      queue = result.catch(() => {});
      return result;
    },
    /**
     * Holds off between frames, e.g. while recording: on a Pixel 8 computing the earlier RTMPose
     * skeleton alongside dropped the recording from ~43 to ~25 fps, with gaps up to 0.25 s, and live
     * detection from ~10 to ~6.5 per second.
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

export type SkeletonRefiner = ReturnType<typeof createSkeletonRefiner>;
