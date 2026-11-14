import { makePose } from '../tests/poses';
import { coverPose, detectionArea } from './zone';

describe('detectionArea', () => {
  it('crops a 16:9 picture to about a square around the start zone', () => {
    // The zone drawn at the rings, at the back of the hall.
    const zone = { left: 0.1, top: 0.01, right: 0.51, bottom: 0.88 };
    const area = detectionArea(zone, 16 / 9, null, false);
    expect(area.left).toBeCloseTo(0.06, 2);
    expect(area.top).toBeCloseTo(0.01);
    expect(area.bottom).toBeCloseTo(0.88);
    expect(area.right).toBeCloseTo(0.55, 2);
  });

  it('zooms in on a small zone', () => {
    const area = detectionArea(
      { left: 0.4, top: 0.5, right: 0.5, bottom: 0.7 },
      16 / 9,
      null,
      false,
    );
    expect(area.top).toBeCloseTo(0.5);
    expect(area.bottom).toBeCloseTo(0.7);
    // As wide as tall in the picture.
    expect(((area.right - area.left) * 16) / 9).toBeCloseTo(0.2);
    expect((area.left + area.right) / 2).toBeCloseTo(0.45);
  });

  it('adds a margin around the zone while waiting for an automatic start', () => {
    const area = detectionArea(
      { left: 0.4, top: 0.5, right: 0.5, bottom: 0.7 },
      16 / 9,
      null,
      true,
    );
    expect(area.top).toBeCloseTo(0.45);
    expect(area.bottom).toBeCloseTo(0.75);
  });

  it('takes the whole picture for a zone across it', () => {
    const zone = { left: 0, top: 0, right: 1, bottom: 1 };
    expect(detectionArea(zone, 16 / 9, null, false)).toEqual(zone);
  });

  it('looks only around the recorded gymnast', () => {
    const zone = { left: 0.4, top: 0.5, right: 0.5, bottom: 0.7 };
    const gymnast = { left: 0.7, top: 0.4, right: 0.8, bottom: 0.6 };
    const area = detectionArea(zone, 16 / 9, gymnast, false);
    expect(area.top).toBeCloseTo(0.4);
    expect(area.bottom).toBeCloseTo(0.6);
    expect((area.left + area.right) / 2).toBeCloseTo(0.75);
  });
});

describe('coverPose', () => {
  it('is the pose with its own size around it', () => {
    // Standing 0.33 tall at x 0.5, feet at 0.9.
    const area = coverPose(makePose({ x: 0.5, feetY: 0.9 }));
    expect(area.top).toBeCloseTo(0.57 - 0.33);
    expect(area.bottom).toBeCloseTo(0.9 + 0.33);
  });
});
