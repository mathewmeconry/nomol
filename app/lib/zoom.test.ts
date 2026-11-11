import { describe, expect, it } from 'vitest';
import { FULL_VIEW, zoomView } from './zoom';

describe('zoomView', () => {
  it('keeps the pinch center under the fingers', () => {
    const view = zoomView(FULL_VIEW, 2, { x: 300, y: 200 }, { x: 300, y: 200 }, 800, 450);
    expect(view).toEqual({ scale: 2, x: -300, y: -200 });
    // The image point at (300, 200) is still drawn at 300, 200.
    expect(300 * view.scale + view.x).toBe(300);
  });

  it('pans with the fingers when zoomed in', () => {
    const zoomed = { scale: 2, x: -300, y: -200 };
    expect(zoomView(zoomed, 1, { x: 100, y: 100 }, { x: 150, y: 80 }, 800, 450)).toEqual({
      scale: 2,
      x: -250,
      y: -220,
    });
  });

  it('never shows anything outside the picture', () => {
    expect(zoomView(FULL_VIEW, 1, { x: 0, y: 0 }, { x: 100, y: 100 }, 800, 450)).toEqual(FULL_VIEW);
    const zoomed = { scale: 2, x: -300, y: -200 };
    expect(zoomView(zoomed, 1, { x: 0, y: 0 }, { x: -2000, y: 2000 }, 800, 450)).toEqual({
      scale: 2,
      x: -800,
      y: 0,
    });
  });

  it('stays between full picture and the largest zoom', () => {
    expect(zoomView(FULL_VIEW, 0.5, { x: 400, y: 200 }, { x: 400, y: 200 }, 800, 450)).toEqual(
      FULL_VIEW,
    );
    expect(zoomView(FULL_VIEW, 100, { x: 0, y: 0 }, { x: 0, y: 0 }, 800, 450).scale).toBe(6);
  });
});
