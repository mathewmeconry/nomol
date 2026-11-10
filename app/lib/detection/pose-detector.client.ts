import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import type { Pose } from './pose';

// Loaded from the network for now; bundle these for halls without internet.
// The WASM version must match the installed @mediapipe/tasks-vision.
const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.2/wasm';
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task';

/** Spotters and waiting gymnasts are often in the picture too. */
const MAX_POSES = 4;

export type PoseDetector = {
  detect: (video: HTMLVideoElement, timeMs: number) => Pose[];
  close: () => void;
};

export async function createPoseDetector(): Promise<PoseDetector> {
  const vision = await FilesetResolver.forVisionTasks(WASM_URL);
  function create(delegate: 'GPU' | 'CPU') {
    return PoseLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate },
      runningMode: 'VIDEO',
      numPoses: MAX_POSES,
    });
  }
  // The GPU delegate is much faster but can fail to start on some devices. Note that MediaPipe
  // still needs WebGL to read video frames, so the CPU fallback doesn't help without it.
  const landmarker = await create('GPU').catch((_error: unknown) => create('CPU'));

  return {
    detect(video, timeMs) {
      return landmarker.detectForVideo(video, timeMs).landmarks;
    },
    close() {
      landmarker.close();
    },
  };
}
