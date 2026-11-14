import type { Point } from './detection/pose';
import type { Zone } from './detection/zone';

/** One loop of the start-sign animation: arms down, raise, hold crossed, lower. */
const SIGN_LOOP_MS = 3200;

/**
 * Elbow and wrist of the figure's right arm (x from the body's middle, y up from the feet, in
 * body heights). Crossed: elbows beside the head, forearms crossing near their middle above it.
 * The arms move straight between the two, in front of the body, so the figure stays narrow.
 */
const ARMS_DOWN = { elbow: { x: 0.14, y: 0.6 }, wrist: { x: 0.16, y: 0.36 } };
const ARMS_CROSSED = { elbow: { x: 0.13, y: 0.96 }, wrist: { x: -0.1, y: 1.1 } };

/** How far the arms are raised (0 down, 1 crossed) at `timeMs`, eased. */
function raised(timeMs: number) {
  const t = timeMs % SIGN_LOOP_MS;
  const u = t < 600 ? 0 : t < 1300 ? (t - 600) / 700 : t < 2800 ? 1 : 1 - (t - 2800) / 400;
  return u * u * (3 - 2 * u);
}

export interface StartFigure {
  /** Polylines in pixels: legs, body, shoulders, both arms. */
  strokes: Point[][];
  head: Point & { radius: number };
  lineWidth: number;
}

/**
 * Faint stick figure standing in the middle of the start zone, showing the start sign: arms
 * raised until the forearms cross in an X just above the head. Pixels of a `w`×`h` picture;
 * null when the zone is too small to show it.
 */
export function startFigure(zone: Zone, w: number, h: number, timeMs: number): StartFigure | null {
  const zoneWidth = (zone.right - zone.left) * w;
  const zoneHeight = (zone.bottom - zone.top) * h;
  // Height of the body; raised arms add ~12 % on top, the figure is never wider than ~0.35×.
  const size = Math.min((zoneHeight * 0.92) / 1.12, (zoneWidth * 0.9) / 0.35);
  if (size < 30) return null;
  const centerX = ((zone.left + zone.right) / 2) * w;
  const feetY = zone.bottom * h - zoneHeight * 0.02;
  const at = (dx: number, dy: number): Point => ({ x: centerX + dx * size, y: feetY - dy * size });

  const u = raised(timeMs);
  const between = (from: number, to: number) => from + (to - from) * u;
  /** Shoulder → elbow → wrist; `side` 1 for the image right, -1 mirrors it. */
  function arm(side: 1 | -1): Point[] {
    const { elbow: down, wrist: downWrist } = ARMS_DOWN;
    const { elbow: up, wrist: upWrist } = ARMS_CROSSED;
    return [
      at(0.11 * side, 0.78),
      at(between(down.x, up.x) * side, between(down.y, up.y)),
      at(between(downWrist.x, upWrist.x) * side, between(downWrist.y, upWrist.y)),
    ];
  }

  return {
    strokes: [
      [at(-0.1, 0), at(-0.06, 0.25), at(0, 0.48), at(0.06, 0.25), at(0.1, 0)], // legs
      [at(0, 0.48), at(0, 0.8)], // body
      [at(-0.11, 0.78), at(0.11, 0.78)], // shoulders
      arm(1),
      arm(-1),
    ],
    head: { ...at(0, 0.88), radius: size * 0.07 },
    lineWidth: Math.max(2, size * 0.018),
  };
}
