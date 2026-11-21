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

/**
 * The replay skeleton's lines in image coordinates, each with its colour. The head is a line from
 * between the shoulders to the nose, also upside down; face details aren't drawn (the owner cares
 * about the head, not the face, and they aren't labelled for training either).
 */
export function skeletonLines(pose: Pose): [Point, Point, string][] {
  const lines: [Point, Point, string][] = BONES.filter(([a, b]) => isVisible(pose, a, b)).map(
    ([a, b, limb]) => [pose[a], pose[b], LIMB_COLORS[limb]],
  );
  if (isVisible(pose, LM.nose, LM.leftShoulder, LM.rightShoulder)) {
    const neck = {
      x: (pose[LM.leftShoulder].x + pose[LM.rightShoulder].x) / 2,
      y: (pose[LM.leftShoulder].y + pose[LM.rightShoulder].y) / 2,
    };
    lines.push([neck, pose[LM.nose], LIMB_COLORS.body]);
  }
  return lines;
}

const POINT_LIMBS: [number, Limb][] = [
  [LM.nose, 'body'],
  [LM.leftShoulder, 'leftArm'],
  [LM.leftElbow, 'leftArm'],
  [LM.leftWrist, 'leftArm'],
  [LM.rightShoulder, 'rightArm'],
  [LM.rightElbow, 'rightArm'],
  [LM.rightWrist, 'rightArm'],
  [LM.leftHip, 'leftLeg'],
  [LM.leftKnee, 'leftLeg'],
  [LM.leftAnkle, 'leftLeg'],
  [LM.rightHip, 'rightLeg'],
  [LM.rightKnee, 'rightLeg'],
  [LM.rightAnkle, 'rightLeg'],
];

/**
 * The skeleton's dots: every visible point, also one whose neighbours are hidden (a wrist next
 * to an elbow MediaPipe can't see). Only points below its visibility threshold are left out.
 */
export function skeletonPoints(pose: Pose): [Point, string][] {
  return POINT_LIMBS.filter(([i]) => isVisible(pose, i)).map(([i, limb]) => [
    pose[i],
    LIMB_COLORS[limb],
  ]);
}
