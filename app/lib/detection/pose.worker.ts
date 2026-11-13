/// <reference lib="webworker" />
import type { PoseLandmarker } from '@mediapipe/tasks-vision';
import { createLandmarker } from './landmarker.client';
import type { Pose } from './pose';

export type DetectRequest =
  | { id: number; type: 'load'; model: Uint8Array }
  | { id: number; type: 'detect'; frame: VideoFrame; time: number };

export type DetectResponse =
  | { id: number; type: 'ready' }
  /** `frame` comes back for recording: it's the picture these poses belong to. */
  | { id: number; type: 'poses'; frame: VideoFrame; poses: Pose[]; ms: number }
  | { id: number; type: 'error'; message: string };

let landmarker: PoseLandmarker | null = null;

function reply(message: DetectResponse, transfer: Transferable[] = []) {
  self.postMessage(message, transfer);
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
    const poses = landmarker!.detectForVideo(request.frame, request.time).landmarks;
    const ms = performance.now() - start;
    reply({ id: request.id, type: 'poses', frame: request.frame, poses, ms }, [request.frame]);
  } catch (error) {
    if (request.type === 'detect') request.frame.close();
    reply({ id: request.id, type: 'error', message: String(error) });
  }
};
