import type { Point } from '~/lib/detection/pose';

/** Zoom of the replay: scale, then offset in CSS pixels of the frame (origin top left). */
export type View = { scale: number; x: number; y: number };

export const FULL_VIEW: View = { scale: 1, x: 0, y: 0 };
const MAX_SCALE = 6;

/**
 * Zooms by `factor` and moves the point that was under `from` to `to`, so the picture follows
 * the fingers of a pinch (or a single finger for panning). The picture always fills the frame.
 */
export function zoomView(
  view: View,
  factor: number,
  from: Point,
  to: Point,
  width: number,
  height: number,
): View {
  const scale = Math.min(Math.max(view.scale * factor, 1), MAX_SCALE);
  const ratio = scale / view.scale;
  return {
    scale,
    x: clamp(to.x - (from.x - view.x) * ratio, width * (1 - scale), 0),
    y: clamp(to.y - (from.y - view.y) * ratio, height * (1 - scale), 0),
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}
