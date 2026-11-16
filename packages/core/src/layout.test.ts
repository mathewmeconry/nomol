import { describe, expect, it } from 'vitest';
import { screenLayout } from './layout';

const WIDE = 16 / 9;
const UPRIGHT = 9 / 16;

describe('screenLayout', () => {
  it('puts the controls on either side of the picture on a phone in landscape', () => {
    expect(screenLayout(915, 412, 4 / 3)).toEqual({
      dock: 'side',
      picture: { left: 183, top: 0, width: 549, height: 412 },
      strip: { left: 0, top: 0, width: 183, height: 412 },
      recordStrip: { left: 732, top: 0, width: 183, height: 412 },
    });
  });

  it('keeps the narrowest strips and shrinks the picture a little for them', () => {
    expect(screenLayout(915, 412, WIDE)).toEqual({
      dock: 'side',
      picture: { left: 96, top: 1, width: 731, height: 411 },
      strip: { left: 0, top: 0, width: 96, height: 412 },
      recordStrip: { left: 827, top: 0, width: 88, height: 412 },
    });
    const { dock, picture, strip, recordStrip } = screenLayout(844, 390, WIDE);
    expect(dock).toBe('side');
    expect(picture).toEqual({ left: 96, top: 10, width: 660, height: 371 });
    expect(strip?.width).toBe(96);
    expect(recordStrip).toEqual({ left: 756, top: 0, width: 88, height: 390 });
  });

  it('docks the controls below the picture in portrait', () => {
    expect(screenLayout(412, 915, WIDE)).toEqual({
      dock: 'bottom',
      picture: { left: 0, top: 0, width: 412, height: 231 },
      strip: { left: 0, top: 231, width: 412, height: 684 },
      recordStrip: null,
    });
  });

  it('gives the strip below only the height its controls need, centred with the picture', () => {
    expect(screenLayout(412, 915, 4 / 3, 210.4)).toEqual({
      dock: 'bottom',
      picture: { left: 0, top: 198, width: 412, height: 309 },
      strip: { left: 0, top: 507, width: 412, height: 211 },
      recordStrip: null,
    });
  });

  it('docks below an upright camera picture on a phone held upright', () => {
    const { dock, picture, strip } = screenLayout(390, 844, UPRIGHT);
    expect(dock).toBe('bottom');
    expect(picture).toEqual({ left: 14, top: 0, width: 362, height: 644 });
    expect(strip?.height).toBe(200);
  });

  it('shrinks an upright 16:9 picture by a fifth for the controls measured below it', () => {
    // A Pixel 8 held upright, Chrome's bars showing: the camera has no 4:3 at 60 fps.
    const { dock, picture, strip } = screenLayout(485, 891, UPRIGHT, 217);
    expect(dock).toBe('bottom');
    expect(picture).toEqual({ left: 53, top: 0, width: 379, height: 674 });
    expect(strip).toEqual({ left: 0, top: 674, width: 485, height: 217 });
  });

  it('docks a 4:3 tablet with a 4:3 picture beside it', () => {
    expect(screenLayout(1024, 768, 4 / 3).dock).toBe('side');
  });

  it('lets the controls float when the picture would shrink by more than a quarter', () => {
    const { dock, picture, strip } = screenLayout(412, 700, UPRIGHT, 217);
    expect(dock).toBeNull();
    expect(strip).toBeNull();
    expect(picture.width / picture.height).toBeCloseTo(UPRIGHT, 2);
    // Shown whole and centred.
    expect(picture.left * 2 + picture.width).toBeCloseTo(412, -1);
    expect(picture.height).toBe(700);
  });

  it('picks the side that keeps the picture larger', () => {
    // A landscape tablet: a side strip would shrink the picture by 15 %, a bottom one by 7 %.
    expect(screenLayout(1180, 820, WIDE).dock).toBe('bottom');
  });
});
