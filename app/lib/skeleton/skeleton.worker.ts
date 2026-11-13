/// <reference lib="webworker" />
import type { PoseLandmarker } from '@mediapipe/tasks-vision';
import { createLandmarker } from '~/lib/detection/pose-detector.client';
import type { Pose } from '~/lib/detection/pose';
import { createTracker, fromView, type View } from './rotation';

/** Side of the turned view handed to MediaPipe. */
const VIEW_SIZE = 512;

export type WorkerRequest =
  | { type: 'load'; model: Uint8Array }
  | {
      type: 'frame';
      /** The saved frame (JPEG). */
      image: Blob;
      /** The live tracking's pose of the gymnast in this frame. */
      tracked: Pose;
      /** The first frame of a pass through a clip: the gymnast is upright again. */
      restart: boolean;
    };

export type WorkerResponse =
  { type: 'ready' } | { type: 'frame'; pose: Pose | null } | { type: 'error'; message: string };

// MediaPipe loads its WASM glue with importScripts, which module workers don't allow. A
// synchronous fetch evaluated in global scope does the same.
self.importScripts = (...urls: (string | URL)[]) => {
  for (const url of urls) {
    const request = new XMLHttpRequest();
    request.open('GET', url.toString(), false);
    request.send();
    (0, eval)(request.responseText);
  }
};

let landmarker: PoseLandmarker | null = null;
let next: ReturnType<typeof createTracker> | null = null;
const viewCanvas = new OffscreenCanvas(VIEW_SIZE, VIEW_SIZE);
const viewCtx = viewCanvas.getContext('2d')!;

function reply(message: WorkerResponse) {
  self.postMessage(message);
}

/** MediaPipe on the frame turned and cropped to `view`; poses normalized to the frame. */
function detectView(frame: ImageBitmap, view: View): Pose[] {
  viewCtx.setTransform(1, 0, 0, 1, 0, 0);
  viewCtx.fillStyle = 'black';
  viewCtx.fillRect(0, 0, VIEW_SIZE, VIEW_SIZE);
  viewCtx.translate(VIEW_SIZE / 2, VIEW_SIZE / 2);
  viewCtx.scale(VIEW_SIZE / view.size, VIEW_SIZE / view.size);
  viewCtx.rotate(-view.angle);
  viewCtx.translate(-view.center.x, -view.center.y);
  viewCtx.drawImage(frame, 0, 0);
  return landmarker!.detect(viewCanvas).landmarks.map((pose) =>
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

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  try {
    if (request.type === 'load') {
      landmarker = await createLandmarker(request.model, 'IMAGE');
      reply({ type: 'ready' });
      return;
    }
    const frame = await createImageBitmap(request.image);
    if (request.restart || !next) next = createTracker(frame.width, frame.height);
    const pose = next(request.tracked, (view) => detectView(frame, view));
    frame.close();
    reply({ type: 'frame', pose });
  } catch (error) {
    reply({ type: 'error', message: String(error) });
  }
};
