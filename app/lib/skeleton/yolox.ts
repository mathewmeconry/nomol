import { boundingBox, torsoCenter, type Pose } from '~/lib/detection/pose';

/**
 * YOLOX-s (human-art) finds people for RTMPose. Its box covers the whole body even when
 * MediaPipe's skeleton is off, which matters most in handstands: on a phone recording RTMPose on
 * YOLOX boxes got 44 of 47 handstand frames the right way up, on MediaPipe boxes 43 of 48 at best
 * and fewer live, when MediaPipe collapses the skeleton.
 */
export const DETECTOR_SIZE = 640;
/** The model's own boxes below this score are noise. */
const MIN_SCORE = 0.3;
/** YOLOX was trained on letterboxed images padded with this grey. */
export const PAD_GREY = 114;

/** Box in image pixels. */
export type Box = { left: number; top: number; right: number; bottom: number };

/** RGBA pixels of the letterboxed DETECTOR_SIZE² image → YOLOX's input: BGR 0–255, NCHW. */
export function toDetectorInput(rgba: Uint8ClampedArray): Float32Array {
  const pixels = DETECTOR_SIZE * DETECTOR_SIZE;
  const input = new Float32Array(3 * pixels);
  for (let i = 0; i < pixels; i++) {
    input[i] = rgba[i * 4 + 2];
    input[pixels + i] = rgba[i * 4 + 1];
    input[2 * pixels + i] = rgba[i * 4];
  }
  return input;
}

/**
 * The model's output (`dets`: [x1, y1, x2, y2, score] per row, already non-max suppressed) →
 * boxes in image pixels. `scale` is how much the image was shrunk to fit the input.
 */
export function readBoxes(dets: Float32Array, scale: number): Box[] {
  const boxes: Box[] = [];
  for (let i = 0; i + 5 <= dets.length; i += 5) {
    if (dets[i + 4] < MIN_SCORE) continue;
    boxes.push({
      left: dets[i] / scale,
      top: dets[i + 1] / scale,
      right: dets[i + 2] / scale,
      bottom: dets[i + 3] / scale,
    });
  }
  return boxes;
}

function overlap(a: Box, b: Box) {
  const width = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const height = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  if (width <= 0 || height <= 0) return 0;
  const area = (box: Box) => (box.right - box.left) * (box.bottom - box.top);
  return (width * height) / (area(a) + area(b) - width * height);
}

/**
 * The detected box of the tracked gymnast (MediaPipe's pose, normalized): it must contain their
 * torso centre, which stays put when MediaPipe flips the skeleton. Among several (a spotter
 * right behind), the one overlapping MediaPipe's box most. Null if no box contains them.
 */
export function pickBox(boxes: Box[], pose: Pose, width: number, height: number): Box | null {
  const center = torsoCenter(pose);
  const x = center.x * width;
  const y = center.y * height;
  const own = boundingBox(pose);
  const tracked = {
    left: own.left * width,
    top: own.top * height,
    right: own.right * width,
    bottom: own.bottom * height,
  };
  const containing = boxes.filter(
    (b) => x >= b.left && x <= b.right && y >= b.top && y <= b.bottom,
  );
  if (containing.length === 0) return null;
  return containing.reduce((best, box) =>
    overlap(box, tracked) > overlap(best, tracked) ? box : best,
  );
}
