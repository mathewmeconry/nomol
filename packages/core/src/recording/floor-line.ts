import {
  LM,
  bodySize,
  distance,
  higherAnkleY,
  hipCenter,
  scalePose,
  torsoCenter,
  torsoLength,
  type Pose,
} from '../detection/pose';
import { FLOOR_TOLERANCE, KNEES_BELOW_HIPS, type Zone } from '../detection/zone';
import type { Clip } from './clip';

/**
 * Where a recorded gymnast stood after their last element, when that was clearly above the start
 * zone's bottom edge: the floor line was drawn too low and they never counted as standing. At
 * Sprung the line drawn at the landing mat's front edge, where nobody stands, kept recordings
 * running until the next gymnast landed in the same clip.
 */
export type FloorHint = { feet: number; size: number };

/**
 * Not upright this long is an element. Strides measured up to ~130 ms; requiring visible knees
 * instead dropped most Sprung flights, which are blurred.
 */
const ELEMENT_MS = 300;
/** Standing still this long counts as standing after the element, not passing through. */
const STILL_MS = 1000;
/** Standing still: the torso centre stays within this many torso lengths. */
const STILL_TORSOS = 1;
/** Shoulders at least this many torso lengths above the hips: upright, not lying or upside down. */
const UPRIGHT_TORSOS = 0.4;
/**
 * Only someone about the gymnast's size at the start: in a busy hall the tracked pose sometimes
 * ends on someone further back (the next apparatus, people waiting), whose feet are higher in
 * the picture. On 282 exports this refused 8 such hints and kept the right ones.
 */
const MAX_SIZE_CHANGE = 1.5;
/** Recent hints per zone that a new one is compared with. */
const MAX_HINTS = 5;

function isUpright(pose: Pose): boolean {
  const hip = hipCenter(pose);
  const shoulderY = (pose[LM.leftShoulder].y + pose[LM.rightShoulder].y) / 2;
  const higherKneeY = Math.min(pose[LM.leftKnee].y, pose[LM.rightKnee].y);
  return (
    higherKneeY - hip.y >= KNEES_BELOW_HIPS * bodySize(pose) &&
    hip.y - shoulderY >= UPRIGHT_TORSOS * torsoLength(pose)
  );
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/**
 * Where the first element ends: not upright for `ELEMENT_MS` in a row. A single frame is too
 * little: a stride while walking away, or a misdetection, made a waiting gymnast's standing
 * look like a landing.
 */
function elementEnd(poses: { time: number; pose: Pose }[]): number {
  let from = -1;
  for (let i = 0; i < poses.length; i++) {
    if (isUpright(poses[i].pose)) {
      from = -1;
      continue;
    }
    if (from < 0) from = i;
    if (poses[i].time - poses[from].time >= ELEMENT_MS) return i;
  }
  return -1;
}

/** See `FloorHint`; null when the gymnast stood on the floor line or never stood still. */
export function floorHint(clip: Pick<Clip, 'frames' | 'zone' | 'aspectRatio'>): FloorHint | null {
  const poses = clip.frames.map((frame) => ({
    time: frame.time,
    pose: scalePose(frame.pose, clip.aspectRatio),
  }));
  const firstElement = elementEnd(poses);
  if (firstElement < 0) return null;

  // The last stretch of standing still after an element.
  let from = -1;
  let stood: Pose[] | null = null;
  for (let i = firstElement; i < poses.length; i++) {
    const { time, pose } = poses[i];
    if (!isUpright(pose)) {
      from = -1;
      continue;
    }
    const start = poses[from]?.pose;
    if (
      !start ||
      distance(torsoCenter(pose), torsoCenter(start)) > STILL_TORSOS * torsoLength(start)
    ) {
      from = i;
    }
    if (time - poses[from].time >= STILL_MS) {
      stood = poses.slice(from, i + 1).map((p) => p.pose);
    }
  }
  if (!stood) return null;

  const feet = median(stood.map(higherAnkleY));
  const size = median(stood.map(bodySize));
  const startSize = median(poses.slice(0, 5).map(({ pose }) => bodySize(pose)));
  if (size > startSize * MAX_SIZE_CHANGE || size < startSize / MAX_SIZE_CHANGE) return null;
  return feet < clip.zone.bottom - FLOOR_TOLERANCE * size ? { feet, size } : null;
}

/**
 * Adds a zone's new hint to its recent ones. Two that agree (within the floor tolerance) move
 * the floor line up to the lower of them; one alone may be someone standing on a box or further
 * back. Only ever up: feet below the line count as standing anyway.
 */
export function learnFloorLine(
  hints: FloorHint[],
  hint: FloorHint,
  bottom: number,
): { hints: FloorHint[]; bottom: number } {
  const match = hints.find(
    (earlier) => Math.abs(earlier.feet - hint.feet) <= FLOOR_TOLERANCE * hint.size,
  );
  return {
    hints: [...hints, hint].slice(-MAX_HINTS),
    bottom: match ? Math.min(bottom, Math.max(match.feet, hint.feet)) : bottom,
  };
}

/**
 * After a recording: the floor line of `zone`, the start zone the clip began in (one of
 * `zones`), learned from the clip. `hints` are each zone's recent hints. `zones` is null when
 * nothing moved.
 */
export function learnFloor(
  zones: Zone[],
  zone: Zone,
  clip: Pick<Clip, 'frames' | 'zone' | 'aspectRatio'>,
  hints: FloorHint[][],
): { zones: Zone[] | null; hints: FloorHint[][] } {
  const index = zones.indexOf(zone);
  const hint = index >= 0 && floorHint(clip);
  if (!hint) return { zones: null, hints };
  const learned = learnFloorLine(hints[index] ?? [], hint, zone.bottom);
  return {
    zones:
      learned.bottom === zone.bottom
        ? null
        : zones.map((other) => (other === zone ? { ...zone, bottom: learned.bottom } : other)),
    hints: zones.map((_zone, i) => (i === index ? learned.hints : (hints[i] ?? []))),
  };
}
