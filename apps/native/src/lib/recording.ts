import type { Pose } from '@nomol/core/detection/pose';
import type { Zone } from '@nomol/core/detection/zone';
import {
  routineRange,
  type Clip,
  type ClipFrame,
  type RecordedWith,
} from '@nomol/core/recording/clip';
import { PREROLL_MAX_MS, tracePreroll, type Seen } from '@nomol/core/recording/preroll';
import type { ClipRecorder } from '@nomol/native-modules';
import { Directory, File, Paths } from 'expo-file-system';
import { APP_VERSION } from './app-version';
import { filePath, newClipFolder, saveClip, type ClipFolder, type Sample } from './clip-store';

/**
 * An automatic start's video begins at the last keyframe (every 0.5 s) at least this long before
 * the trigger: 1.5–2 s before it, within the 1.5–3 s the web app keeps.
 */
const PREROLL_MS = 1500;

/** Stills saved while waiting for an automatic start; those of the runner move into the clip. */
const PREROLL_STILLS = new Directory(Paths.cache, 'preroll');

/** Everything gathered while recording. Times are camera times until the clip is made. */
export type ActiveRecording = {
  recorder: ClipRecorder;
  folder: ClipFolder;
  startedDate: Date;
  /** Camera time of the video's first frame, its time 0. */
  started: Promise<number>;
  frames: ClipFrame[];
  samples: Sample[];
  zone: Zone;
  aspectRatio: number;
  recordedWith: RecordedWith;
};

/**
 * Starts a clip at the frame detected at `time`. An automatic start's video begins before it,
 * from the frames `recorder` kept while buffering.
 */
export function startRecording(
  recorder: ClipRecorder,
  time: number,
  zone: Zone,
  aspectRatio: number,
  start: Omit<RecordedWith, 'appVersion'>,
): ActiveRecording {
  const startedDate = new Date();
  const folder = newClipFolder(startedDate);
  const from = start.startReason === 'runUp' ? time - PREROLL_MS : time;
  const started = recorder.start(filePath(folder.video), from);
  // Errors surface when the recording is finished.
  started.catch(() => {});
  return {
    recorder,
    folder,
    startedDate,
    started,
    frames: [],
    samples: [],
    zone,
    aspectRatio,
    recordedWith: { appVersion: APP_VERSION, ...start },
  };
}

/** Where the frame worklet saves stills while waiting for an automatic start; emptied. */
export function prerollStillsPath() {
  if (PREROLL_STILLS.exists) PREROLL_STILLS.delete();
  PREROLL_STILLS.create({ intermediates: true });
  return filePath(PREROLL_STILLS);
}

/** Keeps the detections of the last `PREROLL_MAX_MS`, deleting the stills that fall out. */
export function rememberFrame(
  seen: Seen<string>[],
  time: number,
  poses: Pose[],
  still: string | null,
): Seen<string>[] {
  const recent: Seen<string>[] = [];
  for (const frame of seen) {
    if (time - frame.time <= PREROLL_MAX_MS) recent.push(frame);
    else if (frame.kept) deleteStill(frame.kept);
  }
  return [...recent, { time, poses, kept: still && fileName(still) }];
}

function deleteStill(name: string) {
  try {
    new File(PREROLL_STILLS, name).delete();
  } catch (_error) {
    // Written in the background; one not there yet goes with the folder later.
  }
}

/**
 * Adds the runner's poses before the trigger, and their stills for the replay skeleton. The
 * video's start isn't known yet; `finishRecording` drops poses from before it.
 */
export function addPreroll(
  active: ActiveRecording,
  seen: Seen<string>[],
  pose: Pose,
  poses: Pose[],
  time: number,
) {
  const traced = tracePreroll(
    seen,
    -Infinity,
    pose,
    poses,
    time,
    active.aspectRatio,
    active.recordedWith.runUp,
  );
  active.folder.stills.create({ intermediates: true, idempotent: true });
  for (const frame of traced) {
    active.frames.push({ time: frame.time, pose: frame.pose });
    if (!frame.kept) continue;
    try {
      new File(PREROLL_STILLS, frame.kept).move(active.folder.stills);
      active.samples.push({ time: frame.time, file: frame.kept, tracked: frame.pose });
    } catch (_error) {
      // Not written yet; the skeleton interpolates over the gap.
    }
  }
}

function fileName(path: string) {
  return path.split('/').at(-1) ?? path;
}

/** Where the frame worklet saves stills (`usePoseDetection`). */
export function stillsPath(active: ActiveRecording) {
  return filePath(active.folder.stills);
}

/**
 * The tracked person's pose, and the still saved with the frame if there is one. Stills from
 * frames without the gymnast are kept too: the skeleton may still find them there.
 */
export function recordFrame(
  active: ActiveRecording,
  time: number,
  pose: Pose | null,
  still: string | null,
) {
  if (pose) active.frames.push({ time, pose });
  // Frames detected around the start may have saved theirs for the pre-roll instead.
  if (still?.startsWith(stillsPath(active))) {
    active.samples.push({ time, file: fileName(still), tracked: pose });
  }
}

/**
 * Stops the recorder and stores the clip, with its thumbnail from the middle of the routine.
 * On failure the folder is removed and the error rethrown.
 */
export async function finishRecording(active: ActiveRecording): Promise<Clip> {
  try {
    // Stopped first: a clip that never got a frame rejects `started` then.
    const endedAt = await active.recorder.stop();
    const startedAt = await active.started;

    const relative = <T extends { time: number }>(item: T) => ({
      ...item,
      time: item.time - startedAt,
    });
    const frames = active.frames.filter((frame) => frame.time >= startedAt).map(relative);
    // Before time 0 too: the skeleton of the first moments may still use them.
    const samples = active.samples.map(relative);
    const durationMs = Math.max(0, endedAt - startedAt);
    const routine = routineRange({ ...active, frames, durationMs });
    const middle = (routine.startMs + routine.endMs) / 2;
    const still = samples.reduce<Sample | null>(
      (best, sample) =>
        !best || Math.abs(sample.time - middle) < Math.abs(best.time - middle) ? sample : best,
      null,
    );
    const { folder } = active;
    let thumbnail: string | null = null;
    if (still) {
      try {
        new File(folder.stills, still.file).copy(folder.thumbnail);
        thumbnail = folder.thumbnail.uri;
      } catch (_error) {
        // Written in the background; a still not there yet only costs the thumbnail.
      }
    }

    const clip: Clip = {
      id: folder.id,
      url: folder.video.uri,
      startedAt: active.startedDate,
      durationMs,
      frames,
      skeleton: [],
      thumbnail,
      zone: active.zone,
      aspectRatio: active.aspectRatio,
      recordedWith: active.recordedWith,
    };
    await saveClip(folder, clip, samples);
    return clip;
  } catch (error) {
    if (active.folder.dir.exists) active.folder.dir.delete();
    throw error;
  }
}
