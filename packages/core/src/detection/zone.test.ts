import { makePose } from '../tests/poses';
import { detectionAreas, mergeAreas } from './zone';

describe('detectionAreas', () => {
  it('crops a 16:9 picture to about a square around the start zone', () => {
    // The zone drawn at the rings, at the back of the hall.
    const zone = { left: 0.1, top: 0.01, right: 0.51, bottom: 0.88 };
    const [area] = detectionAreas([zone], 16 / 9, null, false);
    expect(area.left).toBeCloseTo(0.06, 2);
    expect(area.top).toBeCloseTo(0.01);
    expect(area.bottom).toBeCloseTo(0.88);
    expect(area.right).toBeCloseTo(0.55, 2);
  });

  it('zooms in on a small zone', () => {
    const [area] = detectionAreas(
      [{ left: 0.4, top: 0.5, right: 0.5, bottom: 0.7 }],
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
    const [area] = detectionAreas(
      [{ left: 0.4, top: 0.5, right: 0.5, bottom: 0.7 }],
      16 / 9,
      null,
      true,
    );
    expect(area.top).toBeCloseTo(0.45);
    expect(area.bottom).toBeCloseTo(0.75);
  });

  it('takes the whole picture for a zone across it', () => {
    const zone = { left: 0, top: 0, right: 1, bottom: 1 };
    expect(detectionAreas([zone], 16 / 9, null, false)).toEqual([zone]);
  });

  it('looks at each start zone on its own', () => {
    // Both ends of the floor track: one area around both would span the picture.
    const zones = [
      { left: 0.05, top: 0.4, right: 0.25, bottom: 0.6 },
      { left: 0.75, top: 0.4, right: 0.95, bottom: 0.6 },
    ];
    const areas = detectionAreas(zones, 16 / 9, null, false);
    expect(areas).toHaveLength(2);
    // Squares as wide as the zones.
    for (const area of areas) expect(area.bottom - area.top).toBeCloseTo((0.2 * 16) / 9);
  });

  it('looks only around the recorded gymnast', () => {
    const zones = [
      { left: 0.4, top: 0.5, right: 0.5, bottom: 0.7 },
      { left: 0.1, top: 0.5, right: 0.2, bottom: 0.7 },
    ];
    const gymnast = { left: 0.7, top: 0.4, right: 0.8, bottom: 0.6 };
    const areas = detectionAreas(zones, 16 / 9, gymnast, false);
    expect(areas).toHaveLength(1);
    expect(areas[0].top).toBeCloseTo(0.4);
    expect(areas[0].bottom).toBeCloseTo(0.6);
    expect((areas[0].left + areas[0].right) / 2).toBeCloseTo(0.75);
  });
});

describe('mergeAreas', () => {
  it('keeps everyone found in either area', () => {
    const a = makePose({ x: 0.2, feetY: 0.9 });
    const b = makePose({ x: 0.8, feetY: 0.9 });
    expect(mergeAreas([[a], [b]], 16 / 9)).toEqual([a, b]);
  });

  it('keeps someone found in two overlapping areas once', () => {
    const a = makePose({ x: 0.5, feetY: 0.9 });
    const again = makePose({ x: 0.502, feetY: 0.901 });
    expect(mergeAreas([[a], [again]], 16 / 9)).toEqual([a]);
  });
});
