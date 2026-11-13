import { LM, bodySize, boundingBox, higherAnkleY, hipCenter, type Point, type Pose } from './pose';

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

/** Share of the start zone's width and height added on each side of it for detection. */
const AREA_MARGIN = 0.25;

/**
 * The part of the picture detection looks at: the start zone with a margin and `include` (where
 * the recorded gymnast has been), widened to a square. MediaPipe shrinks whatever it gets to a
 * 256 px square, so on a 16:9 picture someone far away was only a few pixels tall: on the rings,
 * a gymnast showing the sign at the back of the hall was found in 64 of 89 frames, cropped to
 * his zone in 88. A narrower area only adds letterboxing, hence the square.
 */
export function detectionArea(zone: Zone, aspectRatio: number, include: Zone | null): Zone {
  const marginX = (zone.right - zone.left) * AREA_MARGIN;
  const marginY = (zone.bottom - zone.top) * AREA_MARGIN;
  const box = scaleZone(
    {
      left: Math.min(zone.left - marginX, include?.left ?? 1),
      top: Math.min(zone.top - marginY, include?.top ?? 1),
      right: Math.max(zone.right + marginX, include?.right ?? 0),
      bottom: Math.max(zone.bottom + marginY, include?.bottom ?? 0),
    },
    aspectRatio,
  );
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

/**
 * `area` grown to cover `pose` and its own size around it on every side, so detection keeps
 * finding a gymnast moving away from the start zone: going into a salto the torso moved 0.32
 * between two frames.
 */
export function coverPose(area: Zone | null, pose: Pose): Zone {
  const box = boundingBox(pose);
  const room = Math.max(box.right - box.left, box.bottom - box.top);
  return {
    left: Math.min(box.left - room, area?.left ?? 1),
    top: Math.min(box.top - room, area?.top ?? 1),
    right: Math.max(box.right + room, area?.right ?? 0),
    bottom: Math.max(box.bottom + room, area?.bottom ?? 0),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
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
