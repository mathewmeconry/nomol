import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';

// Loaded from the network for now; bundle these for halls without internet.
// The WASM version must match the installed @mediapipe/tasks-vision.
const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.2/wasm';

/** Spotters and waiting gymnasts are often in the picture too. */
const MAX_POSES = 4;

/**
 * MediaPipe loads its WASM glue with importScripts, which module workers don't allow. A
 * synchronous fetch evaluated in global scope does the same.
 */
function importScriptsSync(...urls: (string | URL)[]) {
  for (const url of urls) {
    const request = new XMLHttpRequest();
    request.open('GET', url.toString(), false);
    request.send();
    (0, eval)(request.responseText);
  }
}

/**
 * A MediaPipe pose landmarker, in a worker: on the page its detection blocked drawing, and on a
 * warm phone a frame takes 100–250 ms.
 */
export async function createLandmarker(model: Uint8Array, runningMode: 'VIDEO' | 'IMAGE') {
  self.importScripts = importScriptsSync;
  const vision = await FilesetResolver.forVisionTasks(WASM_URL);
  const options = (delegate: 'GPU' | 'CPU') =>
    PoseLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetBuffer: model, delegate },
      runningMode,
      numPoses: MAX_POSES,
    });
  // The GPU delegate is much faster but can fail to start on some devices. Note that MediaPipe
  // still needs WebGL to read frames, so the CPU fallback doesn't help without it.
  return options('GPU').catch((_error: unknown) => options('CPU'));
}
