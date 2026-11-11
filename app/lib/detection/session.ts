import { distance, hipCenter, scalePose, type Point, type Pose } from './pose';
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
/** Largest hip jump between frames (image heights) that still counts as the same person. */
const MAX_JUMP = 0.15;

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

type Idle = { kind: 'idle'; signSince: number | null; signSeenAt: number | null };

type Recording = {
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
  | { type: 'stop'; reason: 'idle' | 'lost' };

export type StepResult = {
  state: SessionState;
  event: SessionEvent | null;
  /** The person being recorded in this frame, if any. */
  target: Pose | null;
};

export const initialSession: SessionState = { kind: 'idle', signSince: null, signSeenAt: null };

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

function startRecording(pose: Pose, time: number): Recording {
  return { kind: 'recording', target: hipCenter(pose), lastSeen: time, lastElementAt: null };
}

function stepIdle(state: Idle, frame: Frame): StepResult {
  const inZone = frame.poses.filter((pose) => isInZone(pose, frame.zone));

  if (frame.armed && inZone.length > 0) {
    const center = zoneCenter(frame.zone);
    const pose = nearest(inZone, center);
    return {
      state: startRecording(pose, frame.time),
      event: { type: 'start', reason: 'button', pose },
      target: pose,
    };
  }

  const signer = inZone.find(isStartSign);
  if (!signer) {
    const droppedOut =
      state.signSeenAt !== null && frame.time - state.signSeenAt <= SIGN_DROPOUT_MS;
    return { state: droppedOut ? state : initialSession, event: null, target: null };
  }

  const signSince = state.signSince ?? frame.time;
  if (frame.time - signSince < SIGN_HOLD_MS) {
    return {
      state: { kind: 'idle', signSince, signSeenAt: frame.time },
      event: null,
      target: null,
    };
  }
  return {
    state: startRecording(signer, frame.time),
    event: { type: 'start', reason: 'sign', pose: signer },
    target: signer,
  };
}

function stepRecording(state: Recording, frame: Frame): StepResult {
  const candidates = frame.poses.filter(
    (pose) => distance(hipCenter(pose), state.target) <= MAX_JUMP,
  );
  if (candidates.length === 0) {
    if (frame.time - state.lastSeen > LOST_MS) {
      return { state: initialSession, event: { type: 'stop', reason: 'lost' }, target: null };
    }
    return { state, event: null, target: null };
  }

  const pose = nearest(candidates, state.target);
  const lastElementAt = isOnFloor(pose, frame.zone) ? state.lastElementAt : frame.time;
  if (lastElementAt !== null && frame.time - lastElementAt >= IDLE_MS) {
    return { state: initialSession, event: { type: 'stop', reason: 'idle' }, target: pose };
  }

  return {
    state: { ...state, target: hipCenter(pose), lastSeen: frame.time, lastElementAt },
    event: null,
    target: pose,
  };
}

function nearest(poses: Pose[], point: Point): Pose {
  return poses.reduce((best, pose) =>
    distance(hipCenter(pose), point) < distance(hipCenter(best), point) ? pose : best,
  );
}
