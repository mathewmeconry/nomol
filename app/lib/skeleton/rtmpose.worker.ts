/// <reference lib="webworker" />
import * as ort from 'onnxruntime-web/webgpu';
import type { Pose } from '~/lib/detection/pose';
import { download } from '~/lib/download';
import { INPUT_HEIGHT, INPUT_WIDTH, cropFromBox, decode, toInput, type Crop } from './rtmpose';
import { DETECTOR_SIZE, PAD_GREY, pickBox, readBoxes, toDetectorInput } from './yolox';

export type WorkerRequest =
  | { type: 'load'; poseUrl: string; detectorUrl: string }
  | {
      type: 'pose';
      id: number;
      /** The video frame, scaled down (JPEG). */
      image: Blob;
      /** MediaPipe's pose of the gymnast in this frame, to pick their detector box. */
      tracked: Pose;
      /** Crop from MediaPipe's poses (frame pixels), if the detector finds nothing. */
      fallback: Crop;
    };

export type WorkerResponse =
  | { type: 'progress'; percent: number }
  | { type: 'ready' }
  | { type: 'pose'; id: number; pose: Pose }
  | { type: 'error'; id?: number; message: string };

/** Model sizes, to weigh their download progress. */
const DETECTOR_MB = 36;
const POSE_MB = 54;

let pose: ort.InferenceSession | null = null;
/**
 * Only on the GPU: on the CPU YOLOX takes over a second per frame. (RTMPose is the other way
 * round: onnxruntime-web's WebGPU backend computes it wrong in its default NHWC layout. With
 * `preferredLayout: 'NCHW'` it's right, but no faster than WASM on several threads, which the
 * service worker's cross-origin isolation allows, and it leaves the GPU to live detection.)
 */
let detector: ort.InferenceSession | null = null;
const detectorCanvas = new OffscreenCanvas(DETECTOR_SIZE, DETECTOR_SIZE);
const detectorCtx = detectorCanvas.getContext('2d', { willReadFrequently: true })!;
const cropCanvas = new OffscreenCanvas(INPUT_WIDTH, INPUT_HEIGHT);
const cropCtx = cropCanvas.getContext('2d', { willReadFrequently: true })!;

function reply(message: WorkerResponse) {
  self.postMessage(message);
}

async function load(poseUrl: string, detectorUrl: string) {
  const useDetector = 'gpu' in navigator;
  const total = POSE_MB + (useDetector ? DETECTOR_MB : 0);
  let done = 0;
  const progress = (mb: number) => (percent: number) =>
    reply({ type: 'progress', percent: Math.floor(((done + (percent / 100) * mb) / total) * 100) });
  if (useDetector) {
    const model = await download(detectorUrl, progress(DETECTOR_MB));
    done += DETECTOR_MB;
    detector = await ort.InferenceSession.create(model, { executionProviders: ['webgpu'] }).catch(
      () => null, // e.g. no usable adapter: crops from MediaPipe's pose instead
    );
  }
  const model = await download(poseUrl, progress(POSE_MB));
  pose = await ort.InferenceSession.create(model, { executionProviders: ['wasm'] });
}

/** Boxes of the people in the frame, in frame pixels. */
async function detect(frame: ImageBitmap) {
  if (!detector) return [];
  const scale = DETECTOR_SIZE / Math.max(frame.width, frame.height);
  detectorCtx.fillStyle = `rgb(${PAD_GREY}, ${PAD_GREY}, ${PAD_GREY})`;
  detectorCtx.fillRect(0, 0, DETECTOR_SIZE, DETECTOR_SIZE);
  detectorCtx.drawImage(frame, 0, 0, frame.width * scale, frame.height * scale);
  const input = toDetectorInput(detectorCtx.getImageData(0, 0, DETECTOR_SIZE, DETECTOR_SIZE).data);
  const output = await detector.run({
    input: new ort.Tensor('float32', input, [1, 3, DETECTOR_SIZE, DETECTOR_SIZE]),
  });
  return readBoxes(output.dets.data as Float32Array, scale);
}

/** Draws the crop at the model's input size; parts beyond the frame stay black. */
function cropPixels(frame: ImageBitmap, crop: Crop) {
  const scale = INPUT_WIDTH / crop.width;
  // Clipped by hand: Chrome mis-scales drawImage source rectangles that reach past the image.
  const left = Math.max(0, crop.x);
  const top = Math.max(0, crop.y);
  const right = Math.min(frame.width, crop.x + crop.width);
  const bottom = Math.min(frame.height, crop.y + crop.height);
  cropCtx.fillStyle = 'black';
  cropCtx.fillRect(0, 0, INPUT_WIDTH, INPUT_HEIGHT);
  if (right > left && bottom > top) {
    cropCtx.drawImage(
      frame,
      left,
      top,
      right - left,
      bottom - top,
      (left - crop.x) * scale,
      (top - crop.y) * scale,
      (right - left) * scale,
      (bottom - top) * scale,
    );
  }
  return cropCtx.getImageData(0, 0, INPUT_WIDTH, INPUT_HEIGHT).data;
}

// onnxruntime is bundled into this file, so its WASM threads start this file too (named
// `em-pthread`); they must keep onnxruntime's message handler, or loading hangs.
if (!self.name.startsWith('em-pthread')) self.onmessage = handle;

async function handle(event: MessageEvent<WorkerRequest>) {
  const request = event.data;
  try {
    if (request.type === 'load') {
      await load(request.poseUrl, request.detectorUrl);
      reply({ type: 'ready' });
      return;
    }
    if (!pose) throw new Error('Model not loaded');
    const frame = await createImageBitmap(request.image);
    const box = pickBox(await detect(frame), request.tracked, frame.width, frame.height);
    const crop = box ? cropFromBox(box) : request.fallback;
    const input = toInput(cropPixels(frame, crop));
    const output = await pose.run({
      input: new ort.Tensor('float32', input, [1, 3, INPUT_HEIGHT, INPUT_WIDTH]),
    });
    const result = decode(
      output.simcc_x.data as Float32Array,
      output.simcc_y.data as Float32Array,
      crop,
      frame.width,
      frame.height,
    );
    frame.close();
    reply({ type: 'pose', id: request.id, pose: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    reply({ type: 'error', id: request.type === 'pose' ? request.id : undefined, message });
  }
}
