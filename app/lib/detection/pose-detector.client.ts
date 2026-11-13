import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import { download } from '~/lib/download';
import type { Pose } from './pose';

// Loaded from the network for now; bundle these for halls without internet.
// The WASM version must match the installed @mediapipe/tasks-vision.
const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.2/wasm';
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

/** Spotters and waiting gymnasts are often in the picture too. */
const MAX_POSES = 4;

export type PoseDetector = {
  detect: (video: HTMLVideoElement, timeMs: number) => Pose[];
  /** Heavy, for single images: the replay skeleton. Created on first use. */
  imageLandmarker: () => Promise<PoseLandmarker>;
  close: () => void;
};

/** @param onProgress download progress of the model in percent, the bulk of the startup time */
export async function createPoseDetector(
  onProgress?: (percent: number) => void,
): Promise<PoseDetector> {
  const vision = await FilesetResolver.forVisionTasks(WASM_URL);
  function create(model: Uint8Array, runningMode: 'VIDEO' | 'IMAGE') {
    const options = (delegate: 'GPU' | 'CPU') =>
      PoseLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetBuffer: model, delegate },
        runningMode,
        numPoses: MAX_POSES,
      });
    // The GPU delegate is much faster but can fail to start on some devices. Note that MediaPipe
    // still needs WebGL to read video frames, so the CPU fallback doesn't help without it.
    return options('GPU').catch((_error: unknown) => options('CPU'));
  }

  // Kept for the replay skeleton, which uses heavy even when live detection falls back to lite.
  const heavy = await download(modelUrl('heavy'), onProgress);
  let landmarker = await create(heavy, 'VIDEO');
  let image: Promise<PoseLandmarker> | null = null;
  let timings: number[] = [];
  let measuring = true;

  return {
    detect(video, timeMs) {
      const start = performance.now();
      const poses = landmarker.detectForVideo(video, timeMs).landmarks;
      if (measuring) {
        timings.push(performance.now() - start);
        if (timings.reduce((sum, ms) => sum + ms, 0) >= MEASURE_MS) {
          const median = timings.sort((a, b) => a - b)[Math.floor(timings.length / 2)];
          timings = [];
          if (median > SLOW_MS) {
            measuring = false;
            // Swapped between frames: detection is synchronous, so no frame sees a closed model.
            void download(modelUrl('lite'))
              .then((lite) => create(lite, 'VIDEO'))
              .then((lite) => {
                landmarker.close();
                landmarker = lite;
              });
          }
        }
      }
      return poses;
    },
    imageLandmarker() {
      image ??= create(heavy, 'IMAGE');
      return image;
    },
    close() {
      landmarker.close();
      void image?.then((created) => created.close());
    },
  };
}
