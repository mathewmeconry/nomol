/// <reference lib="webworker" />
import type { PoseLandmarker } from '@mediapipe/tasks-vision';
import { createLandmarker } from './landmarker.client';
import type { Pose } from '@nomol/core/detection/pose';
import { mergeAreas, type Zone } from '@nomol/core/detection/zone';

export type DetectRequest =
  | { id: number; type: 'load'; model: Uint8Array }
  /** `areas`: the parts of the frame to detect in (`detectionAreas`), normalized. */
  | { id: number; type: 'detect'; frame: VideoFrame; time: number; areas: Zone[] };

export type DetectResponse =
  | { id: number; type: 'ready' }
  /**
   * `frame` comes back for recording: it's the picture these poses belong to. `ms`: time per
   * area.
   */
  | { id: number; type: 'poses'; frame: VideoFrame; poses: Pose[]; ms: number }
  | { id: number; type: 'error'; message: string };

let model: Uint8Array | null = null;
/**
 * One per area (the first area always goes to the first): in VIDEO mode MediaPipe follows the
 * poses it found into the next picture, and alternating two start zones on one landmarker lost
 * that. Its person detector alone misses many people with their arms above the head: on the
 * floor (November 20 2026) a girl showing the start sign was found in 5 of 60 frames that way,
 * followed in 43 with a landmarker of her own.
 */
let landmarkers: PoseLandmarker[] = [];
let lastTimes: number[] = [];

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
      for (const landmarker of landmarkers) landmarker.close();
      landmarkers = [created];
      lastTimes = [-Infinity];
      model = request.model;
      reply({ id: request.id, type: 'ready' });
      return;
    }
    const { frame, areas, time } = request;
    // Created the first time a second start zone is looked at: that frame is late, but nobody
    // pays for a landmarker never used.
    while (landmarkers.length < areas.length) {
      landmarkers.push(await createLandmarker(model!, 'VIDEO'));
      lastTimes.push(-Infinity);
    }
    const start = performance.now();
    const found = areas.map((area, i) => {
      // MediaPipe refuses timestamps that don't grow, in whole ms.
      lastTimes[i] = Math.max(Math.floor(time), lastTimes[i] + 1);
      return detectIn(landmarkers[i], frame, area, lastTimes[i]);
    });
    const visible = frame.visibleRect!;
    const poses = mergeAreas(found, visible.width / visible.height);
    const ms = (performance.now() - start) / areas.length;
    reply({ id: request.id, type: 'poses', frame: request.frame, poses, ms }, [request.frame]);
  } catch (error) {
    if (request.type === 'detect') request.frame.close();
    reply({ id: request.id, type: 'error', message: String(error) });
  }
};
