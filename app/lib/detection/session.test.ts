import { makePose } from '~/tests/poses';
import { LM, type Pose } from './pose';
import {
  IDLE_MS,
  LOST_MS,
  SIGN_HOLD_MS,
  initialSession,
  step,
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
  options: { from?: SessionState; start?: number; armed?: boolean; aspectRatio?: number } = {},
) {
  let state = options.from ?? initialSession;
  const events: { time: number; event: SessionEvent }[] = [];
  const start = options.start ?? 0;
  for (let time = start; time <= start + durationMs; time += 1000 / FPS) {
    const result = step(state, {
      time,
      poses: scene(time),
      zone,
      armed: options.armed ?? false,
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

  it('stops when the gymnast leaves the picture', () => {
    const scene: Scene = (t) => (t < 500 ? [makePose({ x: 0.45, feetY: 0.9 })] : []);
    const { events } = run(scene, 3000, { from: recording(0.45) });
    expect(events).toHaveLength(1);
    expect(events[0].event).toEqual({ type: 'stop', reason: 'lost' });
    expect(events[0].time).toBeGreaterThan(500 + LOST_MS);
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
});
