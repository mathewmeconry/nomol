import type { Pose } from '~/lib/detection/pose';

/** Body points of the recorded person at a time (ms since the recording started). */
export type ClipFrame = { time: number; pose: Pose };

export type Clip = {
  id: string;
  url: string;
  /** Wall-clock time the recording started. */
  startedAt: Date;
  /** Measured by us: MediaRecorder WebM files often report an unknown duration. */
  durationMs: number;
  frames: ClipFrame[];
};

/** Frame closest to `time`. Frames are in chronological order. */
export function frameAt(frames: ClipFrame[], time: number): ClipFrame | null {
  if (frames.length === 0) return null;
  let low = 0;
  let high = frames.length - 1;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (frames[mid].time < time) low = mid + 1;
    else high = mid;
  }
  const after = frames[low];
  const before = frames[low - 1];
  return before && time - before.time < after.time - time ? before : after;
}
