import { makePose } from '../tests/poses';
import { coverPose, detectionArea } from './zone';

describe('detectionArea', () => {
  it('crops a 16:9 picture to about a square around the start zone', () => {
    // The zone drawn at the rings, at the back of the hall.
    const zone = { left: 0.1, top: 0.01, right: 0.51, bottom: 0.88 };
    const area = detectionArea(zone, 16 / 9, null);
    expect(area.left).toBe(0);
    expect(area.top).toBe(0);
    expect(area.bottom).toBe(1);
    expect(area.right).toBeCloseTo(0.615, 2);
  });

  it('zooms in on a small zone', () => {
    const area = detectionArea({ left: 0.4, top: 0.5, right: 0.5, bottom: 0.7 }, 16 / 9, null);
    expect(area.top).toBeCloseTo(0.45);
    expect(area.bottom).toBeCloseTo(0.75);
    // As wide as tall in the picture.
    expect(((area.right - area.left) * 16) / 9).toBeCloseTo(0.3);
    expect((area.left + area.right) / 2).toBeCloseTo(0.45);
  });

  it('takes the whole picture for a zone across it', () => {
    const area = detectionArea({ left: 0.05, top: 0.1, right: 1, bottom: 0.95 }, 16 / 9, null);
    expect(area).toEqual({ left: 0, top: 0, right: 1, bottom: 1 });
  });

  it('also covers where the recorded gymnast has been', () => {
    const zone = { left: 0.4, top: 0.5, right: 0.5, bottom: 0.7 };
    const area = detectionArea(zone, 16 / 9, { left: 0.7, top: 0.4, right: 0.8, bottom: 0.6 });
    expect(area.left).toBeCloseTo(0.375);
    expect(area.right).toBeCloseTo(0.8);
  });
});

describe('coverPose', () => {
  it('grows the area by the pose and room around it', () => {
    // Standing 0.33 tall at x 0.5, feet at 0.9.
    const area = coverPose(null, makePose({ x: 0.5, feetY: 0.9 }));
    expect(area.top).toBeCloseTo(0.57 - 0.33);
    expect(area.bottom).toBeCloseTo(0.9 + 0.33);
    expect(coverPose(area, makePose({ x: 0.2, feetY: 0.9 })).left).toBeLessThan(area.left);
  });
});
