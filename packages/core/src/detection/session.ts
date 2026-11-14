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
 * With an automatic start from one side (Sprung) the jump is the one element. After 6 s of
 * standing, the next gymnast had often run in and ended up in the same clip; on 14 Sprung clips
 * (November 2026, floor line put where people stood after landing) 2.5 s stopped 7 of them
 * after the landing, 6 s one.
 */
export const RUN_UP_IDLE_MS = 2500;
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
/**
 * Longer when last seen in an element: swinging on the rings, the gymnast was out of the picture
 * for up to 1.2 s and is often not found while blurred at the bottom of the swing.
 */
export const LOST_IN_ELEMENT_MS = 3000;
/** Largest torso jump between frames (image heights) that still counts as the same person. */
const MAX_JUMP = 0.15;
/**
 * While the person isn't found, the search widens by this much per second (image heights), so
 * tracking catches up after a bad frame instead of waiting at a stale spot until `LOST_MS`.
 */
const SEARCH_GROWTH_PER_S = 0.6;
/**
 * Automatic start: the person was seen this many times within the window, each sighting at
 * least `RUN_STEP_MS` after the previous one and further towards the apparatus at a runner's
 * speed (torso lengths per second). On Sprung videos gymnasts came in at 2–9 torso lengths per
 * second. The window holds four sightings even on a phone managing 3–4 detections per second,
 * where a gymnast was in the picture for only ~0.35 s before the take-off (the flight counts
 * too). Three such steps cover at least 0.6 torso lengths, more than someone standing jitters;
 * a filming phone held by hand drifted at ~1.7. Two people side by side, detected in turn,
 * made one step and then stood.
 */
const RUN_WINDOW_MS = 1000;
const RUN_STEP_MS = 100;
const RUN_MIN_SIGHTINGS = 4;
const RUN_MIN_SPEED = 2;
/** Faster steps were hops to someone else in a busy hall. */
const RUN_MAX_SPEED = 12;
/**
 * Torso lengths of consecutive sightings differ by at most this factor; otherwise the trail
 * hopped between people, e.g. from the runner to someone squatting by the springboard.
 */
const RUN_MAX_SIZE_CHANGE = 1.5;
/** Tracing a runner back: between two sure sightings, a skeleton this close to the path. */
const RUN_PATH_TORSOS = 0.5;

/**
 * Automatic start in any direction (`RunUp` 'any'): someone walking also covers 2–3 torso
 * lengths per second, so only faster counts. Swinging on the rings and running measured 5–12.
 */
const ANY_MIN_SPEED = 4;

/**
 * Automatic start: the side of the picture the run-up comes from, or 'any' for anyone fast
 * enough in any direction (swinging on the rings, a run-up on the floor).
 */
export type RunUp = 'left' | 'right' | 'any';

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
type Person = { center: Point; torso: number };
type Seen = { time: number; people: Person[] };

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
   * first one, so waiting before the routine never stops the recording. An automatic start is
   * one: a coach who walked in fast enough to start it then stood in front of the camera for
   * the rest of a 30 s clip.
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

function startRecording(
  pose: Pose,
  poses: Pose[],
  time: number,
  sign: SignState,
  lastElementAt: number | null = null,
): Recording {
  return {
    kind: 'recording',
    target: torsoCenter(pose),
    size: torsoLength(pose),
    lastSeen: time,
    others: othersThan(pose, poses),
    lastElementAt,
    ...sign,
  };
}

type Sighting<P extends Person> = { time: number; person: P; people: P[] };

/**
 * A runner's sightings, newest first, starting with `start` (see `RUN_WINDOW_MS`): followed
 * back through `seen` (oldest first), only to where a runner could have been before. The
 * nearest skeleton was often someone else: running past people sitting by the springboard, the
 * gymnast's previous sighting was further away than they were.
 */
function runTrail<P extends Person>(
  start: Sighting<P>,
  seen: { time: number; people: P[] }[],
  runUp: RunUp,
): Sighting<P>[] {
  const minSpeed = runUp === 'any' ? ANY_MIN_SPEED : RUN_MIN_SPEED;
  const trail = [start];
  for (const frame of [...seen].reverse()) {
    const last = trail[trail.length - 1];
    const seconds = (last.time - frame.time) / 1000;
    if (seconds * 1000 < RUN_STEP_MS) continue;
    if (seconds * 1000 > LOST_MS) break;
    const direction = runDirection(runUp, trail);
    const before = frame.people
      .filter((person) => {
        const torso = Math.max(person.torso, last.person.torso);
        const step = {
          x: last.person.center.x - person.center.x,
          y: last.person.center.y - person.center.y,
        };
        const forward = direction
          ? step.x * direction.x + step.y * direction.y
          : Math.hypot(step.x, step.y);
        return (
          torso <= RUN_MAX_SIZE_CHANGE * Math.min(person.torso, last.person.torso) &&
          forward >= minSpeed * torso * seconds &&
          distance(person.center, last.person.center) <= RUN_MAX_SPEED * torso * seconds &&
          !hopped({ time: frame.time, person, people: frame.people }, last)
        );
      })
      .sort(
        (a, b) => distance(a.center, last.person.center) - distance(b.center, last.person.center),
      )[0];
    if (before) trail.push({ time: frame.time, person: before, people: frame.people });
  }
  return trail;
}

/**
 * Two sightings are of different people standing apart, detected in turn, rather than of
 * someone moving: someone of the same size is still where the earlier one was, or was already
 * where the later one is. On the rings the trail otherwise led from someone walking past to
 * people waiting in a row, and across the picture to someone standing at its edge.
 */
function hopped(earlier: Sighting<Person>, later: Sighting<Person>): boolean {
  const occupied = (spot: Person, { person, people }: Sighting<Person>) =>
    people.some(
      (other) =>
        other !== person &&
        distance(other.center, spot.center) <= RUN_PATH_TORSOS * spot.torso &&
        Math.max(other.torso, spot.torso) <=
          RUN_MAX_SIZE_CHANGE * Math.min(other.torso, spot.torso),
    );
  return occupied(earlier.person, later) || occupied(later.person, earlier);
}

/**
 * The way a runner's earlier sightings have to lead (unit vector): towards the apparatus, or
 * for 'any' along the trail's previous step, so jitter back and forth doesn't add up. Null for
 * the first step of 'any', which may go anywhere.
 */
function runDirection(runUp: RunUp, trail: { person: Person }[]): Point | null {
  if (runUp !== 'any') return { x: runUp === 'left' ? 1 : -1, y: 0 };
  if (trail.length < 2) return null;
  const [later, earlier] = trail.slice(-2).map(({ person }) => person.center);
  const length = distance(later, earlier);
  return { x: (later.x - earlier.x) / length, y: (later.y - earlier.y) / length };
}

function stepIdle(state: Idle, frame: Frame): StepResult {
  const inZone = frame.poses.filter((pose) => isInZone(pose, frame.zone));
  const signer = inZone.find(isStartSign);
  const { held, ...sign } = holdSign(state, signer !== undefined, frame.time);
  const runUp = frame.runUp;
  const people: Person[] = frame.poses.map((pose) => ({
    center: torsoCenter(pose),
    torso: torsoLength(pose),
  }));
  const recent: Seen[] = runUp
    ? [
        ...state.recent.filter((seen) => frame.time - seen.time <= RUN_WINDOW_MS),
        { time: frame.time, people },
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

  const runner =
    runUp &&
    inZone.find((pose) => {
      const start = { time: frame.time, person: people[frame.poses.indexOf(pose)], people };
      return runTrail(start, state.recent, runUp).length >= RUN_MIN_SIGHTINGS;
    });
  if (runner) {
    return {
      state: startRecording(runner, frame.poses, frame.time, sign, frame.time),
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
  // Last seen standing at the side of the picture, the gymnast is probably walking out; the one
  // showing up next to that spot was often someone who had been hidden behind them. In the air
  // they come back: on the rings a swing left the picture at the side and the gymnast came back
  // 0.4 s later, 0.26 further in. (Nor at the top: a salto may leave the picture there.)
  const inElement = state.lastElementAt === state.lastSeen;
  const atSide =
    !inElement &&
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
    if (frame.time - state.lastSeen > (inElement ? LOST_IN_ELEMENT_MS : LOST_MS)) {
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
  const idleMs = frame.runUp === 'left' || frame.runUp === 'right' ? RUN_UP_IDLE_MS : IDLE_MS;
  if (lastElementAt !== null && frame.time - lastElementAt >= idleMs) {
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
 * Someone who ran in (`runUp`) is followed like the automatic start does (`runTrail`), and
 * not before that: the nearest skeleton led onto a girl squatting by the springboard, who was
 * then shown for the whole wait and run-up.
 *
 * @param poses everyone in the frame that started the recording, `pose` among them
 */
export function traceBack(
  earlier: { time: number; poses: Pose[] }[],
  pose: Pose,
  poses: Pose[],
  time: number,
  aspectRatio: number,
  runUp: RunUp | null,
): { time: number; pose: Pose }[] {
  if (runUp) return traceRunner(earlier, pose, poses, time, aspectRatio, runUp);
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

/**
 * The runner's sure sightings (`runTrail`), and in the frames between two of them the skeleton
 * nearest the straight path between them.
 */
function traceRunner(
  earlier: { time: number; poses: Pose[] }[],
  pose: Pose,
  poses: Pose[],
  time: number,
  aspectRatio: number,
  runUp: RunUp,
): { time: number; pose: Pose }[] {
  const toPerson = (candidate: Pose) => {
    const scaled = scalePose(candidate, aspectRatio);
    return { center: torsoCenter(scaled), torso: torsoLength(scaled), pose: candidate };
  };
  const frames = earlier
    .filter((frame) => frame.time < time)
    .map((frame) => ({ time: frame.time, people: frame.poses.map(toPerson) }));
  const people = poses.map(toPerson);
  const person = people.find((candidate) => candidate.pose === pose) ?? toPerson(pose);
  const trail = runTrail({ time, person, people }, frames, runUp).reverse();

  const found: { time: number; pose: Pose }[] = [];
  for (const frame of frames) {
    if (frame.time < trail[0].time) continue;
    const next = trail.findIndex((sighting) => sighting.time >= frame.time);
    const after = trail[next];
    if (after.time === frame.time) {
      found.push({ time: frame.time, pose: after.person.pose });
      continue;
    }
    const before = trail[next - 1].person;
    const share = (frame.time - trail[next - 1].time) / (after.time - trail[next - 1].time);
    const path = {
      x: before.center.x + (after.person.center.x - before.center.x) * share,
      y: before.center.y + (after.person.center.y - before.center.y) * share,
    };
    const torso = Math.max(before.torso, after.person.torso);
    const best = frame.people
      .filter(
        (person) =>
          distance(person.center, path) <= RUN_PATH_TORSOS * torso &&
          torso <= RUN_MAX_SIZE_CHANGE * person.torso,
      )
      .sort((a, b) => distance(a.center, path) - distance(b.center, path))[0];
    if (best) found.push({ time: frame.time, pose: best.pose });
  }
  return found;
}

function nearest(poses: Pose[], point: Point): Pose {
  return poses.reduce((best, pose) =>
    distance(torsoCenter(pose), point) < distance(torsoCenter(best), point) ? pose : best,
  );
}
