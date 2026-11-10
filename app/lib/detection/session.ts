import { bodySize, distance, hipCenter, scalePose, type Point, type Pose } from './pose';
import { isStartSign } from './sign';
import { isInZone, isOnFloor, scaleZone, zoneCenter, type Zone } from './zone';

/** How long the start sign must be held. */
export const SIGN_HOLD_MS = 1000;
/** How long the gymnast must stand still on the floor before the recording stops. */
export const STILL_MS = 1000;
/** Stop when the tracked person has not been seen for this long (left the picture). */
export const LOST_MS = 1500;
/** Largest hip jump between frames (image heights) that still counts as the same person. */
const MAX_JUMP = 0.15;
/** Hip movement below this (relative to body size) counts as standing still. */
const STILL_TOLERANCE = 0.06;
/** Moving this far from the start position (relative to body size) counts as having started. */
const MOVED_DISTANCE = 0.5;

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

type Idle = { kind: 'idle'; signSince: number | null };

type Recording = {
  kind: 'recording';
  target: Point;
  startHip: Point;
  lastSeen: number;
  /**
   * False until the gymnast leaves the floor or moves away from where recording started.
   * Without it, standing still right after the sign would stop the recording immediately.
   */
  active: boolean;
  stillSince: number | null;
  stillAt: Point | null;
};

export type SessionState = Idle | Recording;

export type SessionEvent =
  | { type: 'start'; reason: 'sign' | 'button'; pose: Pose }
  | { type: 'stop'; reason: 'still' | 'lost' };

export type StepResult = {
  state: SessionState;
  event: SessionEvent | null;
  /** The person being recorded in this frame, if any. */
  target: Pose | null;
};

export const initialSession: SessionState = { kind: 'idle', signSince: null };

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
  const hip = hipCenter(pose);
  return {
    kind: 'recording',
    target: hip,
    startHip: hip,
    lastSeen: time,
    active: false,
    stillSince: null,
    stillAt: null,
  };
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
  if (!signer) return { state: { kind: 'idle', signSince: null }, event: null, target: null };

  const signSince = state.signSince ?? frame.time;
  if (frame.time - signSince < SIGN_HOLD_MS) {
    return { state: { kind: 'idle', signSince }, event: null, target: null };
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
  const hip = hipCenter(pose);
  const size = bodySize(pose);
  const onFloor = isOnFloor(pose, frame.zone);
  const active = state.active || !onFloor || distance(hip, state.startHip) > MOVED_DISTANCE * size;

  let stillSince: number | null = null;
  let stillAt: Point | null = null;
  if (active && onFloor) {
    const moved = !state.stillAt || distance(hip, state.stillAt) > STILL_TOLERANCE * size;
    stillSince = moved ? frame.time : state.stillSince;
    stillAt = moved ? hip : state.stillAt;
    if (stillSince !== null && frame.time - stillSince >= STILL_MS) {
      return { state: initialSession, event: { type: 'stop', reason: 'still' }, target: pose };
    }
  }

  return {
    state: { ...state, target: hip, lastSeen: frame.time, active, stillSince, stillAt },
    event: null,
    target: pose,
  };
}

function nearest(poses: Pose[], point: Point): Pose {
  return poses.reduce((best, pose) =>
    distance(hipCenter(pose), point) < distance(hipCenter(best), point) ? pose : best,
  );
}
