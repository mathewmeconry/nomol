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

/**
 * Middle of shoulders and hips. Used to follow a person: when the model flips the skeleton
 * (common going into a handstand), hips and shoulders swap, but their middle stays put.
 */
export function torsoCenter(pose: Pose): Point {
  return midpoint(hipCenter(pose), midpoint(pose[LM.leftShoulder], pose[LM.rightShoulder]));
}

/** Shoulders to hips; unlike `bodySize` it doesn't depend on the legs being found. */
export function torsoLength(pose: Pose): number {
  return distance(hipCenter(pose), midpoint(pose[LM.leftShoulder], pose[LM.rightShoulder]));
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Converts normalized x to image-height units so x and y distances are comparable. */
export function scalePose(pose: Pose, aspectRatio: number): Pose {
  return pose.map((landmark) => ({ ...landmark, x: landmark.x * aspectRatio }));
}

/** The higher of the two feet in the image (smaller y). Both feet are down when this one is. */
export function higherAnkleY(pose: Pose): number {
  return Math.min(pose[LM.leftAnkle].y, pose[LM.rightAnkle].y);
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
