import { describe, expect, it } from 'vitest';
import { torsoCenter, type Pose } from '../detection/pose';
import { makePose } from '../tests/poses';
import {
  bodyAngle,
  createTracker,
  fromView,
  posesFromView,
  skeletonPasses,
  type View,
} from './rotation';

const W = 640;
const H = 360;

/** The pose turned by `angle` (clockwise, in pixels) around its torso centre. */
function turned(pose: Pose, angle: number): Pose {
  const c = torsoCenter(pose);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return pose.map((p) => {
    const x = (p.x - c.x) * W;
    const y = (p.y - c.y) * H;
    return { ...p, x: c.x + (x * cos - y * sin) / W, y: c.y + (x * sin + y * cos) / H };
  });
}

function angleDiff(a: number, b: number) {
  return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
}

const gymnast = makePose({ x: 0.5, feetY: 0.8 });
const bystander = makePose({ x: 0.1, feetY: 0.9 });

/**
 * Like MediaPipe: right when the view shows the gymnast close to upright, otherwise the skeleton
 * comes out flipped. The bystander is always found.
 */
function fakeDetector(truth: Pose) {
  return (view: View) => {
    const right = angleDiff(bodyAngle(truth, W, H), view.angle) < Math.PI / 3;
    return [right ? truth : turned(truth, Math.PI), bystander];
  };
}

describe('fromView', () => {
  it('maps the view centre to its centre and turns the rest with it', () => {
    const view = { center: { x: 300, y: 200 }, size: 100, angle: Math.PI };
    expect(fromView({ x: 0.5, y: 0.5 }, view)).toEqual({ x: 300, y: 200 });
    // The top of a view turned upside down is below its centre in the frame.
    const top = fromView({ x: 0.5, y: 0 }, view);
    expect(top.x).toBeCloseTo(300);
    expect(top.y).toBeCloseTo(250);
  });
});

describe('createTracker', () => {
  it('keeps a gymnast going into a handstand and back the right way up', async () => {
    const next = createTracker(W, H);
    const angles = [0, 0.4, 0.9, 1.5, 2.1, 2.7, Math.PI, Math.PI, 2.6, 1.9, 1.2, 0.5, 0];
    for (const angle of angles) {
      const truth = turned(gymnast, angle);
      // The live skeleton may be flipped; only its torso centre and size are used.
      const pose = await next(turned(truth, Math.PI), fakeDetector(truth));
      expect(pose).not.toBeNull();
      expect(angleDiff(bodyAngle(pose!, W, H), angle)).toBeLessThan(0.01);
    }
  });

  it('never takes someone else for the gymnast', async () => {
    const next = createTracker(W, H);
    expect(await next(gymnast, () => [bystander])).toBeNull();
  });

  it('does not take someone right next to the gymnast when MediaPipe misses the gymnast', async () => {
    // As when running past someone squatting by the springboard: ~0.1 image heights away.
    const next = createTracker(W, H);
    const squatting = makePose({ x: 0.55, feetY: 0.8 });
    expect(await next(gymnast, () => [squatting])).toBeNull();
  });

  it('carries on where the gymnast was when the live tracking lost them', async () => {
    const next = createTracker(W, H);
    await next(gymnast, fakeDetector(gymnast));
    const pose = await next(null, fakeDetector(gymnast));
    expect(pose).toBe(gymnast);
  });

  it('picks up where it left off when fed its earlier results', async () => {
    // How the Android app resumes after a restart without detecting the done frames again.
    const angles = [0, 0.5, 1.1, 1.7, 2.3, 2.9, Math.PI, 2.5];
    const first = createTracker(W, H);
    const results: (Pose | null)[] = [];
    for (const angle of angles) {
      const truth = turned(gymnast, angle);
      results.push(await first(truth, fakeDetector(truth)));
    }
    const resumed = createTracker(W, H);
    for (const [i, angle] of angles.entries()) {
      const truth = turned(gymnast, angle);
      const stored = results[i];
      const pose =
        i < 5
          ? await resumed(truth, () => (stored ? [stored] : []))
          : await resumed(truth, fakeDetector(truth));
      expect(pose).toEqual(stored);
    }
  });

  it('waits for a detector that answers asynchronously', async () => {
    const next = createTracker(W, H);
    expect(await next(gymnast, (view) => Promise.resolve(fakeDetector(gymnast)(view)))).toBe(
      gymnast,
    );
  });
});

describe('posesFromView', () => {
  it('maps poses in a view to the frame, keeping visibility', () => {
    const view = { center: { x: 320, y: 180 }, size: 100, angle: 0 };
    const [pose] = posesFromView([[{ x: 0.5, y: 0, visibility: 0.7 }]], view, W, H);
    expect(pose[0].x).toBeCloseTo(0.5);
    expect(pose[0].y).toBeCloseTo(130 / H);
    expect(pose[0].visibility).toBe(0.7);
  });
});

describe('skeletonPasses', () => {
  const samples = [0, 100, 200, 300, 400].map((time) => ({ time }));

  it('goes forwards from the routine start, then backwards over the wait', () => {
    expect(skeletonPasses(samples, 250)).toEqual([
      [{ time: 300 }, { time: 400 }],
      [{ time: 200 }, { time: 100 }, { time: 0 }],
    ]);
  });

  it('goes forwards through all when the routine starts first or never', () => {
    expect(skeletonPasses(samples, 0)).toEqual([samples]);
    expect(skeletonPasses(samples, 1000)).toEqual([samples]);
  });
});
