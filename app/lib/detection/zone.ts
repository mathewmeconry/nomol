import { bodySize, hipCenter, lowestAnkleY, type Point, type Pose } from './pose';

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

export function isOnFloor(pose: Pose, zone: Zone): boolean {
  return lowestAnkleY(pose) >= zone.bottom - FLOOR_TOLERANCE * bodySize(pose);
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
