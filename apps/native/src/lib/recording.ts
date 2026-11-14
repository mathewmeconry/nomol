import type { Pose } from '@nomol/core/detection/pose';
import type { Zone } from '@nomol/core/detection/zone';
import {
  routineRange,
  type Clip,
  type ClipFrame,
  type RecordedWith,
} from '@nomol/core/recording/clip';
import { createCameraClock } from '@nomol/native-modules';
import { File } from 'expo-file-system';
import type { CameraVideoOutput, Recorder } from 'react-native-vision-camera';
import { APP_VERSION } from './app-version';
import { filePath, newClipFolder, saveClip, type ClipFolder, type Sample } from './clip-store';

/** The camera clock can't be off by more; beyond it the phone stamps frames with another clock. */
const MAX_CLOCK_SKEW_MS = 1000;

let clock: ReturnType<typeof createCameraClock> | null = null;

/** Everything gathered while recording. Times are camera times until the clip is made. */
export type ActiveRecording = {
  folder: ClipFolder;
  startedDate: Date;
  recorder: Promise<Recorder>;
  /**
   * Camera time of the video's first frame. CameraX's encoder drops frames from before it
   * started, and reports the start right after; the camera clock at that report is the video's
   * time 0 within about a frame (the report's delay against the wait for the next frame).
   */
  started: Promise<number>;
  /** Resolves once the recorder has finished writing the video. */
  finished: Promise<void>;
  frames: ClipFrame[];
  samples: Sample[];
  zone: Zone;
  aspectRatio: number;
  recordedWith: RecordedWith;
};

/**
 * The camera clock now; the last detected frame's time if the phone stamps frames with
 * another clock (Android lets cameras use time since boot with or without deep sleep).
 */
function cameraNow(lastFrameTime: number) {
  clock ??= createCameraClock();
  const now = clock.now();
  return Math.abs(now - lastFrameTime) < MAX_CLOCK_SKEW_MS ? now : lastFrameTime;
}

export function startRecording(
  videoOutput: CameraVideoOutput,
  lastFrameTime: () => number,
  zone: Zone,
  aspectRatio: number,
  start: Omit<RecordedWith, 'appVersion'>,
): ActiveRecording {
  const startedDate = new Date();
  const folder = newClipFolder(startedDate);
  let onFinished = () => {};
  let onError = (_error: Error) => {};
  const finished = new Promise<void>((resolve, reject) => {
    onFinished = resolve;
    onError = reject;
  });
  const recorder = videoOutput.createRecorder({ filePath: filePath(folder.video) });
  const started = recorder.then(async (created) => {
    await created.startRecording(() => onFinished(), onError);
    return cameraNow(lastFrameTime());
  });
  // Errors surface when the recording is finished.
  finished.catch(() => {});
  started.catch(() => {});
  return {
    folder,
    startedDate,
    recorder,
    started,
    finished,
    frames: [],
    samples: [],
    zone,
    aspectRatio,
    recordedWith: { appVersion: APP_VERSION, ...start },
  };
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
  if (still) {
    active.samples.push({ time, file: still.split('/').at(-1) ?? still, tracked: pose });
  }
}

/**
 * Stops the recorder and stores the clip, with its thumbnail from the middle of the routine.
 * On failure the folder is removed and the error rethrown.
 */
export async function finishRecording(
  active: ActiveRecording,
  lastFrameTime: number,
): Promise<Clip> {
  try {
    const startedAt = await active.started;
    const recorder = await active.recorder;
    // The video runs until the recorder stops, later than the last detected frame.
    const endedAt = cameraNow(lastFrameTime);
    await recorder.stopRecording();
    await active.finished;

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
