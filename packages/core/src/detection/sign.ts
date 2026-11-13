import { LM, isVisible, type Pose } from './pose';

/**
 * From the side, crossed and plain raised arms look the same, so the sign only counts when the
 * person faces the camera: shoulders must look wide compared to the torso length. MediaPipe's
 * shoulder points sit inwards, so facing the camera measures only ~0.43–0.55 on real footage;
 * in profile it drops to ~0.1–0.2.
 */
const MIN_SHOULDER_TO_TORSO = 0.3;
/**
 * When forearms cross, MediaPipe often places both wrists almost on top of each other and their
 * left/right order flips between frames, so wrists this close (relative to shoulder width) count
 * as crossed too. Plain raised arms keep the wrists about a shoulder width apart.
 */
const MAX_WRIST_GAP = 0.4;
/** In an X the elbows point outwards; hands held together with straight arms don't count. */
const MIN_ELBOW_GAP = 0.9;

/**
 * Start sign: forearms crossed above the head, facing the camera.
 * Expects coordinates in equal units on both axes (see `scalePose`).
 */
export function isStartSign(pose: Pose): boolean {
  // Elbows and wrists may be unsure: further away than ~half the picture height the heavy model
  // rates crossed wrists (hiding each other) at 0.1–0.5 visibility, though their positions are
  // right. The shape below still has to match, which guessed arms don't.
  if (!isVisible(pose, LM.nose, LM.leftShoulder, LM.rightShoulder, LM.leftHip, LM.rightHip)) {
    return false;
  }

  const nose = pose[LM.nose];
  const ls = pose[LM.leftShoulder];
  const rs = pose[LM.rightShoulder];
  const lw = pose[LM.leftWrist];
  const rw = pose[LM.rightWrist];
  const shoulderY = (ls.y + rs.y) / 2;
  const hipY = (pose[LM.leftHip].y + pose[LM.rightHip].y) / 2;
  const shoulderWidth = Math.abs(ls.x - rs.x);

  const torso = hipY - shoulderY;
  if (torso <= 0) return false;
  if (shoulderWidth < MIN_SHOULDER_TO_TORSO * torso) return false;

  const wristsAboveHead = lw.y < nose.y && rw.y < nose.y;
  const wristsSwapped = Math.sign(lw.x - rw.x) !== Math.sign(ls.x - rs.x);
  const wristsTogether = Math.abs(lw.x - rw.x) < MAX_WRIST_GAP * shoulderWidth;
  const elbowsWide =
    Math.abs(pose[LM.leftElbow].x - pose[LM.rightElbow].x) > MIN_ELBOW_GAP * shoulderWidth;
  return wristsAboveHead && (wristsSwapped || wristsTogether) && elbowsWide;
}
