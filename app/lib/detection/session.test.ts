import { makePose } from '~/tests/poses';
import { LM, type Pose } from './pose';
import {
  IDLE_MS,
  LOST_MS,
  SIGN_HOLD_MS,
  initialSession,
  step,
  traceBack,
  type RunUp,
  type SessionEvent,
  type SessionState,
} from './session';
import type { Zone } from './zone';

const zone: Zone = { left: 0.3, top: 0.3, right: 0.6, bottom: 0.9 };
const FPS = 30;
/** Long enough that an idle stop would have happened. */
const LONG = IDLE_MS + 4000;

type Scene = (time: number) => Pose[];

/** Runs the session over a scene and returns the events with their times. */
function run(
  scene: Scene,
  durationMs: number,
  options: {
    from?: SessionState;
    start?: number;
    armed?: boolean;
    runUp?: RunUp;
    aspectRatio?: number;
    /** Detections per second. */
    fps?: number;
  } = {},
) {
  let state = options.from ?? initialSession;
  const events: { time: number; event: SessionEvent }[] = [];
  const start = options.start ?? 0;
  for (let time = start; time <= start + durationMs; time += 1000 / (options.fps ?? FPS)) {
    const result = step(state, {
      time,
      poses: scene(time),
      zone,
      armed: options.armed ?? false,
      runUp: options.runUp ?? null,
      aspectRatio: options.aspectRatio ?? 1,
    });
    state = result.state;
    if (result.event) events.push({ time, event: result.event });
  }
  return { state, events };
}

describe('starting', () => {
  it('starts after the sign is held for a second inside the start zone', () => {
    const { events } = run(() => [makePose({ x: 0.45, feetY: 0.9, kind: 'sign' })], 1500);
    expect(events).toHaveLength(1);
    expect(events[0].event).toMatchObject({ type: 'start', reason: 'sign' });
    expect(events[0].time).toBeGreaterThanOrEqual(SIGN_HOLD_MS);
  });

  it('recognizes the sign on a 16:9 camera image', () => {
    // MediaPipe normalizes x by the image width, so on 16:9 the shoulders look 1.78× narrower
    // in raw coordinates than they are. Found with a real recording.
    const aspectRatio = 16 / 9;
    const squeezed = (pose: Pose) =>
      pose.map((p) => ({ ...p, x: 0.45 + (p.x - 0.45) / aspectRatio }));
    const { events } = run(
      () => [squeezed(makePose({ x: 0.45, feetY: 0.9, kind: 'sign' }))],
      1500,
      {
        aspectRatio,
      },
    );
    expect(events[0]?.event).toMatchObject({ type: 'start', reason: 'sign' });
  });

  it('returns the original, unscaled pose of the person who started', () => {
    const pose = makePose({ x: 0.45, feetY: 0.9, kind: 'sign' });
    const { events } = run(() => [pose], 1500, { aspectRatio: 16 / 9 });
    expect(events[0]?.event).toMatchObject({ type: 'start', pose });
  });

  it('keeps counting when the sign drops out for a frame or two', () => {
    // Real camera: the sign is missed in single frames while it is held.
    const { events } = run(
      (t) => [makePose({ x: 0.45, feetY: 0.9, kind: t % 300 < 66 ? 'stand' : 'sign' })],
      1500,
    );
    expect(events[0]?.event).toMatchObject({ type: 'start', reason: 'sign' });
  });

  it('does not start when the sign is released too early', () => {
    const { events } = run(
      (t) => [makePose({ x: 0.45, feetY: 0.9, kind: t < 600 || t > 900 ? 'sign' : 'stand' })],
      1500,
    );
    expect(events).toHaveLength(0);
  });

  it('ignores the sign outside the start zone', () => {
    const { events } = run(() => [makePose({ x: 0.8, feetY: 0.9, kind: 'sign' })], 2000);
    expect(events).toHaveLength(0);
  });

  it('does not start without a sign or button', () => {
    const { events } = run(() => [makePose({ x: 0.45, feetY: 0.9 })], 3000);
    expect(events).toHaveLength(0);
  });

  it('starts right away after the button when someone is in the start zone', () => {
    const { events } = run(
      () => [makePose({ x: 0.8, feetY: 0.9 }), makePose({ x: 0.45, feetY: 0.9 })],
      100,
      { armed: true },
    );
    expect(events[0].event).toMatchObject({ type: 'start', reason: 'button' });
  });

  it('waits after the button until someone is in the start zone', () => {
    const { events } = run(() => [makePose({ x: 0.8, feetY: 0.9 })], 1000, { armed: true });
    expect(events).toHaveLength(0);
  });
});

describe('starting automatically', () => {
  /** Moves across the picture at `speed` image heights per second, from `from`. */
  function moving(from: number, speed: number): Scene {
    return (t) => {
      const x = from + (speed * t) / 1000;
      return x > -0.2 && x < 1.2 ? [makePose({ x, feetY: 0.9 })] : [];
    };
  }

  it('starts when someone runs into the start zone from the run-up side', () => {
    // Torso length here is 0.09, so 0.5 per second is ~5.5 torso lengths per second.
    const { events } = run(moving(0, 0.5), 2000, { runUp: 'left' });
    expect(events[0].event).toMatchObject({ type: 'start', reason: 'runUp' });
    // Enters the zone at 600 ms.
    expect(events[0].time).toBeGreaterThanOrEqual(600);
    expect(events[0].time).toBeLessThan(700);
  });

  it('works with the run-up from the right', () => {
    const { events } = run(moving(1, -0.5), 2000, { runUp: 'right' });
    expect(events[0].event).toMatchObject({ type: 'start', reason: 'runUp' });
  });

  it('ignores people coming from the other side, walking or running', () => {
    expect(run(moving(1, -0.15), 8000, { runUp: 'left' }).events).toEqual([]);
    expect(run(moving(1, -0.5), 3000, { runUp: 'left' }).events).toEqual([]);
  });

  it('ignores someone standing in the zone, despite jitter', () => {
    const jittery: Scene = (t) => [makePose({ x: 0.45 + 0.02 * Math.sin(t / 50), feetY: 0.9 })];
    expect(run(jittery, LONG, { runUp: 'left' }).events).toEqual([]);
  });

  it('starts on a phone managing only a few detections per second', () => {
    // Runs past someone standing by the springboard, who is nearer than the runner's previous
    // sighting.
    const scene: Scene = (t) => [
      makePose({ x: 0.5, feetY: 0.9 }),
      ...moving(0, 0.6)(t).filter((pose) => pose[LM.leftHip].x < 1),
    ];
    for (const fps of [4, 6]) {
      const { events } = run(scene, 2000, { runUp: 'left', fps });
      expect(events[0]?.event).toMatchObject({ type: 'start', reason: 'runUp' });
    }
  });

  it('ignores two people side by side, detected in turn', () => {
    // As by a springboard: mostly the left one, jittering slightly, now and then the other.
    const xs = [0.4, 0.401, 0.4, 0.401, 0.55];
    for (const fps of [6, 15, 30]) {
      let frame = 0;
      const inTurn: Scene = () => [makePose({ x: xs[frame++ % xs.length], feetY: 0.9 })];
      expect(run(inTurn, LONG, { runUp: 'left', fps }).events).toEqual([]);
    }
  });

  it('only starts by itself when switched on', () => {
    expect(run(moving(0, 0.5), 2000).events).toEqual([]);
  });

  it('finds the runner in the frames before the start, not the person standing nearby', () => {
    const runner = (t: number) => makePose({ x: 0.1 + (0.5 * t) / 1000, feetY: 0.9 });
    const bystander = makePose({ x: 0.55, feetY: 0.9 });
    const earlier = [0, 100, 200, 300, 400].map((time) => ({
      time,
      poses: [bystander, runner(time)],
    }));
    const found = traceBack(earlier, runner(500), 500, 1);
    expect(found.map((frame) => frame.time)).toEqual([0, 100, 200, 300, 400]);
    expect(found.every((frame, i) => frame.pose === earlier[i].poses[1])).toBe(true);
  });
});

describe('stopping', () => {
  /** Starts a recording with the button and returns the state. */
  function recording(x: number) {
    return run(() => [makePose({ x, feetY: 0.9 })], 0, { armed: true }).state;
  }

  /** Feet rise to support height (0.3) over half a second, as when jumping onto a bar. */
  function liftAt(t: number) {
    return 0.3 * Math.min(1, t / 500);
  }

  /** Up on the bar until 1.5 s, then back down onto the floor over half a second. */
  function upAndDown(t: number) {
    return t < 1500 ? liftAt(t) : 0.3 * Math.max(0, 1 - (t - 1500) / 500);
  }

  it('keeps recording while the gymnast waits before the routine', () => {
    const { events } = run(() => [makePose({ x: 0.45, feetY: 0.9 })], LONG, {
      from: recording(0.45),
    });
    expect(events).toHaveLength(0);
  });

  it('stops when the gymnast only stands after the routine', () => {
    const scene: Scene = (t) => [makePose({ x: 0.45, feetY: 0.9, lift: upAndDown(t) })];
    const { events } = run(scene, LONG, { from: recording(0.45) });
    expect(events).toHaveLength(1);
    expect(events[0].event).toEqual({ type: 'stop', reason: 'idle' });
    // Coming down between 1.5 s and 2 s.
    expect(events[0].time).toBeGreaterThanOrEqual(1500 + IDLE_MS);
  });

  it('stops when the gymnast walks around after the routine', () => {
    const scene: Scene = (t) => [
      makePose({ x: t < 2000 ? 0.45 : 0.45 + (t - 2000) / 50000, feetY: 0.9, lift: upAndDown(t) }),
    ];
    const { events } = run(scene, LONG, { from: recording(0.45) });
    expect(events[0]?.event).toEqual({ type: 'stop', reason: 'idle' });
  });

  it('keeps recording through a short break between elements', () => {
    // Element, 4 s standing, element again.
    const scene: Scene = (t) => [
      makePose({ x: 0.45, feetY: 0.9, lift: t < 6000 ? upAndDown(t) : upAndDown(t - 6000) }),
    ];
    const { events } = run(scene, 9000, { from: recording(0.45) });
    expect(events).toHaveLength(0);
  });

  it('stops on a landing mat slightly above the floor line', () => {
    // Lands on a mat 0.03 above the floor line.
    const scene: Scene = (t) => [
      makePose({ x: 0.45, feetY: 0.9, lift: Math.max(upAndDown(t), t > 1500 ? 0.03 : 0) }),
    ];
    const { events } = run(scene, LONG, { from: recording(0.45) });
    expect(events[0]?.event).toEqual({ type: 'stop', reason: 'idle' });
  });

  it('keeps recording while the gymnast rests still in support on the bar', () => {
    const scene: Scene = (t) => [makePose({ x: 0.45, feetY: 0.9, lift: liftAt(t) })];
    const { events } = run(scene, LONG, { from: recording(0.45) });
    expect(events).toHaveLength(0);
  });

  it('keeps recording while the gymnast holds a leg up', () => {
    // From a phone recording: close to a low camera, the raised foot still looks near the floor
    // in the image, but the raised knee is up at hip height.
    function legUp(t: number) {
      const pose = makePose({ x: 0.45, feetY: 0.9, lift: upAndDown(t) });
      if (t < 2000) return pose;
      const hipY = pose[LM.leftHip].y;
      pose[LM.leftKnee] = { ...pose[LM.leftKnee], y: hipY };
      pose[LM.leftAnkle] = { ...pose[LM.leftAnkle], x: 0.6, y: 0.86 };
      return pose;
    }
    const { events } = run((t) => [legUp(t)], LONG, { from: recording(0.45) });
    expect(events).toHaveLength(0);
  });

  it('keeps recording while the gymnast stands on one foot with the other bent behind', () => {
    // The knee of the bent leg still points down, only the foot is off the floor.
    function footUp(t: number) {
      const pose = makePose({ x: 0.45, feetY: 0.9, lift: upAndDown(t) });
      if (t < 2000) return pose;
      pose[LM.leftAnkle] = { ...pose[LM.leftAnkle], y: pose[LM.leftKnee].y };
      return pose;
    }
    const { events } = run((t) => [footUp(t)], LONG, { from: recording(0.45) });
    expect(events).toHaveLength(0);
  });

  it('keeps recording during a handstand on the floor', () => {
    // Upside down: hands on the floor, feet up in the air.
    function handstand(t: number) {
      if (t < 500) return makePose({ x: 0.45, feetY: 0.9 });
      // Arms up, flipped upside down so the wrists (0.42 above the feet) rest on the floor.
      const armsUp = makePose({ x: 0.45, feetY: 0.9, kind: 'armsUp' });
      return armsUp.map((p) => ({ ...p, y: 0.9 + 0.48 - p.y }));
    }
    const { events } = run((t) => [handstand(t)], LONG, { from: recording(0.45) });
    expect(events).toHaveLength(0);
  });

  it('stops when the gymnast shows the sign, anywhere in the picture', () => {
    // An element, then walks out of the start zone (x 0.3–0.6) to x 0.8 and gives the sign.
    const x = (t: number) => Math.min(0.8, 0.45 + Math.max(0, t - 2000) / 3000);
    const scene: Scene = (t) => [
      makePose({ x: x(t), feetY: 0.9, lift: upAndDown(t), kind: t > 3500 ? 'sign' : 'stand' }),
    ];
    const { events } = run(scene, 6000, { from: recording(0.45) });
    expect(events).toHaveLength(1);
    expect(events[0].event).toEqual({ type: 'stop', reason: 'sign' });
    expect(events[0].time).toBeGreaterThanOrEqual(3500 + SIGN_HOLD_MS);
  });

  it('does not stop on the sign that started the recording', () => {
    // Started with the sign and still holding it for a few seconds.
    const { events } = run(() => [makePose({ x: 0.45, feetY: 0.9, kind: 'sign' })], 4000);
    expect(events.map((e) => e.event.type)).toEqual(['start']);
  });

  it('starts again only after the sign that ended a recording was released', () => {
    // Ends the recording with the sign in the start zone and keeps holding it, then lowers the
    // arms for a moment and gives the sign again.
    const kind = (t: number) => (t < 3000 || t > 3500 ? 'sign' : 'stand');
    const scene: Scene = (t) => [makePose({ x: 0.45, feetY: 0.9, kind: kind(t) })];
    const { events } = run(scene, 6000, { from: recording(0.45) });
    expect(events.map((e) => [e.event.type, e.event.reason])).toEqual([
      ['stop', 'sign'],
      ['start', 'sign'],
    ]);
    expect(events[1].time).toBeGreaterThan(3500 + SIGN_HOLD_MS);
  });

  it('stops when the gymnast leaves the picture', () => {
    const scene: Scene = (t) => (t < 500 ? [makePose({ x: 0.45, feetY: 0.9 })] : []);
    const { events } = run(scene, 3000, { from: recording(0.45) });
    expect(events).toHaveLength(1);
    expect(events[0].event).toEqual({ type: 'stop', reason: 'lost' });
    expect(events[0].time).toBeGreaterThan(500 + LOST_MS);
  });

  it('finds the gymnast again after the detection jumps away', () => {
    // From a phone recording: going into a handstand the skeleton flipped and the last tracked
    // position ended up off the body. The gymnast is then 0.25 away from where tracking expects.
    const scene: Scene = (t) => [
      makePose({ x: t < 1000 ? 0.45 : 0.7, feetY: 0.9, lift: liftAt(t) }),
    ];
    const { events, state } = run(scene, 4000, { from: recording(0.45) });
    expect(events).toHaveLength(0);
    expect(state.kind === 'recording' && state.target.x).toBeCloseTo(0.7, 1);
  });

  it('follows the recorded person and not someone standing still nearby', () => {
    // A spotter stands still on the floor the whole time; the gymnast is on the bar.
    const scene: Scene = (t) => [
      makePose({ x: 0.75, feetY: 0.9 }),
      makePose({ x: 0.45, feetY: 0.9, lift: liftAt(t) }),
    ];
    const { events } = run(scene, LONG, { from: recording(0.45) });
    expect(events).toHaveLength(0);
  });

  it('follows a fast salto rather than switching to a coach standing by', () => {
    // From a Sprung recording: going into the salto the torso moved ~0.3 in one frame and ended
    // up about as far from a coach standing next to the landing as from where it had been.
    const gymnast = (t: number) =>
      t < 1000
        ? makePose({ x: 0.45, feetY: 0.9 })
        : makePose({ x: 0.55, feetY: 0.9, lift: 0.3 + (t - 1000) / 10000 });
    const scene: Scene = (t) => [makePose({ x: 0.62, feetY: 0.9 }), gymnast(t)];
    const { state } = run(scene, 1500, { from: recording(0.45) });
    expect(state.kind === 'recording' && state.target.x).toBeCloseTo(0.55, 2);
  });

  it('does not switch to someone walking past while the gymnast is not detected', () => {
    // Walks from 0.85 to 0.25 over 2 s, passing the gymnast.
    const walker = (t: number) => makePose({ x: 0.85 - (0.6 * t) / 2000, feetY: 0.9 });
    const scene: Scene = (t) => [
      walker(t),
      ...(t > 800 && t < 1600 ? [] : [makePose({ x: 0.45, feetY: 0.9, lift: liftAt(t) })]),
    ];
    const { events, state } = run(scene, 2000, { from: recording(0.45) });
    expect(events).toHaveLength(0);
    expect(state.kind === 'recording' && state.target.x).toBeCloseTo(0.45, 2);
  });

  it('does not take someone who shows up where the gymnast left the picture', () => {
    // From a hall recording: a girl close to the camera walked out at the side, and the one
    // hidden behind her appeared next to that spot, much smaller.
    const behind = (pose: Pose) => shrink(pose, 0.4);
    const scene: Scene = (t) =>
      t < 1000
        ? [makePose({ x: 0.55 + (0.4 * t) / 1000, feetY: 0.9 })]
        : [behind(makePose({ x: 0.9, feetY: 0.9 }))];
    const { events } = run(scene, 3000, { from: recording(0.55) });
    expect(events.map((e) => e.event)).toEqual([{ type: 'stop', reason: 'lost' }]);
  });
});

/** The same pose, smaller around its hips: someone further away. */
function shrink(pose: Pose, factor: number): Pose {
  const hip = pose[LM.leftHip];
  return pose.map((p) => ({
    ...p,
    x: hip.x + (p.x - hip.x) * factor,
    y: hip.y + (p.y - hip.y) * factor,
  }));
}
