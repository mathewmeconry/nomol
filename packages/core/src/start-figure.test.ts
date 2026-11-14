import { describe, expect, it } from 'vitest';
import { startFigure } from './start-figure';

const ZONE = { left: 0.3, top: 0.35, right: 0.7, bottom: 0.95 };

describe('startFigure', () => {
  it('stays inside the zone, arms down and crossed', () => {
    for (const time of [0, 2000]) {
      const figure = startFigure(ZONE, 1000, 1000, time);
      expect(figure).not.toBeNull();
      const points = [...figure!.strokes.flat(), figure!.head];
      for (const { x, y } of points) {
        expect(x).toBeGreaterThanOrEqual(300);
        expect(x).toBeLessThanOrEqual(700);
        expect(y).toBeGreaterThanOrEqual(350);
        expect(y).toBeLessThanOrEqual(950);
      }
    }
  });

  it('crosses the forearms above the head while held', () => {
    const figure = startFigure(ZONE, 1000, 1000, 2000)!;
    const [right, left] = figure.strokes.slice(3).map((arm) => arm[2]!);
    expect(right!.x).toBeLessThan(left!.x);
    expect(right!.y).toBeLessThan(figure.head.y);
  });

  it('loops: arms down again after one loop', () => {
    expect(startFigure(ZONE, 1000, 1000, 3200)).toEqual(startFigure(ZONE, 1000, 1000, 0));
  });

  it('is left out in a tiny zone', () => {
    expect(startFigure(ZONE, 60, 60, 0)).toBeNull();
  });
});
