import { scalePose, type Pose } from '~/lib/detection/pose';
import { isOnFloor, scaleZone, type Zone } from '~/lib/detection/zone';

/** Body points of the recorded person at a time (ms since the recording started). */
export type ClipFrame = { time: number; pose: Pose };

export type Clip = {
  id: string;
  url: string;
  /** Wall-clock time the recording started. */
  startedAt: Date;
  /** Measured by us: MediaRecorder WebM files often report an unknown duration. */
  durationMs: number;
  /** MediaPipe's live tracking of the gymnast: drives start, stop and trimming. */
  frames: ClipFrame[];
  /**
   * The replay skeleton, computed by RTMPose after recording (better upside down). Filled in
   * while it's being computed, so it may cover only part of the clip; sorted by time.
   */
  skeleton: ClipFrame[];
  /** Still from the middle of the routine, as a data URL, for the clip list. */
  thumbnail: string | null;
  /** Start zone and camera aspect ratio at recording time, so exports can be replayed. */
  zone: Zone;
  aspectRatio: number;
};

/** Shown before the first element, e.g. the run-up. */
const ROUTINE_LEAD_MS = 1500;
/** Shown after the last element: the landing and standing up. */
const ROUTINE_TAIL_MS = 2000;

/**
 * The part of a clip worth replaying: from shortly before the first element to shortly after the
 * last one, an element being any moment not standing on both feet. Cuts the wait before the
 * routine and the idle time or walking away after it; breaks in between stay. The whole clip if
 * no element was recognized (e.g. the floor line is drawn too low).
 */
export function routineRange(clip: Pick<Clip, 'frames' | 'zone' | 'aspectRatio' | 'durationMs'>): {
  startMs: number;
  endMs: number;
} {
  const zone = scaleZone(clip.zone, clip.aspectRatio);
  const elements = clip.frames.filter(
    (frame) => !isOnFloor(scalePose(frame.pose, clip.aspectRatio), zone),
  );
  const first = elements[0];
  const last = elements[elements.length - 1];
  if (!first || !last) return { startMs: 0, endMs: clip.durationMs };
  return {
    startMs: Math.max(0, first.time - ROUTINE_LEAD_MS),
    endMs: Math.min(clip.durationMs, last.time + ROUTINE_TAIL_MS),
  };
}

/** Fallback when a clip has too few frames to measure the camera's frame rate. */
const DEFAULT_FRAME_MS = 1000 / 30;

/** Longer gaps mean the gymnast wasn't detected in between; don't invent poses across them. */
const MAX_INTERPOLATION_GAP_MS = 200;

/** Index of the first frame at or after `time` (frames.length if none). */
function firstFrameFrom(frames: ClipFrame[], time: number) {
  let low = 0;
  let high = frames.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (frames[mid].time < time) low = mid + 1;
    else high = mid;
  }
  return low;
}

/**
 * Pose at `time`, interpolated between the neighbouring frames. Detection runs slower than the
 * video, so taking the nearest frame visibly lags behind fast movements. Frames are in
 * chronological order. Null where no frame is near, e.g. parts of the skeleton not computed yet:
 * better no skeleton than one from another moment.
 */
export function poseAt(frames: ClipFrame[], time: number): Pose | null {
  const index = firstFrameFrom(frames, time);
  const after = frames[index] as ClipFrame | undefined;
  const before = frames[index - 1] as ClipFrame | undefined;
  if (!before || !after || after.time - before.time > MAX_INTERPOLATION_GAP_MS) {
    const nearest = [before, after]
      .filter((frame) => frame !== undefined)
      .reduce<ClipFrame | null>(
        (best, frame) =>
          !best || Math.abs(frame.time - time) < Math.abs(best.time - time) ? frame : best,
        null,
      );
    return nearest && Math.abs(nearest.time - time) <= MAX_INTERPOLATION_GAP_MS / 2
      ? nearest.pose
      : null;
  }
  if (after.time === time) return after.pose;

  const gap = after.time - before.time;
  const u = (time - before.time) / gap;
  return before.pose.map((a, i) => {
    const b = after.pose[i];
    return {
      x: a.x + (b.x - a.x) * u,
      y: a.y + (b.y - a.y) * u,
      visibility: Math.min(a.visibility ?? 1, b.visibility ?? 1),
    };
  });
}

/** A copy of `frames` with `frame` inserted in time order (skeleton frames arrive out of order). */
export function insertFrame(frames: ClipFrame[], frame: ClipFrame): ClipFrame[] {
  const index = firstFrameFrom(frames, frame.time);
  return [...frames.slice(0, index), frame, ...frames.slice(index)];
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
