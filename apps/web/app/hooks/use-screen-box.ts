import { useEffect, useState } from 'react';
import type { Rect } from '@nomol/core/layout';

/** A box on the screen, and how much of it its scrolling area hides at the top and bottom. */
type ScreenBox = Rect & { hiddenTop: number; hiddenBottom: number };

function same(a: ScreenBox | null, b: ScreenBox) {
  return (
    a !== null &&
    a.left === b.left &&
    a.top === b.top &&
    a.width === b.width &&
    a.height === b.height &&
    a.hiddenTop === b.hiddenTop &&
    a.hiddenBottom === b.hiddenBottom
  );
}

/**
 * Where `element` is on the screen, followed every frame (scrolling, wrapping rows and turning
 * the device all move it), so an element elsewhere in the page can sit exactly on top of it.
 * The hidden parts are what the nearest `[data-scroll-area]` around it has scrolled away.
 */
export default function useScreenBox(element: HTMLElement | null): ScreenBox | null {
  const [box, setBox] = useState<ScreenBox | null>(null);

  useEffect(() => {
    if (!element) return;
    const area = element.closest('[data-scroll-area]');
    let frame = 0;
    function follow() {
      const { left, top, width, height, bottom } = element!.getBoundingClientRect();
      const visible = area?.getBoundingClientRect();
      const next = {
        left,
        top,
        width,
        height,
        hiddenTop: visible ? Math.max(0, visible.top - top) : 0,
        hiddenBottom: visible ? Math.max(0, bottom - visible.bottom) : 0,
      };
      setBox((old) => (same(old, next) ? old : next));
      frame = requestAnimationFrame(follow);
    }
    follow();
    return () => cancelAnimationFrame(frame);
  }, [element]);

  return element ? box : null;
}
