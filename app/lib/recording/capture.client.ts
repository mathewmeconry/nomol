import type { Pose } from '~/lib/detection/pose';
import { traceBack } from '~/lib/detection/session';
import type { Zone } from '~/lib/detection/zone';
import { routineRange, type Clip, type ClipFrame, type RecordedWith } from '~/lib/recording/clip';
import { PREROLL_MAX_MS } from '~/lib/recording/preroll.client';
import type { Recording } from '~/lib/recording/recorder.client';
import { captureThumbnail } from '~/lib/recording/thumbnail.client';
import { captureFrame, type SkeletonSample } from '~/lib/skeleton/refiner.client';

/**
 * The clip's thumbnail should come from the middle of the routine, whose timing isn't known
 * in advance, so candidate stills are grabbed this often and one is picked at the end.
 */
const STILL_EVERY_MS = 500;
/**
 * How often a frame is saved for the replay skeleton. 10 per second look smooth with
 * interpolation and keep the computation after a recording short.
 */
const SAMPLE_EVERY_MS = 100;

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
export function recordPose(active: ActiveRecording, frame: VideoFrame, time: number, pose: Pose) {
  const now = time - active.startedAt;
  active.frames.push({ time: now, pose });
  const last = active.samples.at(-1);
  if (last && now - last.time < SAMPLE_EVERY_MS) return;
  active.samples.push({ time: now, image: captureFrame(frame), tracked: pose });
}

export function recordStill(active: ActiveRecording, frame: VideoFrame, time: number) {
  const last = active.stills.at(-1);
  if (last && time - active.startedAt - last.time < STILL_EVERY_MS) return;
  thumbnailCanvas ??= document.createElement('canvas');
  active.stills.push({
    time: time - active.startedAt,
    url: captureThumbnail(frame, thumbnailCanvas),
  });
}

/** While waiting for an automatic start: what was seen, and frames when someone is there. */
export function rememberFrame(
  seen: Seen[],
  videoFrame: VideoFrame,
  time: number,
  poses: Pose[],
): Seen[] {
  const kept = seen.filter((frame) => time - frame.time <= PREROLL_MAX_MS);
  const lastImage = kept.filter((frame) => frame.image).at(-1);
  const image =
    poses.length > 0 && (!lastImage || time - lastImage.time >= SAMPLE_EVERY_MS)
      ? captureFrame(videoFrame)
      : null;
  return [...kept, { time, poses, image }];
}

/** Adds the gymnast's poses and skeleton frames from the pre-roll, before the trigger. */
export function addPreroll(
  active: ActiveRecording,
  seen: Seen[],
  pose: Pose,
  poses: Pose[],
  time: number,
) {
  const inVideo = seen.filter((frame) => frame.time >= active.startedAt);
  const { startReason, runUp } = active.recordedWith;
  const traced = traceBack(
    inVideo,
    pose,
    poses,
    time,
    active.aspectRatio,
    startReason === 'runUp' ? runUp : null,
  );
  for (const frame of traced) {
    active.frames.push({ time: frame.time - active.startedAt, pose: frame.pose });
  }
  for (const frame of traced) {
    const image = inVideo.find((other) => other.time === frame.time)?.image;
    if (!image) continue;
    active.samples.push({ time: frame.time - active.startedAt, image, tracked: frame.pose });
  }
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
