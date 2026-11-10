import { LM, type Landmark, type Pose } from '~/lib/detection/pose';

/** Body proportions in image units for a person ~0.4 of the image tall. */
const H = { shoulder: 0.27, hip: 0.18, knee: 0.09, head: 0.33 };

type Options = {
  /** Horizontal position of the hips. */
  x: number;
  /** y of the floor the person stands on. */
  feetY: number;
  /** How far the whole body is lifted off the floor, e.g. hanging or in support on a bar. */
  lift?: number;
  kind?: 'stand' | 'sign' | 'armsUp';
  /** Seen from the side: shoulders look narrow. */
  side?: boolean;
};

/**
 * Builds a full 33-point pose for tests. Only the landmarks the detection uses are placed
 * deliberately; the rest sit at the hips.
 */
export function makePose({ x, feetY, lift = 0, kind = 'stand', side = false }: Options): Pose {
  const base = feetY - lift;
  const halfWidth = side ? 0.015 : 0.05;
  const at = (dx: number, height: number): Landmark => ({
    x: x + dx,
    y: base - height,
    visibility: 1,
  });

  const pose: Pose = Array.from({ length: 33 }, () => at(0, H.hip));
  pose[LM.nose] = at(0, H.head);
  // Facing the camera, the person's left side appears on the image right.
  pose[LM.leftShoulder] = at(halfWidth, H.shoulder);
  pose[LM.rightShoulder] = at(-halfWidth, H.shoulder);
  pose[LM.leftHip] = at(halfWidth / 2, H.hip);
  pose[LM.rightHip] = at(-halfWidth / 2, H.hip);
  pose[LM.leftKnee] = at(halfWidth / 2, H.knee);
  pose[LM.rightKnee] = at(-halfWidth / 2, H.knee);
  pose[LM.leftAnkle] = at(halfWidth / 2, 0);
  pose[LM.rightAnkle] = at(-halfWidth / 2, 0);

  if (kind === 'sign') {
    pose[LM.leftElbow] = at(0.07, 0.36);
    pose[LM.rightElbow] = at(-0.07, 0.36);
    pose[LM.leftWrist] = at(-0.02, 0.4);
    pose[LM.rightWrist] = at(0.02, 0.4);
  } else if (kind === 'armsUp') {
    pose[LM.leftElbow] = at(0.06, 0.36);
    pose[LM.rightElbow] = at(-0.06, 0.36);
    pose[LM.leftWrist] = at(0.05, 0.42);
    pose[LM.rightWrist] = at(-0.05, 0.42);
  } else {
    pose[LM.leftElbow] = at(halfWidth + 0.01, 0.2);
    pose[LM.rightElbow] = at(-halfWidth - 0.01, 0.2);
    pose[LM.leftWrist] = at(halfWidth + 0.01, H.hip);
    pose[LM.rightWrist] = at(-halfWidth - 0.01, H.hip);
  }
  return pose;
}
