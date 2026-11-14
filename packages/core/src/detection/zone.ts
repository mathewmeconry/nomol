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

/**
 * Share of the start zone's width and height added on each side of it for detection while
 * waiting for an automatic start, where the runner comes from.
 */
const RUN_UP_MARGIN = 0.25;

/**
 * The part of the picture detection looks at, widened to a square. MediaPipe shrinks whatever
 * it gets to a 256 px square, so on a 16:9 picture someone far away was only a few pixels tall:
 * on the rings, a gymnast showing the sign at the back of the hall was found in 64 of 89 frames,
 * cropped to his zone in 88. A narrower area only adds letterboxing, hence the square.
 *
 * Waiting, the start zone (with a margin for an automatic start, `runUp`); recording, only
 * around the gymnast (`gymnast`, see `coverPose`). On the floor at the back of the hall with
 * the wide lens (gymnasts ~0.15 image heights tall, 9 clips, 5 frames per second), MediaPipe
 * found people in the zone 459 times given the zone, 94 times with the margin; while
 * recording, the zone plus everywhere the gymnast had been grew to the whole picture height
 * within seconds and lost them.
 */
export function detectionArea(
  zone: Zone,
  aspectRatio: number,
  gymnast: Zone | null,
  runUp: boolean,
): Zone {
  const margin = runUp ? RUN_UP_MARGIN : 0;
  const marginX = (zone.right - zone.left) * margin;
  const marginY = (zone.bottom - zone.top) * margin;
  const box = scaleZone(
    gymnast ?? {
      left: zone.left - marginX,
      top: zone.top - marginY,
      right: zone.right + marginX,
      bottom: zone.bottom + marginY,
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
 * `pose` and its own size around it on every side, where detection looks for the gymnast in the
 * next frame: going into a salto the torso moved 0.32 between two frames. In all 161 clips of a
 * day in the hall (Sprung, floor, rings), the next sighting's torso was outside this in 28 of
 * 11 232 steps.
 */
export function coverPose(pose: Pose): Zone {
  const box = boundingBox(pose);
  const room = Math.max(box.right - box.left, box.bottom - box.top);
  return {
    left: box.left - room,
    top: box.top - room,
    right: box.right + room,
    bottom: box.bottom + room,
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
