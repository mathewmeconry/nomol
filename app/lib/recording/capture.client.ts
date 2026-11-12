import type { Pose } from '~/lib/detection/pose';
import { traceBack } from '~/lib/detection/session';
import type { Zone } from '~/lib/detection/zone';
import { routineRange, type Clip, type ClipFrame, type RecordedWith } from '~/lib/recording/clip';
import { PREROLL_MAX_MS } from '~/lib/recording/preroll.client';
import type { Recording } from '~/lib/recording/recorder.client';
import { captureThumbnail } from '~/lib/recording/thumbnail.client';
import { captureFrame, frameSize, type SkeletonSample } from '~/lib/skeleton/refiner.client';
import { cropAround } from '~/lib/skeleton/rtmpose';

/**
 * The clip's thumbnail should come from the middle of the routine, whose timing isn't known
 * in advance, so candidate stills are grabbed this often and one is picked at the end.
 */
const STILL_EVERY_MS = 500;
/**
 * How often a frame is saved for the RTMPose skeleton. 10 per second look smooth with
 * interpolation and keep the computation after a recording short.
 */
const SAMPLE_EVERY_MS = 100;
/** The fallback crop covers the gymnast's poses over this long (see `cropAround`). */
const CROP_WINDOW_MS = 500;

/** Everything gathered while recording. Times in `frames`, `stills` and `samples` are video times. */
export type ActiveRecording = {
  recording: Recording;
  /** The video's time 0, in camera capture time. */
  startedAt: number;
  startedDate: Date;
  frames: ClipFrame[];
  stills: { time: number; url: string }[];
  samples: SkeletonSample[];
  zone: Zone;
  aspectRatio: number;
  recordedWith: RecordedWith;
};

/** Detection results kept for the pre-roll, so its part of the clip gets a skeleton too. */
export type Seen = { time: number; poses: Pose[]; image: Promise<Blob> | null };

let thumbnailCanvas: HTMLCanvasElement | null = null;

export function beginRecording(
  recording: Recording,
  startedAt: number,
  zone: Zone,
  aspectRatio: number,
  start: Omit<RecordedWith, 'appVersion'>,
): ActiveRecording {
  return {
    recording,
    startedAt,
    startedDate: new Date(),
    frames: [],
    stills: [],
    samples: [],
    zone,
    aspectRatio,
    recordedWith: { appVersion: __APP_VERSION__, ...start },
  };
}

/** The tracked person's pose, and every `SAMPLE_EVERY_MS` the frame for the skeleton. */
export function recordPose(
  active: ActiveRecording,
  video: HTMLVideoElement,
  time: number,
  pose: Pose,
) {
  const now = time - active.startedAt;
  active.frames.push({ time: now, pose });
  const last = active.samples.at(-1);
  if (last && now - last.time < SAMPLE_EVERY_MS) return;
  active.samples.push({
    time: now,
    image: captureFrame(video),
    tracked: pose,
    ...cropAt(active, video, now),
  });
}

export function recordStill(active: ActiveRecording, video: HTMLVideoElement, time: number) {
  const last = active.stills.at(-1);
  if (last && time - active.startedAt - last.time < STILL_EVERY_MS) return;
  thumbnailCanvas ??= document.createElement('canvas');
  active.stills.push({
    time: time - active.startedAt,
    url: captureThumbnail(video, thumbnailCanvas),
  });
}

/** While waiting for an automatic start: what was seen, and frames when someone is there. */
export function rememberFrame(
  seen: Seen[],
  video: HTMLVideoElement,
  time: number,
  poses: Pose[],
): Seen[] {
  const kept = seen.filter((frame) => time - frame.time <= PREROLL_MAX_MS);
  const lastImage = kept.filter((frame) => frame.image).at(-1);
  const image =
    poses.length > 0 && (!lastImage || time - lastImage.time >= SAMPLE_EVERY_MS)
      ? captureFrame(video)
      : null;
  return [...kept, { time, poses, image }];
}

/** Adds the gymnast's poses and skeleton frames from the pre-roll, before the trigger. */
export function addPreroll(
  active: ActiveRecording,
  seen: Seen[],
  video: HTMLVideoElement,
  pose: Pose,
  time: number,
) {
  const inVideo = seen.filter((frame) => frame.time >= active.startedAt);
  const traced = traceBack(inVideo, pose, time, active.aspectRatio);
  for (const frame of traced) {
    active.frames.push({ time: frame.time - active.startedAt, pose: frame.pose });
  }
  for (const frame of traced) {
    const image = inVideo.find((other) => other.time === frame.time)?.image;
    if (!image) continue;
    const now = frame.time - active.startedAt;
    active.samples.push({ time: now, image, tracked: frame.pose, ...cropAt(active, video, now) });
  }
}

/** The fallback crop for a skeleton frame at video time `now`. */
function cropAt(active: ActiveRecording, video: HTMLVideoElement, now: number) {
  const recent = active.frames.filter(
    (frame) => frame.time <= now && frame.time >= now - CROP_WINDOW_MS,
  );
  const { width, height } = frameSize(video);
  return {
    fallback: cropAround(
      recent.map((frame) => frame.pose),
      width,
      height,
    ),
  };
}

/** The finished clip, with its thumbnail from the middle of the routine. */
export function toClip(active: ActiveRecording, video: Blob, time: number) {
  const durationMs = time - active.startedAt;
  const routine = routineRange({ ...active, durationMs });
  const middle = (routine.startMs + routine.endMs) / 2;
  const still = active.stills.reduce<(typeof active.stills)[number] | null>(
    (best, candidate) =>
      !best || Math.abs(candidate.time - middle) < Math.abs(best.time - middle) ? candidate : best,
    null,
  );
  const clip: Clip = {
    id: crypto.randomUUID(),
    url: URL.createObjectURL(video),
    startedAt: active.startedDate,
    durationMs,
    frames: active.frames,
    skeleton: [],
    thumbnail: still?.url ?? null,
    zone: active.zone,
    aspectRatio: active.aspectRatio,
    recordedWith: active.recordedWith,
  };
  return { clip, routine };
}
