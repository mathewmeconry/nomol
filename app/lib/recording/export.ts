import type { Clip } from './clip';

/** Bump when the JSON layout changes, so old exports can still be read correctly. */
const EXPORT_VERSION = 1;

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
    startedAt: clip.startedAt.toISOString(),
    durationMs: clip.durationMs,
    aspectRatio: clip.aspectRatio,
    zone: clip.zone,
    userAgent,
    frames: clip.frames,
  };
}
