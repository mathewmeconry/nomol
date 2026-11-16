import { LM, type Pose } from '../detection/pose';
import { makePose } from '../tests/poses';
import type { ClipFrame } from './clip';
import { floorHint, learnFloor, learnFloorLine } from './floor-line';

const zone = { left: 0, top: 0, right: 1, bottom: 0.9 };

/** In the air with the knees pulled up: not standing. */
function tucked(feetY: number): Pose {
  const pose = makePose({ x: 0.5, feetY, lift: 0.2 });
  pose[LM.leftKnee] = { ...pose[LM.leftKnee], y: pose[LM.leftHip].y };
  pose[LM.rightKnee] = { ...pose[LM.rightKnee], y: pose[LM.rightHip].y };
  return pose;
}

/** Frames every 100 ms from `from` on. */
function frames(from: number, poses: Pose[]): ClipFrame[] {
  return poses.map((pose, i) => ({ time: from + i * 100, pose }));
}

/** Standing, an element of `elementFrames` frames from 0.5 s on, then standing at `standY`. */
function jumpThenStand(standY: number, standFrames = 15, elementFrames = 4): ClipFrame[] {
  return [
    ...frames(
      0,
      Array.from({ length: 5 }, () => makePose({ x: 0.3, feetY: 0.9 })),
    ),
    ...frames(
      500,
      Array.from({ length: elementFrames }, () => tucked(0.8)),
    ),
    ...frames(
      500 + elementFrames * 100,
      Array.from({ length: standFrames }, () => makePose({ x: 0.5, feetY: standY })),
    ),
  ];
}

describe('floorHint', () => {
  it('finds the feet of a gymnast standing still above the floor line after the element', () => {
    const hint = floorHint({ frames: jumpThenStand(0.7), zone, aspectRatio: 1 });
    expect(hint?.feet).toBeCloseTo(0.7);
  });

  it('gives nothing when they stood on the floor line', () => {
    expect(floorHint({ frames: jumpThenStand(0.88), zone, aspectRatio: 1 })).toBeNull();
  });

  it('gives nothing when they stood below it: that counts as standing anyway', () => {
    expect(floorHint({ frames: jumpThenStand(0.98), zone, aspectRatio: 1 })).toBeNull();
  });

  it('needs an element first: waiting before it is no landing', () => {
    const standing = frames(
      0,
      Array.from({ length: 20 }, () => makePose({ x: 0.5, feetY: 0.7 })),
    );
    expect(floorHint({ frames: standing, zone, aspectRatio: 1 })).toBeNull();
  });

  it("doesn't take a stride or a misdetected frame for an element", () => {
    expect(floorHint({ frames: jumpThenStand(0.7, 15, 1), zone, aspectRatio: 1 })).toBeNull();
  });

  it('needs a second of standing still', () => {
    expect(floorHint({ frames: jumpThenStand(0.7, 8), zone, aspectRatio: 1 })).toBeNull();
  });

  it('ignores someone much smaller than the gymnast, further back in the hall', () => {
    const clip = jumpThenStand(0.7);
    const far = clip.map((frame) =>
      frame.time < 900
        ? frame
        : { ...frame, pose: frame.pose.map((p) => ({ ...p, y: 0.7 - (0.7 - p.y) / 2 })) },
    );
    expect(floorHint({ frames: far, zone, aspectRatio: 1 })).toBeNull();
  });
});

describe('learnFloor', () => {
  it('moves only the floor line of the zone the clips started in', () => {
    const zones = [{ ...zone }, { ...zone }];
    const clip = { frames: jumpThenStand(0.7), zone: zones[1], aspectRatio: 1 };
    const first = learnFloor(zones, zones[1], clip, []);
    expect(first.zones).toBeNull();
    const second = learnFloor(zones, zones[1], clip, first.hints);
    expect(second.zones?.[0]).toBe(zones[0]);
    expect(second.zones?.[1].bottom).toBeCloseTo(0.7);
    expect(second.hints[0]).toEqual([]);
  });
});

describe('learnFloorLine', () => {
  it('waits for a second hint that agrees', () => {
    const first = learnFloorLine([], { feet: 0.7, size: 0.3 }, 0.9);
    expect(first.bottom).toBe(0.9);
    const second = learnFloorLine(first.hints, { feet: 0.72, size: 0.3 }, first.bottom);
    expect(second.bottom).toBe(0.72);
  });

  it("doesn't move for hints that disagree", () => {
    const first = learnFloorLine([], { feet: 0.5, size: 0.1 }, 0.9);
    const second = learnFloorLine(first.hints, { feet: 0.7, size: 0.3 }, first.bottom);
    expect(second.bottom).toBe(0.9);
  });

  it('never moves the line down', () => {
    const first = learnFloorLine([], { feet: 0.7, size: 0.3 }, 0.6);
    expect(learnFloorLine(first.hints, { feet: 0.7, size: 0.3 }, 0.6).bottom).toBe(0.6);
  });

  it('keeps the recent hints only', () => {
    let hints = [{ feet: 0.3, size: 0.3 }];
    for (let i = 0; i < 5; i++) hints = learnFloorLine(hints, { feet: 0.7, size: 0.01 }, 0.9).hints;
    expect(learnFloorLine(hints, { feet: 0.3, size: 0.3 }, 0.9).bottom).toBe(0.9);
  });
});
