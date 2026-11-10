/**
 * Geometry helpers on MediaPipe pose landmarks. Coordinates are normalized to the image
 * (0..1, y grows downwards). Indices follow the MediaPipe 33-point body model.
 */

export type Landmark = { x: number; y: number; visibility?: number };
export type Pose = Landmark[];
export type Point = { x: number; y: number };

export const LM = {
  nose: 0,
  leftEye: 2,
  rightEye: 5,
  leftEar: 7,
  rightEar: 8,
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24,
  leftKnee: 25,
  rightKnee: 26,
  leftAnkle: 27,
  rightAnkle: 28,
} as const;

const MIN_VISIBILITY = 0.5;

export function isVisible(pose: Pose, ...indices: number[]): boolean {
  return indices.every((i) => (pose[i]?.visibility ?? 1) >= MIN_VISIBILITY);
}

function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export function hipCenter(pose: Pose): Point {
  return midpoint(pose[LM.leftHip], pose[LM.rightHip]);
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Converts normalized x to image-height units so x and y distances are comparable. */
export function scalePose(pose: Pose, aspectRatio: number): Pose {
  return pose.map((landmark) => ({ ...landmark, x: landmark.x * aspectRatio }));
}

/** Lowest point of the body in the image (largest y), i.e. where the feet are. */
export function lowestAnkleY(pose: Pose): number {
  return Math.max(pose[LM.leftAnkle].y, pose[LM.rightAnkle].y);
}

/**
 * Body size in image units, used to make thresholds independent of how far the person stands
 * from the camera. Shoulder-to-ankle stays meaningful when the person is upside down too.
 */
export function bodySize(pose: Pose): number {
  const shoulders = midpoint(pose[LM.leftShoulder], pose[LM.rightShoulder]);
  const ankles = midpoint(pose[LM.leftAnkle], pose[LM.rightAnkle]);
  return Math.max(distance(shoulders, ankles), 0.02);
}

export function boundingBox(pose: Pose): {
  left: number;
  top: number;
  right: number;
  bottom: number;
} {
  const xs = pose.map((p) => p.x);
  const ys = pose.map((p) => p.y);
  return {
    left: Math.min(...xs),
    top: Math.min(...ys),
    right: Math.max(...xs),
    bottom: Math.max(...ys),
  };
}
