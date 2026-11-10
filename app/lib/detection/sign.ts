import { LM, isVisible, type Pose } from './pose';

/**
 * From the side, crossed and plain raised arms look the same, so the sign only counts when the
 * person faces the camera: shoulders must look wide compared to the torso length.
 */
const MIN_SHOULDER_TO_TORSO = 0.45;

/**
 * Start sign: forearms crossed above the head, facing the camera.
 * Crossed means the wrists have swapped sides relative to the shoulders.
 */
export function isStartSign(pose: Pose): boolean {
  if (
    !isVisible(
      pose,
      LM.nose,
      LM.leftShoulder,
      LM.rightShoulder,
      LM.leftWrist,
      LM.rightWrist,
      LM.leftHip,
      LM.rightHip,
    )
  ) {
    return false;
  }

  const nose = pose[LM.nose];
  const ls = pose[LM.leftShoulder];
  const rs = pose[LM.rightShoulder];
  const lw = pose[LM.leftWrist];
  const rw = pose[LM.rightWrist];
  const shoulderY = (ls.y + rs.y) / 2;
  const hipY = (pose[LM.leftHip].y + pose[LM.rightHip].y) / 2;

  const torso = hipY - shoulderY;
  if (torso <= 0) return false;
  if (Math.abs(ls.x - rs.x) < MIN_SHOULDER_TO_TORSO * torso) return false;

  const wristsAboveHead = lw.y < nose.y && rw.y < nose.y;
  const wristsCrossed = Math.sign(lw.x - rw.x) !== Math.sign(ls.x - rs.x);
  return wristsAboveHead && wristsCrossed;
}
