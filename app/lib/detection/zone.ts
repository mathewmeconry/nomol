import { LM, bodySize, higherAnkleY, hipCenter, type Point, type Pose } from './pose';

/**
 * Start zone drawn by the coach on the live image, in normalized image coordinates.
 * Its bottom edge is the floor line: the coach draws the zone down to where people stand.
 */
export type Zone = { left: number; top: number; right: number; bottom: number };

/**
 * Feet may be this far above the floor line (relative to body size) and still count as standing
 * on the floor. Leaves room for landing mats (~30 cm) without counting support on a bar.
 */
const FLOOR_TOLERANCE = 0.3;

export function isInZone(pose: Pose, zone: Zone): boolean {
  const hip = hipCenter(pose);
  return hip.x >= zone.left && hip.x <= zone.right && hip.y >= zone.top && hip.y <= zone.bottom;
}

/**
 * Standing on both legs keeps both knees clearly below the hips (≥ 0.13 body sizes in a phone
 * recording); a raised leg brings its knee up to hip height or above.
 */
const KNEES_BELOW_HIPS = 0.1;

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

export function zoneCenter(zone: Zone): Point {
  return { x: (zone.left + zone.right) / 2, y: (zone.top + zone.bottom) / 2 };
}

export function normalizeZone(a: Point, b: Point): Zone {
  return {
    left: Math.min(a.x, b.x),
    top: Math.min(a.y, b.y),
    right: Math.max(a.x, b.x),
    bottom: Math.max(a.y, b.y),
  };
}
