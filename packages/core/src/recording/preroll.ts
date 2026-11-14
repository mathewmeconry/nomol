import type { Pose } from '../detection/pose';
import { traceBack, type RunUp } from '../detection/session';

/**
 * An automatic start's clip begins up to this long before the trigger; detections older than
 * that aren't needed.
 */
export const PREROLL_MAX_MS = 3000;

/** A detection kept while waiting for an automatic start, with what was saved of its frame. */
export type Seen<T> = { time: number; poses: Pose[]; kept: T | null };

/**
 * The gymnast's poses before the trigger, from `videoStart` on, traced back from `pose` (see
 * `traceBack`), each with what was kept of its frame, so the pre-roll gets a skeleton too.
 */
export function tracePreroll<T>(
  seen: Seen<T>[],
  videoStart: number,
  pose: Pose,
  poses: Pose[],
  time: number,
  aspectRatio: number,
  runUp: RunUp | null,
): { time: number; pose: Pose; kept: T | null }[] {
  const inVideo = seen.filter((frame) => frame.time >= videoStart);
  return traceBack(inVideo, pose, poses, time, aspectRatio, runUp).map((frame) => ({
    ...frame,
    kept: inVideo.find((other) => other.time === frame.time)?.kept ?? null,
  }));
}
