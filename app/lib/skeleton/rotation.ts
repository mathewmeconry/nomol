import { LM, torsoCenter, type Point, type Pose } from '~/lib/detection/pose';

/**
 * The replay skeleton is MediaPipe on frames saved while recording, each turned so the gymnast
 * appears upright: MediaPipe gets upright people right but often flips upside-down ones. The
 * turn comes from the previous frame's body angle plus how fast it was turning, since gymnasts
 * start upright and turn gradually. On two dim handstand recordings with the legs often out of
 * the picture this got 53 of 63 handstand frames the right way up (live MediaPipe 35, MediaPipe
 * on whole frames 49). On five Reck and Sprung recordings from a busy hall it agreed with RTMPose
 * as often as live did (595 and 591 of 617 frames), upside down in 34 of 40 frames (live 30).
 */

/** Part of a frame MediaPipe looks at: a square around `center`, turned by `angle`. In pixels. */
export type View = { center: Point; size: number; angle: number };

/** Runs MediaPipe on a view; poses normalized to the whole frame, like the live ones. */
export type DetectView = (view: View) => Pose[];

/** The joints that make up the body; hands, feet and face details are too unsure to judge by. */
const MAIN: number[] = [
  LM.nose,
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
/**
 * Only a skeleton this close to where the gymnast is (image heights) counts as them. In a busy
 * hall the gymnast is sometimes missed, e.g. holding the start sign, and taking the nearest
 * skeleton anyway followed a spectator for a whole recording.
 */
const MAX_DISTANCE = 0.2;
/**
 * With a live pose in the frame, the skeleton's torso centre (which stays put when MediaPipe
 * flips a skeleton) must be this share of the gymnast's size from the live one. Running past
 * two girls squatting by the springboard, the view's only skeleton was one of them, 0.19–0.39
 * away; on the gymnast it was mostly ~0.01. The live torso length alone was no measure: it
 * collapses in some frames.
 */
const MAX_LIVE_DISTANCE = 0.15;
/** The view is this many times the gymnast's size, but at least `MIN_VIEW` image heights. */
const VIEW_SCALE = 1.8;
const MIN_VIEW = 0.3;
/** The gymnast's size is their median over this many recent frames: MediaPipe sometimes
 * collapses the skeleton onto part of the body for a frame. */
const SIZE_FRAMES = 5;
/** A result turned further than this from the view's angle is likely a flipped skeleton. */
const MAX_TURN = Math.PI / 3;
const MIN_VISIBILITY = 0.5;
/** A salto turns ~60° between two saved frames; faster than this is a misreading. */
const MAX_TURNING = Math.PI / 2;

function wrap(angle: number) {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** Direction from hips to shoulders in pixels: 0 upright, π upside down, positive clockwise. */
export function bodyAngle(pose: Pose, width: number, height: number): number {
  const shoulders = midpoint(pose[LM.leftShoulder], pose[LM.rightShoulder]);
  const hips = midpoint(pose[LM.leftHip], pose[LM.rightHip]);
  return Math.atan2((shoulders.x - hips.x) * width, -(shoulders.y - hips.y) * height);
}

/** Width or height of the main joints' box, whichever is larger, in pixels. */
function extent(pose: Pose, width: number, height: number) {
  const xs = MAIN.map((i) => pose[i].x * width);
  const ys = MAIN.map((i) => pose[i].y * height);
  return Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
}

function visibility(pose: Pose) {
  return MAIN.reduce((sum, i) => sum + (pose[i].visibility ?? 1), 0) / MAIN.length;
}

function centerPx(pose: Pose, width: number, height: number): Point {
  const center = torsoCenter(pose);
  return { x: center.x * width, y: center.y * height };
}

function nearest(poses: Pose[], center: Point, width: number, height: number, reach: number) {
  let best: Pose | null = null;
  let bestDistance = reach;
  for (const pose of poses) {
    const c = centerPx(pose, width, height);
    const d = Math.hypot(c.x - center.x, c.y - center.y);
    if (d < bestDistance) [best, bestDistance] = [pose, d];
  }
  return best;
}

/**
 * Follows the gymnast through saved frames, one direction at a time; call it again for the
 * other direction. Each frame's view is centred on the live tracking's torso centre (which stays
 * put when MediaPipe flips a skeleton), so it can't drift to someone else.
 */
export function createTracker(width: number, height: number) {
  // Gymnasts start (and end) upright.
  let angle = 0;
  let turning = 0;
  let center: Point | null = null;
  const sizes: number[] = [];

  /** @param tracked the live tracking's pose in this frame, if it had one */
  return function next(tracked: Pose | null, detect: DetectView): Pose | null {
    if (tracked) {
      center = centerPx(tracked, width, height);
      sizes.push(extent(tracked, width, height));
    }
    if (!center) return null;
    const recent = sizes.slice(-SIZE_FRAMES).sort((a, b) => a - b);
    const gymnastSize = recent[Math.floor(recent.length / 2)] ?? 0;
    const size = Math.max(VIEW_SCALE * gymnastSize, MIN_VIEW * height);
    const reach = tracked
      ? Math.min(MAX_DISTANCE * height, MAX_LIVE_DISTANCE * gymnastSize)
      : MAX_DISTANCE * height;
    const predicted = angle + turning;

    let best: { pose: Pose; score: number; upright: boolean } | null = null;
    // The predicted angle first; the others when MediaPipe saw no upright gymnast there.
    for (const turn of [0, Math.PI, Math.PI / 2, -Math.PI / 2]) {
      const viewAngle = predicted + turn;
      const pose = nearest(
        detect({ center, size, angle: viewAngle }),
        center,
        width,
        height,
        reach,
      );
      if (!pose) continue;
      const upright =
        Math.abs(wrap(bodyAngle(pose, width, height) - viewAngle)) < MAX_TURN &&
        visibility(pose) > MIN_VISIBILITY;
      const score = visibility(pose) + (upright ? 1 : 0);
      if (!best || score > best.score) best = { pose, score, upright };
      if (upright) break;
    }
    // Lost in the view, e.g. the angle went wrong: the whole frame, upright and turned.
    if (!best?.upright) {
      const whole = { x: width / 2, y: height / 2 };
      for (const viewAngle of [0, Math.PI]) {
        const view = { center: whole, size: Math.max(width, height), angle: viewAngle };
        const pose = nearest(detect(view), center, width, height, reach);
        if (pose && (!best || visibility(pose) > best.score)) {
          best = { pose, score: visibility(pose), upright: false };
        }
      }
    }
    if (!best) return null;

    const found = bodyAngle(best.pose, width, height);
    turning = Math.max(-MAX_TURNING, Math.min(MAX_TURNING, wrap(found - angle)));
    angle = found;
    center = centerPx(best.pose, width, height);
    if (!tracked) sizes.push(extent(best.pose, width, height));
    return best.pose;
  };
}

/**
 * Maps a point from MediaPipe's output (normalized to the turned view) back to frame pixels.
 * The view shows the frame turned by `-angle` around `center`, scaled to `size`.
 */
export function fromView(point: Point, view: View): Point {
  const x = (point.x - 0.5) * view.size;
  const y = (point.y - 0.5) * view.size;
  const cos = Math.cos(view.angle);
  const sin = Math.sin(view.angle);
  return { x: view.center.x + x * cos - y * sin, y: view.center.y + x * sin + y * cos };
}
