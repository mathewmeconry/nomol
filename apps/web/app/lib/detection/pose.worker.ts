/// <reference lib="webworker" />
import type { PoseLandmarker } from '@mediapipe/tasks-vision';
import { createLandmarker } from './landmarker.client';
import type { Pose } from '@nomol/core/detection/pose';
import type { Zone } from '@nomol/core/detection/zone';

export type DetectRequest =
  | { id: number; type: 'load'; model: Uint8Array }
  /** `area`: the part of the frame to detect in (`detectionArea`), normalized. */
  | { id: number; type: 'detect'; frame: VideoFrame; time: number; area: Zone };

export type DetectResponse =
  | { id: number; type: 'ready' }
  /** `frame` comes back for recording: it's the picture these poses belong to. */
  | { id: number; type: 'poses'; frame: VideoFrame; poses: Pose[]; ms: number }
  | { id: number; type: 'error'; message: string };

let landmarker: PoseLandmarker | null = null;

function reply(message: DetectResponse, transfer: Transferable[] = []) {
  self.postMessage(message, transfer);
}

/**
 * Poses in part of the frame, in coordinates of the whole frame. The crop is a view of the same
 * picture (`visibleRect`), not a copy.
 */
function detectIn(landmarker: PoseLandmarker, frame: VideoFrame, area: Zone, time: number) {
  const visible = frame.visibleRect!;
  // Planar formats such as NV12 need even offsets and sizes.
  const even = (value: number) => 2 * Math.floor(value / 2);
  const x = even(area.left * visible.width);
  const y = even(area.top * visible.height);
  const width = Math.min(even((area.right - area.left) * visible.width), visible.width - x);
  const height = Math.min(even((area.bottom - area.top) * visible.height), visible.height - y);
  if (width >= visible.width && height >= visible.height) {
    return landmarker.detectForVideo(frame, time).landmarks;
  }
  const view = new VideoFrame(frame, {
    visibleRect: { x: visible.x + x, y: visible.y + y, width, height },
  });
  try {
    return landmarker.detectForVideo(view, time).landmarks.map((pose) =>
      pose.map((landmark) => ({
        ...landmark,
        x: (x + landmark.x * width) / visible.width,
        y: (y + landmark.y * height) / visible.height,
      })),
    );
  } finally {
    view.close();
  }
}

self.onmessage = async (event: MessageEvent<DetectRequest>) => {
  const request = event.data;
  try {
    if (request.type === 'load') {
      // Replacing the model (lite when heavy is too slow) keeps detecting with the old one
      // until the new one is ready.
      const created = await createLandmarker(request.model, 'VIDEO');
      landmarker?.close();
      landmarker = created;
      reply({ id: request.id, type: 'ready' });
      return;
    }
    const start = performance.now();
    const poses = detectIn(landmarker!, request.frame, request.area, request.time);
    const ms = performance.now() - start;
    reply({ id: request.id, type: 'poses', frame: request.frame, poses, ms }, [request.frame]);
  } catch (error) {
    if (request.type === 'detect') request.frame.close();
    reply({ id: request.id, type: 'error', message: String(error) });
  }
};
