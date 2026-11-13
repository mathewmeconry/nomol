import type { PoseLandmarker } from '@mediapipe/tasks-vision';
import type { Pose } from '~/lib/detection/pose';
import type { ClipFrame } from '~/lib/recording/clip';
import { createTracker, fromView, type View } from './rotation';

/** Long side of the saved frames. Enough for MediaPipe, which sees 256 px of the gymnast. */
const FRAME_SIZE = 640;
/** Side of the turned view handed to MediaPipe. */
const VIEW_SIZE = 512;

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

/** The current video frame at `FRAME_SIZE`, as JPEG to keep long recordings small in memory. */
export function captureFrame(video: HTMLVideoElement): Promise<Blob> {
  const scale = Math.min(1, FRAME_SIZE / Math.max(video.videoWidth, video.videoHeight));
  const canvas = new OffscreenCanvas(
    Math.round(video.videoWidth * scale),
    Math.round(video.videoHeight * scale),
  );
  canvas.getContext('2d')!.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
}

let viewCanvas: OffscreenCanvas | null = null;

/** MediaPipe on the frame turned and cropped to `view`; poses normalized to the frame. */
function detectView(landmarker: PoseLandmarker, frame: ImageBitmap, view: View): Pose[] {
  viewCanvas ??= new OffscreenCanvas(VIEW_SIZE, VIEW_SIZE);
  const ctx = viewCanvas.getContext('2d')!;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = 'black';
  ctx.fillRect(0, 0, VIEW_SIZE, VIEW_SIZE);
  ctx.translate(VIEW_SIZE / 2, VIEW_SIZE / 2);
  ctx.scale(VIEW_SIZE / view.size, VIEW_SIZE / view.size);
  ctx.rotate(-view.angle);
  ctx.translate(-view.center.x, -view.center.y);
  ctx.drawImage(frame, 0, 0);
  return landmarker.detect(viewCanvas).landmarks.map((pose) =>
    pose.map((landmark) => {
      const point = fromView(landmark, view);
      return {
        x: point.x / frame.width,
        y: point.y / frame.height,
        visibility: landmark.visibility,
      };
    }),
  );
}

/** Lets live detection and the page run between two skeleton frames. */
function yieldToPage() {
  return new Promise((resolve) => setTimeout(resolve));
}

/**
 * Computes the replay skeleton with MediaPipe (see `rotation.ts`), one clip after the other, so
 * live detection for the next gymnast keeps running. From the routine's start, where the
 * gymnast is upright, forwards to the end, then backwards over the wait before it.
 */
export function createSkeletonRefiner(loadLandmarker: () => Promise<PoseLandmarker>) {
  let queue = Promise.resolve();
  /** Pending while paused (see `pause`). */
  let unpaused = Promise.resolve();
  let resume: (() => void) | null = null;

  async function run(job: SkeletonJob) {
    const landmarker = await loadLandmarker();
    const start = job.samples.findIndex((sample) => sample.time >= job.first.startMs);
    const split = start === -1 ? 0 : start;
    const passes = [job.samples.slice(split), job.samples.slice(0, split).reverse()];
    let done = 0;
    for (const pass of passes) {
      let next: ReturnType<typeof createTracker> | null = null;
      for (const sample of pass) {
        await unpaused;
        if (job.isCancelled()) return;
        job.onProgress({
          stage: 'compute',
          percent: Math.floor((done++ / job.samples.length) * 100),
        });
        const frame = await createImageBitmap(await sample.image);
        next ??= createTracker(frame.width, frame.height);
        const pose = next(sample.tracked, (view) => detectView(landmarker, frame, view));
        frame.close();
        if (pose) job.onFrame({ time: sample.time, pose });
        await yieldToPage();
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
