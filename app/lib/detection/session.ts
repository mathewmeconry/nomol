import { distance, scalePose, torsoCenter, torsoLength, type Point, type Pose } from './pose';
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
/**
 * Largest torso jump between sightings of the recorded gymnast. Going into a salto the torso
 * centre moved 0.32 in one frame (67 ms). Larger than `MAX_JUMP`, because the people around are
 * known (`others`) and can't be taken for the gymnast.
 */
const MAX_GYMNAST_JUMP = 0.35;
/**
 * The gymnast's torso length changes by at most this factor between sightings. MediaPipe's
 * collapses in handstands changed it up to ~2.3×; someone else far behind was 6× smaller.
 */
const MAX_SIZE_CHANGE = 3;
/**
 * Torso centre closer than this many torso lengths to the left or right edge: leaving the
 * picture. Someone walking out was 0.3–0.5 torso lengths from the edge, a gymnast landing near
 * it ~1. Nobody leaves in a handstand, so the size must stay closer too: the girl who had been
 * hidden behind someone walking out close to the camera was 2.5× smaller.
 */
const SIDE_TORSOS = 0.75;
const MAX_SIZE_CHANGE_AT_SIDE = 1.5;
/** Skeletons closer than this many torso lengths are taken as the same person (`othersThan`). */
const SAME_PERSON_TORSOS = 0.7;
/** Stop when the tracked person has not been seen for this long (left the picture). */
export const LOST_MS = 1500;
/** Largest torso jump between frames (image heights) that still counts as the same person. */
const MAX_JUMP = 0.15;
/**
 * While the person isn't found, the search widens by this much per second (image heights), so
 * tracking catches up after a bad frame instead of waiting at a stale spot until `LOST_MS`.
 */
const SEARCH_GROWTH_PER_S = 0.6;
/**
 * Automatic start: within this window, the person must have moved this many torso lengths
 * towards the apparatus. On Sprung videos gymnasts came in at 2–9 torso lengths per second;
 * someone standing only jitters by fractions of that, back and forth.
 */
const RUN_WINDOW_MS = 400;
const RUN_MIN_SPAN_MS = 100;
const RUN_MIN_TORSOS = 0.5;
const RUN_MIN_SIGHTINGS = 4;
/** Share of frame-to-frame steps that must go towards the apparatus. */
const RUN_FORWARD_SHARE = 0.75;

/** Automatic start: the side of the picture the run-up comes from. */
export type RunUp = 'left' | 'right';

export type Frame = {
  time: number;
  /** Normalized image coordinates, as MediaPipe returns them. */
  poses: Pose[];
  zone: Zone;
  /** "Aufnahme starten" was tapped and is waiting for a person in the start zone. */
  armed: boolean;
  /** Set when recordings start by themselves as someone runs into the start zone. */
  runUp: RunUp | null;
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

/** Where people were in a recent frame, to see who is running in. */
type Seen = { time: number; people: { center: Point; torso: number }[] };

type Idle = SignState & { kind: 'idle'; recent: Seen[] };

type Recording = SignState & {
  kind: 'recording';
  target: Point;
  /** Torso length when last seen. */
  size: number;
  lastSeen: number;
  /**
   * Where everyone else was in the last frame (torso centres). Someone who was another person a
   * moment ago stays another person: when the gymnast flipped fast or left the picture, the
   * nearest person was often a coach standing by or someone walking past.
   */
  others: Point[];
  /**
   * Last time the gymnast wasn't standing on both feet, i.e. did an element. Null until the
   * first one, so waiting before the routine never stops the recording.
   */
  lastElementAt: number | null;
};

export type SessionState = Idle | Recording;

export type SessionEvent =
  | { type: 'start'; reason: 'sign' | 'button' | 'runUp'; pose: Pose }
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
  recent: [],
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

function startRecording(pose: Pose, poses: Pose[], time: number, sign: SignState): Recording {
  return {
    kind: 'recording',
    target: torsoCenter(pose),
    size: torsoLength(pose),
    lastSeen: time,
    others: othersThan(pose, poses),
    lastElementAt: null,
    ...sign,
  };
}

/**
 * Whether the person came in from the run-up side: followed back frame by frame through
 * `recent`, they moved far enough towards the apparatus, mostly in that direction. Following
 * them step by step (rather than comparing with whoever was nearest a moment ago) keeps people
 * standing nearby and a detection that jumps for a frame from counting as movement.
 */
function isRunningIn(pose: Pose, recent: Seen[], time: number, runUp: RunUp): boolean {
  const direction = runUp === 'left' ? 1 : -1;
  const trail = [{ time, center: torsoCenter(pose), torso: torsoLength(pose) }];
  for (const seen of [...recent].reverse()) {
    const last = trail[trail.length - 1];
    const reach = MAX_JUMP + (SEARCH_GROWTH_PER_S * (last.time - seen.time)) / 1000;
    const before = seen.people
      .filter((person) => distance(person.center, last.center) <= reach)
      .sort((a, b) => distance(a.center, last.center) - distance(b.center, last.center))[0];
    if (before) trail.push({ time: seen.time, ...before });
  }
  const first = trail[trail.length - 1];
  if (trail.length < RUN_MIN_SIGHTINGS || time - first.time < RUN_MIN_SPAN_MS) return false;
  const steps = trail.slice(1).map((older, i) => (trail[i].center.x - older.center.x) * direction);
  const forward = steps.filter((step) => step > 0).length;
  const torso = Math.max(...trail.map((seen) => seen.torso));
  return (
    forward >= RUN_FORWARD_SHARE * steps.length &&
    (trail[0].center.x - first.center.x) * direction >= RUN_MIN_TORSOS * torso
  );
}

function stepIdle(state: Idle, frame: Frame): StepResult {
  const inZone = frame.poses.filter((pose) => isInZone(pose, frame.zone));
  const signer = inZone.find(isStartSign);
  const { held, ...sign } = holdSign(state, signer !== undefined, frame.time);
  const runUp = frame.runUp;
  const recent: Seen[] = runUp
    ? [
        ...state.recent.filter((seen) => frame.time - seen.time <= RUN_WINDOW_MS),
        {
          time: frame.time,
          people: frame.poses.map((pose) => ({
            center: torsoCenter(pose),
            torso: torsoLength(pose),
          })),
        },
      ]
    : [];

  if (frame.armed && inZone.length > 0) {
    const center = zoneCenter(frame.zone);
    const pose = nearest(inZone, center);
    return {
      state: startRecording(pose, frame.poses, frame.time, sign),
      event: { type: 'start', reason: 'button', pose },
      target: pose,
    };
  }

  const runner = runUp && inZone.find((pose) => isRunningIn(pose, state.recent, frame.time, runUp));
  if (runner) {
    return {
      state: startRecording(runner, frame.poses, frame.time, sign),
      event: { type: 'start', reason: 'runUp', pose: runner },
      target: runner,
    };
  }

  if (!signer || !held) {
    return { state: { kind: 'idle', ...sign, recent }, event: null, target: null };
  }
  return {
    state: startRecording(signer, frame.poses, frame.time, justUsed(sign)),
    event: { type: 'start', reason: 'sign', pose: signer },
    target: signer,
  };
}

function stepRecording(state: Recording, frame: Frame): StepResult {
  // Last seen at the side of the picture, the gymnast is probably leaving; the one showing up
  // next to that spot was often someone who had been hidden behind them. (Not at the top: a
  // salto may leave the picture there and come back.)
  const atSide =
    Math.min(state.target.x, frame.aspectRatio - state.target.x) < SIDE_TORSOS * state.size;
  const reach = atSide
    ? MAX_JUMP
    : MAX_GYMNAST_JUMP + (SEARCH_GROWTH_PER_S * (frame.time - state.lastSeen)) / 1000;
  const maxSizeChange = atSide ? MAX_SIZE_CHANGE_AT_SIDE : MAX_SIZE_CHANGE;
  const claimed = claimedByOthers(state.others, frame.poses);
  const taken = new Set(claimed.values());
  const candidates = frame.poses.filter((pose) => {
    const size = torsoLength(pose);
    return (
      !taken.has(pose) &&
      distance(torsoCenter(pose), state.target) <= reach &&
      Math.max(size / state.size, state.size / size) <= maxSizeChange
    );
  });
  if (candidates.length === 0) {
    if (frame.time - state.lastSeen > LOST_MS) {
      return { state: initialSession, event: { type: 'stop', reason: 'lost' }, target: null };
    }
    // The others are followed on (or kept where last seen) until the gymnast is found again.
    const others = state.others.map((other) => {
      const pose = claimed.get(other);
      return pose ? torsoCenter(pose) : other;
    });
    return { state: { ...state, others }, event: null, target: null };
  }

  const pose = nearest(candidates, state.target);
  const others = othersThan(pose, frame.poses);
  // The gymnast ends the recording with the start sign, anywhere in the picture.
  const { held, ...sign } = holdSign(state, isStartSign(pose), frame.time);
  if (held) {
    return {
      state: { kind: 'idle', ...justUsed(sign), recent: [] },
      event: { type: 'stop', reason: 'sign' },
      target: pose,
    };
  }
  const lastElementAt = isOnFloor(pose, frame.zone) ? state.lastElementAt : frame.time;
  if (lastElementAt !== null && frame.time - lastElementAt >= IDLE_MS) {
    return { state: initialSession, event: { type: 'stop', reason: 'idle' }, target: pose };
  }

  return {
    state: {
      ...state,
      ...sign,
      target: torsoCenter(pose),
      size: torsoLength(pose),
      lastSeen: frame.time,
      others,
      lastElementAt,
    },
    event: null,
    target: pose,
  };
}

/**
 * Everyone but the gymnast. MediaPipe sometimes puts a second, partial skeleton onto the
 * gymnast: on a trampoline its torso centre was 0.55 torso lengths off, while a coach standing
 * next to the landing was 0.8 away.
 */
function othersThan(pose: Pose, poses: Pose[]): Point[] {
  return poses
    .filter(
      (other) =>
        distance(torsoCenter(other), torsoCenter(pose)) >
        SAME_PERSON_TORSOS * Math.max(torsoLength(other), torsoLength(pose)),
    )
    .map(torsoCenter);
}

/**
 * Each of the others takes their nearest skeleton in the new frame, so they can't be taken for
 * the gymnast. Comparing distances alone wasn't enough: going into a salto the gymnast's torso
 * landed about as far from a coach as from where she had been. Someone new may be the gymnast.
 */
function claimedByOthers(others: Point[], poses: Pose[]): Map<Point, Pose> {
  const claimed = new Map<Point, Pose>();
  for (const other of others) {
    const taken = new Set(claimed.values());
    const free = poses.filter(
      (pose) => !taken.has(pose) && distance(torsoCenter(pose), other) <= MAX_JUMP,
    );
    if (free.length > 0) claimed.set(other, nearest(free, other));
  }
  return claimed;
}

/**
 * Follows the person who started a recording back through earlier frames (oldest first), the
 * same way the recording follows them forwards. Fills the part kept from before the start.
 */
export function traceBack(
  earlier: { time: number; poses: Pose[] }[],
  pose: Pose,
  time: number,
  aspectRatio: number,
): { time: number; pose: Pose }[] {
  const found: { time: number; pose: Pose }[] = [];
  let target = torsoCenter(scalePose(pose, aspectRatio));
  let lastSeen = time;
  for (const frame of [...earlier].reverse()) {
    if (frame.time >= time) continue;
    if (lastSeen - frame.time > LOST_MS) break;
    const reach = MAX_JUMP + (SEARCH_GROWTH_PER_S * (lastSeen - frame.time)) / 1000;
    let best: { pose: Pose; center: Point } | null = null;
    for (const candidate of frame.poses) {
      const center = torsoCenter(scalePose(candidate, aspectRatio));
      const gap = distance(center, target);
      if (gap <= reach && (!best || gap < distance(best.center, target))) {
        best = { pose: candidate, center };
      }
    }
    if (!best) continue;
    found.push({ time: frame.time, pose: best.pose });
    target = best.center;
    lastSeen = frame.time;
  }
  return found.reverse();
}

function nearest(poses: Pose[], point: Point): Pose {
  return poses.reduce((best, pose) =>
    distance(torsoCenter(pose), point) < distance(torsoCenter(best), point) ? pose : best,
  );
}
