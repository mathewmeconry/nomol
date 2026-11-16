/** In CSS pixels of the screen, origin top left. */
export type Rect = { left: number; top: number; width: number; height: number };

/**
 * `side`: controls in strips left and right of the picture (landscape). `bottom`: below it
 * (portrait). `null`: no room for a strip, so the controls float over the picture.
 */
export type Dock = 'side' | 'bottom' | null;

/**
 * `strip`: the controls below the picture, or left of it. `recordStrip`: right of it, for the
 * record button and what's around it (`side` only).
 */
export type Layout = { dock: Dock; picture: Rect; strip: Rect | null; recordStrip: Rect | null };

/** Narrowest strip left of the picture: status, start mode and its sentence, wrapped. */
const MIN_LEFT = 96;
/** Narrowest strip right of the picture: the record button with its label. */
const MIN_RIGHT = 88;
const MIN_SIDE = MIN_LEFT + MIN_RIGHT;
/** Lowest strip below the picture that holds the controls, until they're measured. */
const MIN_BOTTOM = 200;
/**
 * How far the picture may shrink to make room for a strip, rather than the controls covering
 * it. A Pixel 8 held upright with a 16:9 picture (no 4:3 at 60 fps) and Chrome's bars showing
 * needs 22 %; phones in landscape need ~0–3 %.
 */
const MIN_SCALE = 0.75;

/**
 * Where the picture (shown whole) and the controls go on a `width` × `height` screen. In
 * landscape the picture is as high as the screen and the width left over is split into a strip
 * on either side, evenly where both have room, so the picture sits in the middle. Below the
 * picture the strip only gets the `stripContent` height the controls need (once measured), and
 * picture and strip are centred together rather than leaving a large empty strip.
 */
export function screenLayout(
  width: number,
  height: number,
  aspectRatio: number,
  stripContent?: number,
): Layout {
  // The picture as large as it fits, as when the controls float over it.
  const fullHeight = Math.min(height, width / aspectRatio);
  const sideHeight = Math.min(height, (width - MIN_SIDE) / aspectRatio);
  const bottomHeight = Math.min(width / aspectRatio, height - (stripContent ?? MIN_BOTTOM));
  const best = Math.max(sideHeight, bottomHeight);

  if (best < fullHeight * MIN_SCALE) {
    const pictureWidth = Math.floor(fullHeight * aspectRatio);
    const pictureHeight = Math.floor(fullHeight);
    return {
      dock: null,
      picture: {
        left: Math.round((width - pictureWidth) / 2),
        top: Math.round((height - pictureHeight) / 2),
        width: pictureWidth,
        height: pictureHeight,
      },
      strip: null,
      recordStrip: null,
    };
  }

  const pictureHeight = Math.floor(best);
  const pictureWidth = Math.floor(best * aspectRatio);
  if (sideHeight >= bottomHeight) {
    const free = width - pictureWidth;
    const left = free / 2 >= MIN_LEFT ? Math.floor(free / 2) : MIN_LEFT;
    return {
      dock: 'side',
      picture: {
        left,
        top: Math.round((height - pictureHeight) / 2),
        width: pictureWidth,
        height: pictureHeight,
      },
      strip: { left: 0, top: 0, width: left, height },
      recordStrip: { left: left + pictureWidth, top: 0, width: free - left, height },
    };
  }
  const stripHeight = Math.min(height - pictureHeight, Math.ceil(stripContent ?? Infinity));
  const top = Math.round((height - pictureHeight - stripHeight) / 2);
  return {
    dock: 'bottom',
    picture: {
      left: Math.round((width - pictureWidth) / 2),
      top,
      width: pictureWidth,
      height: pictureHeight,
    },
    strip: { left: 0, top: top + pictureHeight, width, height: stripHeight },
    recordStrip: null,
  };
}
