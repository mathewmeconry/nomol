import { distance, scalePose, torsoCenter, type Point, type Pose } from './pose';
import { isStartSign } from './sign';
import { isInZone, isOnFloor, scaleZone, zoneCenter, type Zone } from './zone';

/** How long the start sign must be held. */
export const SIGN_HOLD_MS = 1000;
/**
 * On a real camera the sign drops out for a frame or two while it's held, so the hold only
 * restarts when the sign has been gone for longer than this.
 */
const SIGN_DROPOUT_MS = 250;
/**
 * Stop after the gymnast has only stood or walked (both feet on the floor) for this long since
 * their last element. Short breaks within a routine stay in the recording; the replay trims the
 * idle tail (`routineRange`).
 */
export const IDLE_MS = 6000;
/** Stop when the tracked person has not been seen for this long (left the picture). */
export const LOST_MS = 1500;
/** Largest torso jump between frames (image heights) that still counts as the same person. */
const MAX_JUMP = 0.15;
/**
 * While the person isn't found, the search widens by this much per second (image heights), so
 * tracking catches up after a bad frame instead of waiting at a stale spot until `LOST_MS`.
 */
const SEARCH_GROWTH_PER_S = 0.6;

export type Frame = {
  time: number;
  /** Normalized image coordinates, as MediaPipe returns them. */
  poses: Pose[];
  zone: Zone;
  /** "Aufnahme starten" was tapped and is waiting for a person in the start zone. */
  armed: boolean;
  /** Image width / height. */
  aspectRatio: number;
};

/** Holding the sign: since when, and when it was last seen (for dropouts). */
type SignState = {
  signSince: number | null;
  signSeenAt: number | null;
  /**
   * Right after the sign started or ended a recording the gymnast is still holding it; it must
   * be released before it counts again, or it would end the recording it just started.
   */
  waitForRelease: boolean;
};

type Idle = SignState & { kind: 'idle' };

type Recording = SignState & {
  kind: 'recording';
  target: Point;
  lastSeen: number;
  /**
   * Last time the gymnast wasn't standing on both feet, i.e. did an element. Null until the
   * first one, so waiting before the routine never stops the recording.
   */
  lastElementAt: number | null;
};

export type SessionState = Idle | Recording;

export type SessionEvent =
  | { type: 'start'; reason: 'sign' | 'button'; pose: Pose }
  | { type: 'stop'; reason: 'sign' | 'idle' | 'lost' };

export type StepResult = {
  state: SessionState;
  event: SessionEvent | null;
  /** The person being recorded in this frame, if any. */
  target: Pose | null;
};

export const initialSession: Idle = {
  kind: 'idle',
  signSince: null,
  signSeenAt: null,
  waitForRelease: false,
};

/**
 * Tracks the sign over frames, tolerating short dropouts. `held`: held long enough to act on,
 * and not the one that just started or ended a recording.
 */
function holdSign(sign: SignState, signing: boolean, time: number): SignState & { held: boolean } {
  if (!signing) {
    const droppedOut = sign.signSeenAt !== null && time - sign.signSeenAt <= SIGN_DROPOUT_MS;
    if (droppedOut) return { ...sign, held: false };
    return { signSince: null, signSeenAt: null, waitForRelease: false, held: false };
  }
  const signSince = sign.signSince ?? time;
  return {
    signSince,
    signSeenAt: time,
    waitForRelease: sign.waitForRelease,
    held: !sign.waitForRelease && time - signSince >= SIGN_HOLD_MS,
  };
}

/** The sign state right after it started or ended a recording. */
function justUsed({ signSince, signSeenAt }: SignState): SignState {
  return { signSince, signSeenAt, waitForRelease: true };
}

/**
 * Normalized coordinates stretch x by the aspect ratio (on 16:9, 0.1 across is 1.78× longer
 * than 0.1 down), which skews every distance and the shoulder-width check of the sign. All
 * decisions are therefore made in image-height units; callers get their original poses back.
 */
export function step(state: SessionState, frame: Frame): StepResult {
  const poses = frame.poses.map((pose) => scalePose(pose, frame.aspectRatio));
  const scaled: Frame = { ...frame, poses, zone: scaleZone(frame.zone, frame.aspectRatio) };
  const result = state.kind === 'idle' ? stepIdle(state, scaled) : stepRecording(state, scaled);

  const original = (pose: Pose) => frame.poses[poses.indexOf(pose)];
  return {
    state: result.state,
    event:
      result.event?.type === 'start'
        ? { ...result.event, pose: original(result.event.pose) }
        : result.event,
    target: result.target && original(result.target),
  };
}

function startRecording(pose: Pose, time: number, sign: SignState): Recording {
  return {
    kind: 'recording',
    target: torsoCenter(pose),
    lastSeen: time,
    lastElementAt: null,
    ...sign,
  };
}

function stepIdle(state: Idle, frame: Frame): StepResult {
  const inZone = frame.poses.filter((pose) => isInZone(pose, frame.zone));
  const signer = inZone.find(isStartSign);
  const { held, ...sign } = holdSign(state, signer !== undefined, frame.time);

  if (frame.armed && inZone.length > 0) {
    const center = zoneCenter(frame.zone);
    const pose = nearest(inZone, center);
    return {
      state: startRecording(pose, frame.time, sign),
      event: { type: 'start', reason: 'button', pose },
      target: pose,
    };
  }

  if (!signer || !held) return { state: { kind: 'idle', ...sign }, event: null, target: null };
  return {
    state: startRecording(signer, frame.time, justUsed(sign)),
    event: { type: 'start', reason: 'sign', pose: signer },
    target: signer,
  };
}

function stepRecording(state: Recording, frame: Frame): StepResult {
  const candidates = frame.poses.filter(
    (pose) =>
      distance(torsoCenter(pose), state.target) <=
      MAX_JUMP + (SEARCH_GROWTH_PER_S * (frame.time - state.lastSeen)) / 1000,
  );
  if (candidates.length === 0) {
    if (frame.time - state.lastSeen > LOST_MS) {
      return { state: initialSession, event: { type: 'stop', reason: 'lost' }, target: null };
    }
    return { state, event: null, target: null };
  }

  const pose = nearest(candidates, state.target);
  // The gymnast ends the recording with the start sign, anywhere in the picture.
  const { held, ...sign } = holdSign(state, isStartSign(pose), frame.time);
  if (held) {
    return {
      state: { kind: 'idle', ...justUsed(sign) },
      event: { type: 'stop', reason: 'sign' },
      target: pose,
    };
  }
  const lastElementAt = isOnFloor(pose, frame.zone) ? state.lastElementAt : frame.time;
  if (lastElementAt !== null && frame.time - lastElementAt >= IDLE_MS) {
    return { state: initialSession, event: { type: 'stop', reason: 'idle' }, target: pose };
  }

  return {
    state: { ...state, ...sign, target: torsoCenter(pose), lastSeen: frame.time, lastElementAt },
    event: null,
    target: pose,
  };
}

function nearest(poses: Pose[], point: Point): Pose {
  return poses.reduce((best, pose) =>
    distance(torsoCenter(pose), point) < distance(torsoCenter(best), point) ? pose : best,
  );
}
