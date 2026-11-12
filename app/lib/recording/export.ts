import type { Clip } from './clip';

/**
 * Bump when the JSON layout changes, so old exports can still be read correctly.
 * 2: adds `skeleton` (RTMPose, the replay skeleton) next to `frames` (MediaPipe, live).
 * 3: adds `appVersion`, `startReason` and `runUp` (null for clips recorded before version 3).
 */
const EXPORT_VERSION = 3;

/** e.g. "nomol-2026-11-10_17-45-02", in local time like the clip list. */
export function exportBaseName(startedAt: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const date = `${startedAt.getFullYear()}-${pad(startedAt.getMonth() + 1)}-${pad(startedAt.getDate())}`;
  const time = `${pad(startedAt.getHours())}-${pad(startedAt.getMinutes())}-${pad(startedAt.getSeconds())}`;
  return `nomol-${date}_${time}`;
}

/** Everything needed to replay the detection on the video later, without the video itself. */
export function exportData(clip: Clip, userAgent: string) {
  return {
    version: EXPORT_VERSION,
    appVersion: clip.recordedWith?.appVersion ?? null,
    startReason: clip.recordedWith?.startReason ?? null,
    runUp: clip.recordedWith?.runUp ?? null,
    startedAt: clip.startedAt.toISOString(),
    durationMs: clip.durationMs,
    aspectRatio: clip.aspectRatio,
    zone: clip.zone,
    userAgent,
    frames: clip.frames,
    skeleton: clip.skeleton,
  };
}
