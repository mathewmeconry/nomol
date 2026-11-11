import type { Pose } from '~/lib/detection/pose';
import type { ClipFrame } from '~/lib/recording/clip';
import type { Crop } from './rtmpose';
import type { WorkerRequest, WorkerResponse } from './rtmpose.worker';
import { DETECTOR_SIZE } from './yolox';

/** A frame saved while recording; the skeleton is computed from it afterwards. */
export type SkeletonSample = {
  /** ms since the recording started, like `ClipFrame.time` */
  time: number;
  /** The video frame scaled to the detector's size (see `captureFrame`). */
  image: Promise<Blob>;
  /** MediaPipe's pose of the gymnast in this frame. */
  tracked: Pose;
  /** Crop from MediaPipe's poses, in the saved frame's pixels. */
  fallback: Crop;
};

/** `failed`: the models couldn't load, e.g. offline before they were ever cached. */
export type SkeletonProgress = { stage: 'download' | 'compute' | 'failed'; percent: number };

export type SkeletonJob = {
  samples: SkeletonSample[];
  /** Computed first, so the part of the clip the replay loops is ready soonest. */
  first: { startMs: number; endMs: number };
  onFrame: (frame: ClipFrame) => void;
  onProgress: (progress: SkeletonProgress) => void;
  /** e.g. the clip was deleted meanwhile */
  isCancelled: () => boolean;
};

/** Size of the saved frames: the detector's input, which is plenty for RTMPose's crop too. */
export function frameSize(video: HTMLVideoElement) {
  const scale = Math.min(1, DETECTOR_SIZE / Math.max(video.videoWidth, video.videoHeight));
  return {
    width: Math.round(video.videoWidth * scale),
    height: Math.round(video.videoHeight * scale),
  };
}

/** The current video frame at `frameSize`, as JPEG to keep long recordings small in memory. */
export function captureFrame(video: HTMLVideoElement): Promise<Blob> {
  const { width, height } = frameSize(video);
  const canvas = new OffscreenCanvas(width, height);
  canvas.getContext('2d')!.drawImage(video, 0, 0, width, height);
  return canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
}

/**
 * Runs YOLOX + RTMPose in a worker, one clip after the other, so live detection for the next
 * gymnast keeps running. The models (~90 MB) load on the first clip.
 */
export function createSkeletonRefiner(models: { pose: string; detector: string }) {
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
      post({ type: 'load', poseUrl: models.pose, detectorUrl: models.detector });
    }).catch((error: unknown) => {
      ready = null; // try again with the next clip, e.g. once back online
      throw error;
    });
    return ready;
  }

  async function poseOf(sample: SkeletonSample) {
    const id = nextId++;
    const image = await sample.image;
    return new Promise<Pose>((resolve, reject) => {
      pending.set(id, { resolve, reject });
      post({ type: 'pose', id, image, tracked: sample.tracked, fallback: sample.fallback });
    });
  }

  async function run(job: SkeletonJob) {
    await load((percent) => job.onProgress({ stage: 'download', percent }));
    const inFirst = (sample: SkeletonSample) =>
      sample.time >= job.first.startMs && sample.time <= job.first.endMs;
    const ordered = [...job.samples.filter(inFirst), ...job.samples.filter((s) => !inFirst(s))];
    for (const [i, sample] of ordered.entries()) {
      if (job.isCancelled()) return;
      job.onProgress({ stage: 'compute', percent: Math.floor((i / ordered.length) * 100) });
      job.onFrame({ time: sample.time, pose: await poseOf(sample) });
    }
    job.onProgress({ stage: 'compute', percent: 100 });
  }

  return {
    /** Resolves when the clip is done (or cancelled); rejects if the models can't load. */
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
