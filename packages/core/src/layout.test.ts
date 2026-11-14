import { describe, expect, it } from 'vitest';
import { screenLayout } from './layout';

const WIDE = 16 / 9;
const UPRIGHT = 9 / 16;

describe('screenLayout', () => {
  it('docks the controls beside the picture on a phone in landscape', () => {
    expect(screenLayout(915, 412, WIDE)).toEqual({
      dock: 'side',
      picture: { left: 0, top: 0, width: 732, height: 412 },
      strip: { left: 732, top: 0, width: 183, height: 412 },
    });
  });

  it('shrinks the picture a little when that makes room for the strip', () => {
    const { dock, picture, strip } = screenLayout(844, 390, WIDE);
    expect(dock).toBe('side');
    expect(picture.height).toBe(375);
    // Centred vertically in the space left of the strip.
    expect(picture.top).toBe(8);
    expect(strip).toEqual({ left: 668, top: 0, width: 176, height: 390 });
  });

  it('docks the controls below the picture in portrait', () => {
    expect(screenLayout(412, 915, WIDE)).toEqual({
      dock: 'bottom',
      picture: { left: 0, top: 0, width: 412, height: 231 },
      strip: { left: 0, top: 231, width: 412, height: 684 },
    });
  });

  it('docks below an upright camera picture on a phone held upright', () => {
    const { dock, picture, strip } = screenLayout(390, 844, UPRIGHT);
    expect(dock).toBe('bottom');
    expect(picture).toEqual({ left: 14, top: 0, width: 362, height: 644 });
    expect(strip?.height).toBe(200);
  });

  it('lets the controls float when the picture nearly fills the screen', () => {
    // A 4:3 tablet with a 4:3 picture, and a desktop window close to 16:9.
    for (const [width, height, aspectRatio] of [
      [1024, 768, 4 / 3],
      [1440, 900, WIDE],
    ]) {
      const { dock, picture, strip } = screenLayout(width, height, aspectRatio);
      expect(dock).toBeNull();
      expect(strip).toBeNull();
      expect(picture.width / picture.height).toBeCloseTo(aspectRatio, 2);
      // Shown whole and centred.
      expect(picture.left * 2 + picture.width).toBeCloseTo(width, -1);
      expect(picture.top * 2 + picture.height).toBeCloseTo(height, -1);
    }
  });

  it('picks the side that keeps the picture larger', () => {
    // A landscape tablet: a side strip would shrink the picture by 15 %, a bottom one by 7 %.
    expect(screenLayout(1180, 820, WIDE).dock).toBe('bottom');
  });
});
