import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import type { Pose } from './pose';

// Loaded from the network for now; bundle these for halls without internet.
// The WASM version must match the installed @mediapipe/tasks-vision.
const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.2/wasm';
const modelUrl = (size: 'heavy' | 'lite') =>
  `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_${size}/float16/latest/pose_landmarker_${size}.task`;

/**
 * The heavy model is preferred: on a handstand recording it found the gymnast in every frame
 * where lite lost them in a fifth, and got upside-down poses right more often. It is ~3.5×
 * slower, so on devices where it takes longer than this per frame, lite takes over. Below that
 * rate the sign and tracking get sluggish; the video itself always records at full frame rate.
 */
const SLOW_MS = 150;
/** How long heavy is measured (median detection time) before deciding. */
const MEASURE_MS = 3000;

/** Spotters and waiting gymnasts are often in the picture too. */
const MAX_POSES = 4;

export type PoseDetector = {
  detect: (video: HTMLVideoElement, timeMs: number) => Pose[];
  close: () => void;
};

/**
 * Downloads a model, reporting progress as whole percents (MediaPipe's own loading reports none).
 * Goes through the service worker like any fetch, so the model is cached for offline use.
 */
async function download(url: string, onProgress?: (percent: number) => void) {
  const response = await fetch(url);
  if (!response.ok || !response.body) throw new Error(`Model download failed: ${response.status}`);
  const total = Number(response.headers.get('content-length'));
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  let reported = -1;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    const percent = Math.min(100, Math.floor((loaded / total) * 100));
    if (total && percent !== reported) {
      reported = percent;
      onProgress?.(percent);
    }
  }
  const model = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    model.set(chunk, offset);
    offset += chunk.length;
  }
  return model;
}

/** @param onProgress download progress of the model in percent, the bulk of the startup time */
export async function createPoseDetector(
  onProgress?: (percent: number) => void,
): Promise<PoseDetector> {
  const vision = await FilesetResolver.forVisionTasks(WASM_URL);
  async function create(size: 'heavy' | 'lite', progress?: (percent: number) => void) {
    const model = await download(modelUrl(size), progress);
    const options = (delegate: 'GPU' | 'CPU') =>
      PoseLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetBuffer: model, delegate },
        runningMode: 'VIDEO',
        numPoses: MAX_POSES,
      });
    // The GPU delegate is much faster but can fail to start on some devices. Note that MediaPipe
    // still needs WebGL to read video frames, so the CPU fallback doesn't help without it.
    return options('GPU').catch((_error: unknown) => options('CPU'));
  }

  let landmarker = await create('heavy', onProgress);
  const timings: number[] = [];
  let measuring = true;

  return {
    detect(video, timeMs) {
      const start = performance.now();
      const poses = landmarker.detectForVideo(video, timeMs).landmarks;
      if (measuring) {
        timings.push(performance.now() - start);
        if (timings.reduce((sum, ms) => sum + ms, 0) >= MEASURE_MS) {
          measuring = false;
          const median = timings.sort((a, b) => a - b)[Math.floor(timings.length / 2)];
          if (median > SLOW_MS) {
            // Swapped between frames: detection is synchronous, so no frame sees a closed model.
            void create('lite').then((lite) => {
              landmarker.close();
              landmarker = lite;
            });
          }
        }
      }
      return poses;
    },
    close() {
      landmarker.close();
    },
  };
}
