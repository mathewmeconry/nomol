/** In CSS pixels of the screen, origin top left. */
export type Rect = { left: number; top: number; width: number; height: number };

/**
 * `side`: controls in a strip right of the picture (landscape). `bottom`: below it (portrait).
 * `null`: no room for a strip, so the controls float over the picture.
 */
export type Dock = 'side' | 'bottom' | null;

export type Layout = { dock: Dock; picture: Rect; strip: Rect | null };

/** Narrowest strip beside the picture that still holds the controls in one column. */
const MIN_SIDE = 176;
/** Lowest strip below the picture that holds the bar, the start hint and the clips. */
const MIN_BOTTOM = 200;
/**
 * How far the picture may shrink to make room for a strip. Phones in landscape need ~3 %, and
 * with the camera upright in portrait ~7 %; a 16:9 desktop window would need 12 % and floats.
 */
const MIN_SCALE = 0.9;

/**
 * Where the picture (shown whole) and the controls go on a `width` × `height` screen. The picture
 * is pinned to the left or top edge, so all free space ends up in one strip for the controls.
 */
export function screenLayout(width: number, height: number, aspectRatio: number): Layout {
  // The picture as large as it fits, as when the controls float over it.
  const fullHeight = Math.min(height, width / aspectRatio);
  const sideHeight = Math.min(height, (width - MIN_SIDE) / aspectRatio);
  const bottomHeight = Math.min(width / aspectRatio, height - MIN_BOTTOM);
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
    };
  }

  const pictureHeight = Math.floor(best);
  const pictureWidth = Math.floor(best * aspectRatio);
  if (sideHeight >= bottomHeight) {
    return {
      dock: 'side',
      picture: {
        left: 0,
        top: Math.round((height - pictureHeight) / 2),
        width: pictureWidth,
        height: pictureHeight,
      },
      strip: { left: pictureWidth, top: 0, width: width - pictureWidth, height },
    };
  }
  return {
    dock: 'bottom',
    picture: {
      left: Math.round((width - pictureWidth) / 2),
      top: 0,
      width: pictureWidth,
      height: pictureHeight,
    },
    strip: { left: 0, top: pictureHeight, width, height: height - pictureHeight },
  };
}
