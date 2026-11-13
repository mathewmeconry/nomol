import { download } from '~/lib/download';
import type { Pose } from '@nomol/core/detection/pose';
import type { DetectRequest, DetectResponse } from './pose.worker';
import type { Zone } from '@nomol/core/detection/zone';

const modelUrl = (size: 'heavy' | 'lite') =>
  `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_${size}/float16/latest/pose_landmarker_${size}.task`;

/**
 * The heavy model is preferred: on a handstand recording it found the gymnast in every frame
 * where lite lost them in a fifth, and got upside-down poses right more often. It is ~3.5×
 * slower, so on devices where it takes longer than this per frame, lite takes over. Slower than
 * that, the sign and tracking get sluggish, and the automatic start missed runs below ~5
 * detections per second.
 */
const SLOW_MS = 100;
/**
 * Heavy is measured over this much detection time (median), again and again: phones slow down
 * as they heat up. A Pixel 8 took 25 ms per frame at first and 100–300 ms after ~45 minutes.
 */
const MEASURE_MS = 3000;

export type PoseDetector = {
  /**
   * Poses in a camera frame, looking only at `area` (see `detectionArea`). The frame is handed
   * to the worker (a VideoFrame moves without copying the picture) and comes back with the
   * poses, e.g. to record it; the caller closes it.
   */
  detect: (
    frame: VideoFrame,
    timeMs: number,
    area: Zone,
  ) => Promise<{ frame: VideoFrame; poses: Pose[] }>;
  /** The heavy model, for the replay skeleton: heavy even when live detection fell back to lite. */
  heavyModel: Uint8Array;
  close: () => void;
};

/**
 * MediaPipe runs in a worker (see `landmarker.client.ts`).
 *
 * @param onProgress download progress of the model in percent, the bulk of the startup time
 */
export async function createPoseDetector(
  onProgress?: (percent: number) => void,
): Promise<PoseDetector> {
  const heavyModel = await download(modelUrl('heavy'), onProgress);
  const worker = new Worker(new URL('./pose.worker.ts', import.meta.url), { type: 'module' });
  const pending = new Map<number, (response: DetectResponse) => void>();
  let nextId = 0;
  worker.onmessage = (event: MessageEvent<DetectResponse>) => {
    pending.get(event.data.id)?.(event.data);
    pending.delete(event.data.id);
  };
  function ask(request: DetectRequest, transfer: Transferable[] = []) {
    return new Promise<DetectResponse>((resolve, reject) => {
      pending.set(request.id, (response) =>
        response.type === 'error' ? reject(new Error(response.message)) : resolve(response),
      );
      worker.postMessage(request, transfer);
    });
  }

  // Copied, not transferred: the replay skeleton needs it too.
  await ask({ id: nextId++, type: 'load', model: heavyModel }).catch((error: unknown) => {
    worker.terminate();
    throw error;
  });
  let timings: number[] = [];
  let measuring = true;

  function measure(ms: number) {
    if (!measuring) return;
    timings.push(ms);
    if (timings.reduce((sum, value) => sum + value, 0) < MEASURE_MS) return;
    const median = timings.sort((a, b) => a - b)[Math.floor(timings.length / 2)];
    timings = [];
    if (median <= SLOW_MS) return;
    measuring = false;
    void download(modelUrl('lite'))
      .then((lite) => ask({ id: nextId++, type: 'load', model: lite }, [lite.buffer]))
      .catch(() => {}); // stays on heavy
  }

  return {
    async detect(frame, timeMs, area) {
      const response = await ask({ id: nextId++, type: 'detect', frame, time: timeMs, area }, [
        frame,
      ]);
      if (response.type !== 'poses') throw new Error(`unexpected ${response.type}`);
      measure(response.ms);
      return { frame: response.frame, poses: response.poses };
    },
    heavyModel,
    close() {
      worker.terminate();
    },
  };
}
