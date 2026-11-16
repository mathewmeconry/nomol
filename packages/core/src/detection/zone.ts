import {
  LM,
  bodySize,
  distance,
  higherAnkleY,
  hipCenter,
  scalePose,
  torsoCenter,
  torsoLength,
  type Point,
  type Pose,
} from './pose';

/**
 * Start zone drawn by the coach on the live image, in normalized image coordinates.
 * Its bottom edge is the floor line: the coach draws the zone down to where people stand.
 */
export type Zone = { left: number; top: number; right: number; bottom: number };

/**
 * Feet may be this far above the floor line (relative to body size) and still count as standing
 * on the floor. Leaves room for landing mats (~30 cm) without counting support on a bar.
 */
export const FLOOR_TOLERANCE = 0.3;

export function isInZone(pose: Pose, zone: Zone): boolean {
  const hip = hipCenter(pose);
  return hip.x >= zone.left && hip.x <= zone.right && hip.y >= zone.top && hip.y <= zone.bottom;
}

/**
 * Standing on both legs keeps both knees clearly below the hips (≥ 0.13 body sizes in a phone
 * recording); a raised leg brings its knee up to hip height or above.
 */
export const KNEES_BELOW_HIPS = 0.1;

/**
 * Both feet on the floor. Hands don't count, so a handstand isn't standing. The knees check
 * catches a raised leg near a low camera, where its foot can look as low as the standing one.
 */
export function isOnFloor(pose: Pose, zone: Zone): boolean {
  const size = bodySize(pose);
  const higherKneeY = Math.min(pose[LM.leftKnee].y, pose[LM.rightKnee].y);
  return (
    higherKneeY - hipCenter(pose).y >= KNEES_BELOW_HIPS * size &&
    higherAnkleY(pose) >= zone.bottom - FLOOR_TOLERANCE * size
  );
}

/** See `scalePose`: same conversion of x into image-height units. */
export function scaleZone(zone: Zone, aspectRatio: number): Zone {
  return { ...zone, left: zone.left * aspectRatio, right: zone.right * aspectRatio };
}

/**
 * Share of the start zone's width and height added on each side of it for detection while
 * waiting for an automatic start, where the runner comes from.
 */
const RUN_UP_MARGIN = 0.25;

/**
 * At most this many start zones (on the floor track gymnasts start at either end). Waiting, each
 * costs a detection per frame (`detectionAreas`).
 */
export const MAX_ZONES = 2;

/** `mergeAreas`: torso centres closer than this many torso lengths are the same person. */
const SAME_POSE_TORSOS = 0.5;

/**
 * The parts of the picture detection looks at, each widened to a square. MediaPipe shrinks whatever
 * it gets to a 256 px square, so on a 16:9 picture someone far away was only a few pixels tall:
 * on the rings, a gymnast showing the sign at the back of the hall was found in 64 of 89 frames,
 * cropped to his zone in 88. A narrower area only adds letterboxing, hence the square.
 *
 * Waiting, each start zone (with a margin for an automatic start, `runUp`); recording, only
 * around the gymnast (`gymnast`, see `gymnastArea`). On the floor at the back of the hall with
 * the wide lens (gymnasts ~0.15 image heights tall, 9 clips, 5 frames per second), MediaPipe
 * found people in the zone 459 times given the zone, 94 times with the margin; while
 * recording, the zone plus everywhere the gymnast had been grew to the whole picture height
 * within seconds and lost them. Two zones at either end of the floor track would together span
 * the picture, hence one area each.
 */
export function detectionAreas(
  zones: Zone[],
  aspectRatio: number,
  gymnast: Zone | null,
  runUp: boolean,
): Zone[] {
  if (gymnast) return [square(gymnast, aspectRatio)];
  const margin = runUp ? RUN_UP_MARGIN : 0;
  return zones.map((zone) => {
    const marginX = (zone.right - zone.left) * margin;
    const marginY = (zone.bottom - zone.top) * margin;
    const around = {
      left: zone.left - marginX,
      top: zone.top - marginY,
      right: zone.right + marginX,
      bottom: zone.bottom + marginY,
    };
    return square(around, aspectRatio);
  });
}

/**
 * The poses found in each of `detectionAreas`, together. Someone where two areas overlap is
 * found in both, nearly the same; only the first of them is kept.
 */
export function mergeAreas(found: Pose[][], aspectRatio: number): Pose[] {
  const kept: Pose[] = [];
  for (const poses of found) {
    const earlier = kept.map((pose) => scalePose(pose, aspectRatio));
    for (const pose of poses) {
      const scaled = scalePose(pose, aspectRatio);
      const twice = earlier.some(
        (other) =>
          distance(torsoCenter(other), torsoCenter(scaled)) <
          SAME_POSE_TORSOS * Math.max(torsoLength(other), torsoLength(scaled)),
      );
      if (!twice) kept.push(pose);
    }
  }
  return kept;
}

/** `area` widened to a square (as far as the picture allows) and kept inside the picture. */
function square(area: Zone, aspectRatio: number): Zone {
  const box = scaleZone(area, aspectRatio);
  const height = Math.min(Math.max(box.bottom - box.top, box.right - box.left), 1);
  const width = Math.min(Math.max(box.right - box.left, height), aspectRatio);
  const left = clamp((box.left + box.right - width) / 2, 0, aspectRatio - width);
  const top = clamp((box.top + box.bottom - height) / 2, 0, 1 - height);
  return {
    left: left / aspectRatio,
    top,
    right: (left + width) / aspectRatio,
    bottom: top + height,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function zoneCenter(zone: Zone): Point {
  return { x: (zone.left + zone.right) / 2, y: (zone.top + zone.bottom) / 2 };
}

/**
 * Where a second zone starts out in the editor: `zone` mirrored left to right, a guess for the
 * other end of the floor track.
 */
export function secondZone(zone: Zone): Zone {
  return { ...zone, left: 1 - zone.right, right: 1 - zone.left };
}

export function normalizeZone(a: Point, b: Point): Zone {
  return {
    left: Math.min(a.x, b.x),
    top: Math.min(a.y, b.y),
    right: Math.max(a.x, b.x),
    bottom: Math.max(a.y, b.y),
  };
}
