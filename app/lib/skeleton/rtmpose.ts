import { LM, boundingBox, type Pose } from '~/lib/detection/pose';

/**
 * RTMPose-m (body7, 256×192) computes the replay skeleton after a recording. It gets upside-down
 * poses right far more often than MediaPipe (on a handstand recording 43 of 48 frames vs ~33),
 * but is too slow to run live, so it works on crops saved while recording.
 */
export const INPUT_WIDTH = 192;
export const INPUT_HEIGHT = 256;

/**
 * The crop is MediaPipe's landmark box enlarged this much: RTMPose's usual 1.25 times 1.4, as
 * MediaPipe's box is tighter than a detector's and sometimes off when it flips the skeleton.
 * Measured on the handstand recording: 1.25 found 40 of 48 frames, 1.75 found 46.
 */
const CROP_PADDING = 1.75;
/** RTMPose predicts x and y on a grid twice as fine as its input. */
const SIMCC_SPLIT = 2;
const KEYPOINTS = 17;
/** Below this the model is guessing; such keypoints are hidden. */
const MIN_SCORE = 0.3;

/** BGR mean and std the model was trained with, in the channel order it expects. */
const MEAN = [123.675, 116.28, 103.53];
const STD = [58.395, 57.12, 57.375];

/** COCO keypoint index → MediaPipe landmark index, so the rest of the app needs no changes. */
const COCO_TO_MEDIAPIPE = [
  LM.nose,
  LM.leftEye,
  LM.rightEye,
  LM.leftEar,
  LM.rightEar,
  LM.leftShoulder,
  LM.rightShoulder,
  LM.leftElbow,
  LM.rightElbow,
  LM.leftWrist,
  LM.rightWrist,
  LM.leftHip,
  LM.rightHip,
  LM.leftKnee,
  LM.rightKnee,
  LM.leftAnkle,
  LM.rightAnkle,
];

/** Part of the video (in video pixels) that RTMPose looks at. May reach past the edges. */
export type Crop = { x: number; y: number; width: number; height: number };

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/**
 * The region around the gymnast's current MediaPipe pose (the last of `recent`), at the model's
 * 3:4 aspect ratio. MediaPipe sometimes collapses the skeleton onto part of the body for a frame
 * (seen in handstands), so the region is never smaller than the gymnast's typical size in the
 * recent poses. Taking their combined extent instead made the person too small in the crop.
 */
export function cropAround(recent: Pose[], videoWidth: number, videoHeight: number): Crop {
  const boxes = recent.map(boundingBox);
  const box = boxes[boxes.length - 1];
  const size = (b: (typeof boxes)[number]) => ({
    width: (b.right - b.left) * videoWidth,
    height: (b.bottom - b.top) * videoHeight,
  });
  const centerX = ((box.left + box.right) / 2) * videoWidth;
  const centerY = ((box.top + box.bottom) / 2) * videoHeight;
  let width = Math.max(size(box).width, median(boxes.map((b) => size(b).width))) * CROP_PADDING;
  let height = Math.max(size(box).height, median(boxes.map((b) => size(b).height))) * CROP_PADDING;
  const aspect = INPUT_WIDTH / INPUT_HEIGHT;
  if (width > height * aspect) height = width / aspect;
  else width = height * aspect;
  return { x: centerX - width / 2, y: centerY - height / 2, width, height };
}

/** RGBA pixels of a crop (INPUT_WIDTH × INPUT_HEIGHT) → the model's normalized BGR NCHW input. */
export function toInput(rgba: Uint8ClampedArray): Float32Array {
  const pixels = INPUT_WIDTH * INPUT_HEIGHT;
  const input = new Float32Array(3 * pixels);
  for (let i = 0; i < pixels; i++) {
    const bgr = [rgba[i * 4 + 2], rgba[i * 4 + 1], rgba[i * 4]];
    for (let c = 0; c < 3; c++) input[c * pixels + i] = (bgr[c] - MEAN[c]) / STD[c];
  }
  return input;
}

function argmax(values: Float32Array, offset: number, length: number) {
  let best = 0;
  for (let i = 1; i < length; i++) if (values[offset + i] > values[offset + best]) best = i;
  return best;
}

/**
 * Model output → a pose in normalized video coordinates, MediaPipe layout. Landmarks RTMPose
 * doesn't have (hands, feet details) and unsure keypoints get visibility 0, so they aren't drawn.
 */
export function decode(
  simccX: Float32Array,
  simccY: Float32Array,
  crop: Crop,
  videoWidth: number,
  videoHeight: number,
): Pose {
  const xBins = INPUT_WIDTH * SIMCC_SPLIT;
  const yBins = INPUT_HEIGHT * SIMCC_SPLIT;
  const pose: Pose = Array.from({ length: 33 }, () => ({ x: 0, y: 0, visibility: 0 }));
  for (let k = 0; k < KEYPOINTS; k++) {
    const bx = argmax(simccX, k * xBins, xBins);
    const by = argmax(simccY, k * yBins, yBins);
    const score = (simccX[k * xBins + bx] + simccY[k * yBins + by]) / 2;
    pose[COCO_TO_MEDIAPIPE[k]] = {
      x: (crop.x + (bx / xBins) * crop.width) / videoWidth,
      y: (crop.y + (by / yBins) * crop.height) / videoHeight,
      // RTMPose scores run lower than MediaPipe's visibility (good keypoints often 0.5–0.7).
      visibility: score >= MIN_SCORE ? 1 : 0,
    };
  }
  return pose;
}
