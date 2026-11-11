/// <reference lib="webworker" />
import * as ort from 'onnxruntime-web/wasm';
import type { Pose } from '~/lib/detection/pose';
import { download } from '~/lib/download';
import { INPUT_HEIGHT, INPUT_WIDTH, decode, toInput, type Crop } from './rtmpose';

// Runs on the CPU (WASM, bundled by Vite): onnxruntime-web's WebGPU backend returns wrong
// keypoints for RTMPose (checked against Python on the same input).

export type WorkerRequest =
  | { type: 'load'; url: string }
  | {
      type: 'pose';
      id: number;
      /** The crop as JPEG, already scaled to the model's input size. */
      image: Blob;
      crop: Crop;
      videoWidth: number;
      videoHeight: number;
    };

export type WorkerResponse =
  | { type: 'progress'; percent: number }
  | { type: 'ready' }
  | { type: 'pose'; id: number; pose: Pose }
  | { type: 'error'; id?: number; message: string };

let session: ort.InferenceSession | null = null;
const canvas = new OffscreenCanvas(INPUT_WIDTH, INPUT_HEIGHT);
const ctx = canvas.getContext('2d', { willReadFrequently: true })!;

function reply(message: WorkerResponse) {
  self.postMessage(message);
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  try {
    if (request.type === 'load') {
      const model = await download(request.url, (percent) => reply({ type: 'progress', percent }));
      session = await ort.InferenceSession.create(model);
      reply({ type: 'ready' });
      return;
    }
    if (!session) throw new Error('Model not loaded');
    const bitmap = await createImageBitmap(request.image);
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    const input = toInput(ctx.getImageData(0, 0, INPUT_WIDTH, INPUT_HEIGHT).data);
    const output = await session.run({
      input: new ort.Tensor('float32', input, [1, 3, INPUT_HEIGHT, INPUT_WIDTH]),
    });
    const pose = decode(
      output.simcc_x.data as Float32Array,
      output.simcc_y.data as Float32Array,
      request.crop,
      request.videoWidth,
      request.videoHeight,
    );
    reply({ type: 'pose', id: request.id, pose });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    reply({ type: 'error', id: request.type === 'pose' ? request.id : undefined, message });
  }
};
