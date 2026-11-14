import { LM, isVisible, type Point, type Pose } from '../detection/pose';

/**
 * Left is warm, right is cool, so sides stay apparent when the gymnast turns or flips; arms are
 * the lighter shade of their side, legs the stronger one. Left/right is the gymnast's own side.
 */
export const LIMB_COLORS = {
  leftArm: '#ffc145',
  leftLeg: '#ff6b35',
  rightArm: '#5ee6ff',
  rightLeg: '#4d7cff',
  body: '#ffffff',
} as const;

type Limb = keyof typeof LIMB_COLORS;

const BONES: [number, number, Limb][] = [
  [LM.leftShoulder, LM.rightShoulder, 'body'],
  [LM.leftShoulder, LM.leftHip, 'body'],
  [LM.rightShoulder, LM.rightHip, 'body'],
  [LM.leftHip, LM.rightHip, 'body'],
  [LM.leftShoulder, LM.leftElbow, 'leftArm'],
  [LM.leftElbow, LM.leftWrist, 'leftArm'],
  [LM.rightShoulder, LM.rightElbow, 'rightArm'],
  [LM.rightElbow, LM.rightWrist, 'rightArm'],
  [LM.leftHip, LM.leftKnee, 'leftLeg'],
  [LM.leftKnee, LM.leftAnkle, 'leftLeg'],
  [LM.rightHip, LM.rightKnee, 'rightLeg'],
  [LM.rightKnee, LM.rightAnkle, 'rightLeg'],
];

/** Ear – eye – nose – eye – ear: shows where the head points, also upside down. */
const HEAD: [number, number, Limb][] = [
  [LM.leftEar, LM.leftEye, 'body'],
  [LM.leftEye, LM.nose, 'body'],
  [LM.nose, LM.rightEye, 'body'],
  [LM.rightEye, LM.rightEar, 'body'],
];

/** The replay skeleton's lines in image coordinates, each with its colour. */
export function skeletonLines(pose: Pose): [Point, Point, string][] {
  // In profile the far ear and eye are guesses; leave out what MediaPipe can't see.
  const lines: [Point, Point, string][] = [...BONES, ...HEAD]
    .filter(([a, b]) => isVisible(pose, a, b))
    .map(([a, b, limb]) => [pose[a], pose[b], LIMB_COLORS[limb]]);
  if (isVisible(pose, LM.nose, LM.leftShoulder, LM.rightShoulder)) {
    const neck = {
      x: (pose[LM.leftShoulder].x + pose[LM.rightShoulder].x) / 2,
      y: (pose[LM.leftShoulder].y + pose[LM.rightShoulder].y) / 2,
    };
    lines.push([neck, pose[LM.nose], LIMB_COLORS.body]);
  }
  return lines;
}
