import { download } from '~/lib/download';
import { measureSpeed } from '@nomol/core/detection/model-speed';
import type { Pose } from '@nomol/core/detection/pose';
import type { DetectRequest, DetectResponse } from './pose.worker';
import type { Zone } from '@nomol/core/detection/zone';

const modelUrl = (size: 'heavy' | 'lite') =>
  `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_${size}/float16/latest/pose_landmarker_${size}.task`;

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
    const result = measureSpeed(timings, ms);
    timings = result.timings;
    if (!result.slow) return;
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
