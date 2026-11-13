import { describe, expect, it } from 'vitest';
import { torsoCenter, type Pose } from '~/lib/detection/pose';
import { makePose } from '~/tests/poses';
import { bodyAngle, createTracker, fromView, type View } from './rotation';

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
  it('keeps a gymnast going into a handstand and back the right way up', () => {
    const next = createTracker(W, H);
    const angles = [0, 0.4, 0.9, 1.5, 2.1, 2.7, Math.PI, Math.PI, 2.6, 1.9, 1.2, 0.5, 0];
    for (const angle of angles) {
      const truth = turned(gymnast, angle);
      // The live skeleton may be flipped; only its torso centre and size are used.
      const pose = next(turned(truth, Math.PI), fakeDetector(truth));
      expect(pose).not.toBeNull();
      expect(angleDiff(bodyAngle(pose!, W, H), angle)).toBeLessThan(0.01);
    }
  });

  it('never takes someone else for the gymnast', () => {
    const next = createTracker(W, H);
    expect(next(gymnast, () => [bystander])).toBeNull();
  });

  it('does not take someone right next to the gymnast when MediaPipe misses the gymnast', () => {
    // As when running past someone squatting by the springboard: ~0.1 image heights away.
    const next = createTracker(W, H);
    const squatting = makePose({ x: 0.55, feetY: 0.8 });
    expect(next(gymnast, () => [squatting])).toBeNull();
  });

  it('carries on where the gymnast was when the live tracking lost them', () => {
    const next = createTracker(W, H);
    next(gymnast, fakeDetector(gymnast));
    const pose = next(null, fakeDetector(gymnast));
    expect(pose).toBe(gymnast);
  });
});
