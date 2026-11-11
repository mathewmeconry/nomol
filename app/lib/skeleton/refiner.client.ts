import type { Pose } from '~/lib/detection/pose';
import type { ClipFrame } from '~/lib/recording/clip';
import { INPUT_HEIGHT, INPUT_WIDTH, type Crop } from './rtmpose';
import type { WorkerRequest, WorkerResponse } from './rtmpose.worker';

/** A crop of the gymnast saved while recording; the skeleton is computed from it afterwards. */
export type CropFrame = {
  /** ms since the recording started, like `ClipFrame.time` */
  time: number;
  crop: Crop;
  image: Promise<Blob>;
};

/** `failed`: the model couldn't load, e.g. offline before it was ever cached. */
export type SkeletonProgress = { stage: 'download' | 'compute' | 'failed'; percent: number };

export type SkeletonJob = {
  frames: CropFrame[];
  videoWidth: number;
  videoHeight: number;
  /** Computed first, so the part of the clip the replay loops is ready soonest. */
  first: { startMs: number; endMs: number };
  onFrame: (frame: ClipFrame) => void;
  onProgress: (progress: SkeletonProgress) => void;
  /** e.g. the clip was deleted meanwhile */
  isCancelled: () => boolean;
};

/**
 * Cuts the gymnast out of the current video frame (`crop` may reach past the edges, which stay
 * black) and scales it to RTMPose's input size, as JPEG to keep long recordings small in memory.
 */
export function captureCrop(video: HTMLVideoElement, crop: Crop): Promise<Blob> {
  const canvas = new OffscreenCanvas(INPUT_WIDTH, INPUT_HEIGHT);
  const ctx = canvas.getContext('2d')!;
  const scale = INPUT_WIDTH / crop.width;
  // Clipped by hand: Chrome mis-scales drawImage source rectangles that reach past the video.
  const left = Math.max(0, crop.x);
  const top = Math.max(0, crop.y);
  const right = Math.min(video.videoWidth, crop.x + crop.width);
  const bottom = Math.min(video.videoHeight, crop.y + crop.height);
  ctx.fillRect(0, 0, INPUT_WIDTH, INPUT_HEIGHT);
  if (right > left && bottom > top) {
    ctx.drawImage(
      video,
      left,
      top,
      right - left,
      bottom - top,
      (left - crop.x) * scale,
      (top - crop.y) * scale,
      (right - left) * scale,
      (bottom - top) * scale,
    );
  }
  return canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
}

/**
 * Runs RTMPose in a worker, one clip after the other, so live detection for the next gymnast
 * keeps running. The model (~55 MB) loads on the first clip.
 */
export function createSkeletonRefiner(modelUrl: string) {
  const worker = new Worker(new URL('./rtmpose.worker.ts', import.meta.url), { type: 'module' });
  const pending = new Map<number, { resolve: (pose: Pose) => void; reject: (e: Error) => void }>();
  let loading: { resolve: () => void; reject: (e: Error) => void; onProgress: (p: number) => void };
  let ready: Promise<void> | null = null;
  let nextId = 0;
  let queue = Promise.resolve();

  worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const message = event.data;
    if (message.type === 'progress') loading.onProgress(message.percent);
    else if (message.type === 'ready') loading.resolve();
    else if (message.type === 'pose') {
      pending.get(message.id)?.resolve(message.pose);
      pending.delete(message.id);
    } else if (message.id === undefined) {
      loading.reject(new Error(message.message));
    } else {
      pending.get(message.id)?.reject(new Error(message.message));
      pending.delete(message.id);
    }
  };

  function post(request: WorkerRequest) {
    worker.postMessage(request);
  }

  function load(onProgress: (percent: number) => void) {
    ready ??= new Promise<void>((resolve, reject) => {
      loading = { resolve, reject, onProgress };
      post({ type: 'load', url: modelUrl });
    }).catch((error: unknown) => {
      ready = null; // try again with the next clip, e.g. once back online
      throw error;
    });
    return ready;
  }

  async function poseOf(frame: CropFrame, job: SkeletonJob) {
    const id = nextId++;
    const image = await frame.image;
    return new Promise<Pose>((resolve, reject) => {
      pending.set(id, { resolve, reject });
      post({
        type: 'pose',
        id,
        image,
        crop: frame.crop,
        videoWidth: job.videoWidth,
        videoHeight: job.videoHeight,
      });
    });
  }

  async function run(job: SkeletonJob) {
    await load((percent) => job.onProgress({ stage: 'download', percent }));
    const inFirst = (frame: CropFrame) =>
      frame.time >= job.first.startMs && frame.time <= job.first.endMs;
    const ordered = [...job.frames.filter(inFirst), ...job.frames.filter((f) => !inFirst(f))];
    for (const [i, frame] of ordered.entries()) {
      if (job.isCancelled()) return;
      job.onProgress({ stage: 'compute', percent: Math.floor((i / ordered.length) * 100) });
      job.onFrame({ time: frame.time, pose: await poseOf(frame, job) });
    }
    job.onProgress({ stage: 'compute', percent: 100 });
  }

  return {
    /** Resolves when the clip is done (or cancelled); rejects if the model can't load. */
    refine(job: SkeletonJob) {
      const result = queue.then(() => run(job));
      queue = result.catch(() => {});
      return result;
    },
    close() {
      worker.terminate();
    },
  };
}

export type SkeletonRefiner = ReturnType<typeof createSkeletonRefiner>;
