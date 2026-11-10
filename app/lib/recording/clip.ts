import type { Pose } from '~/lib/detection/pose';

/** Body points of the recorded person at a time (ms since the recording started). */
export type ClipFrame = { time: number; pose: Pose };

/** Small still image for the timeline, as a data URL. */
export type Thumbnail = { time: number; url: string };

export type Clip = {
  id: string;
  url: string;
  /** Wall-clock time the recording started. */
  startedAt: Date;
  /** Measured by us: MediaRecorder WebM files often report an unknown duration. */
  durationMs: number;
  frames: ClipFrame[];
  thumbnails: Thumbnail[];
};

/** Fallback when a clip has too few frames to measure the camera's frame rate. */
const DEFAULT_FRAME_MS = 1000 / 30;

/** Entry closest to `time`. Entries are in chronological order. */
export function frameAt<T extends { time: number }>(frames: T[], time: number): T | null {
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

/**
 * Duration of one camera frame, measured from the detection frames of the clip. Uses the median
 * gap: frames where the gymnast wasn't detected leave longer gaps that would skew an average.
 */
export function frameDuration(clip: Clip): number {
  const { frames } = clip;
  if (frames.length < 2) return DEFAULT_FRAME_MS;
  const gaps = frames
    .slice(1)
    .map((frame, i) => frame.time - frames[i].time)
    .sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)];
}

/** `count` thumbnails evenly spread over the clip, one per timeline slot. */
export function timelineThumbnails(clip: Clip, count: number): Thumbnail[] {
  const slot = clip.durationMs / count;
  return Array.from({ length: count }, (_, i) => frameAt(clip.thumbnails, (i + 0.5) * slot)).filter(
    (thumbnail): thumbnail is Thumbnail => thumbnail !== null,
  );
}
