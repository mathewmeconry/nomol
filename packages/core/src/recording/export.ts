import z from 'zod';
import { zoneSchema } from '../settings';
import type { Clip } from './clip';

/**
 * Bump when the JSON layout changes, so old exports can still be read correctly.
 * 2: adds `skeleton` (the replay skeleton) next to `frames` (MediaPipe, live). Until
 * November 2026 RTMPose computed it, since then MediaPipe on turned frames (see `appVersion`).
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

const frameSchema = z.object({
  time: z.number(),
  pose: z.array(z.object({ x: z.number(), y: z.number(), visibility: z.number().optional() })),
});

const exportSchema = z.object({
  version: z.literal(EXPORT_VERSION),
  appVersion: z.string().nullable(),
  startReason: z.enum(['sign', 'button', 'runUp']).nullable(),
  runUp: z.enum(['left', 'right', 'any']).nullable(),
  startedAt: z.iso.datetime(),
  durationMs: z.number().nonnegative(),
  aspectRatio: z.number().positive(),
  zone: zoneSchema,
  frames: z.array(frameSchema),
  skeleton: z.array(frameSchema),
});

/**
 * Reads back what `exportData` wrote (the current version only); the Android app stores its
 * clips this way. Null if it isn't such an export.
 */
export function parseExport(raw: unknown): Omit<Clip, 'id' | 'url' | 'thumbnail'> | null {
  const result = exportSchema.safeParse(raw);
  if (!result.success) return null;
  const { version: _version, appVersion, startReason, runUp, startedAt, ...data } = result.data;
  return {
    ...data,
    startedAt: new Date(startedAt),
    recordedWith:
      appVersion !== null && startReason !== null ? { appVersion, startReason, runUp } : undefined,
  };
}
