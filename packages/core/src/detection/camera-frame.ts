import type { Pose } from './pose';
import type { Zone } from './zone';

/** Pixels of a camera buffer. */
export type PixelRect = { x: number; y: number; width: number; height: number };

/**
 * Camera buffers come in the sensor's orientation, not as shown on screen. `rotation` is how far
 * a buffer has to be turned clockwise (0, 90, 180 or 270 degrees) to look like the picture;
 * `mirrored` means the picture is then also flipped left to right (front cameras).
 */
export type Orientation = { rotation: number; mirrored: boolean };

/**
 * The buffer pixels that show `area` of the picture (`area` normalized to the picture as seen on
 * screen). Turned by `rotation` and flipped if `mirrored`, they are that part of the picture.
 * Runs in the camera's frame worklet, so it can't call other functions.
 */
export function bufferCrop(
  area: Zone,
  width: number,
  height: number,
  { rotation, mirrored }: Orientation,
): PixelRect {
  'worklet';
  const left = mirrored ? 1 - area.right : area.left;
  const right = mirrored ? 1 - area.left : area.right;
  const { top, bottom } = area;
  // Picture coordinates (u) of a buffer point (b) turned clockwise: 90° gives u = (1 - b.y, b.x),
  // 180° u = (1 - b.x, 1 - b.y), 270° u = (b.y, 1 - b.x). Solved for b:
  const box =
    rotation === 90
      ? { left: top, top: 1 - right, right: bottom, bottom: 1 - left }
      : rotation === 180
        ? { left: 1 - right, top: 1 - bottom, right: 1 - left, bottom: 1 - top }
        : rotation === 270
          ? { left: 1 - bottom, top: left, right: 1 - top, bottom: right }
          : { left, top, right, bottom };
  const x = Math.round(Math.min(Math.max(box.left, 0), 1) * width);
  const y = Math.round(Math.min(Math.max(box.top, 0), 1) * height);
  return {
    x,
    y,
    width: Math.max(Math.round(Math.min(Math.max(box.right, 0), 1) * width) - x, 1),
    height: Math.max(Math.round(Math.min(Math.max(box.bottom, 0), 1) * height) - y, 1),
  };
}

/** The part of the picture that `crop` of a `width` × `height` buffer shows (`bufferCrop` reversed). */
export function cropArea(
  crop: PixelRect,
  width: number,
  height: number,
  { rotation, mirrored }: Orientation,
): Zone {
  const left = crop.x / width;
  const top = crop.y / height;
  const right = (crop.x + crop.width) / width;
  const bottom = (crop.y + crop.height) / height;
  const area =
    rotation === 90
      ? { left: 1 - bottom, top: left, right: 1 - top, bottom: right }
      : rotation === 180
        ? { left: 1 - right, top: 1 - bottom, right: 1 - left, bottom: 1 - top }
        : rotation === 270
          ? { left: top, top: 1 - right, right: bottom, bottom: 1 - left }
          : { left, top, right, bottom };
  return mirrored ? { ...area, left: 1 - area.right, right: 1 - area.left } : area;
}

const LANDMARKS = 33;

/**
 * Poses from MediaPipe's landmarks in a crop (x, y, visibility per landmark, 33 per pose, all
 * poses in one list; x and y normalized to the crop turned upright), in picture coordinates.
 */
export function posesInArea(landmarks: number[], area: Zone): Pose[] {
  const width = area.right - area.left;
  const height = area.bottom - area.top;
  const poses: Pose[] = [];
  for (let start = 0; start + LANDMARKS * 3 <= landmarks.length; start += LANDMARKS * 3) {
    const pose: Pose = [];
    for (let i = start; i < start + LANDMARKS * 3; i += 3) {
      pose.push({
        x: area.left + landmarks[i] * width,
        y: area.top + landmarks[i + 1] * height,
        visibility: landmarks[i + 2],
      });
    }
    poses.push(pose);
  }
  return poses;
}

/**
 * The landmark at index i of a mirrored pose: in a mirrored picture MediaPipe takes the left side
 * of the body for the right, so pairs swap (eyes 1–3 with 4–6, then left/right alternating from
 * the ears on).
 */
function mirroredIndex(i: number) {
  if (i === 0) return 0;
  if (i <= 6) return i <= 3 ? i + 3 : i - 3;
  return i % 2 === 1 ? i + 1 : i - 1;
}

/**
 * A pose detected in a mirrored picture (front cameras) as it is in the unmirrored one, as the
 * video is recorded: flipped left to right, with the body's sides swapped back.
 */
export function unmirrorPose(pose: Pose): Pose {
  return pose.map((_landmark, i) => {
    const landmark = pose[mirroredIndex(i)];
    return { ...landmark, x: 1 - landmark.x };
  });
}
