import type { Point } from '@nomol/core/detection/pose';
import { useRef, useState } from 'react';
import type { GestureResponderEvent, ViewProps } from 'react-native';

/** Distance from the screen edges. */
const MARGIN = 12;
/** Finger movement that still counts as a tap. */
const TAP_SLOP = 8;
/** Distance from the top until dragged, below the bar. */
const DEFAULT_TOP = 96;

type Size = { width: number; height: number };
type Drag = { start: Point; from: Point; moved: boolean };

function clamp01(value: number) {
  return Math.min(Math.max(value, 0), 1);
}

/**
 * Lets the user drag a box anywhere over the screen, as the web app's small live picture. The
 * spot is 0–1 across the free space (0 left/top, 1 right/bottom), so the box stays on screen
 * when the device is turned. A tap without dragging calls `onTap`.
 */
export function useDragSpot(screen: Size, box: Size, onTap: () => void) {
  const free = {
    x: Math.max(screen.width - 2 * MARGIN - box.width, 1),
    y: Math.max(screen.height - 2 * MARGIN - box.height, 1),
  };
  // Top right until dragged.
  const [spot, setSpot] = useState<Point | null>(null);
  const at = spot ?? { x: 1, y: clamp01((DEFAULT_TOP - MARGIN) / free.y) };
  const dragRef = useRef<Drag | null>(null);

  function pageOf(event: GestureResponderEvent): Point {
    return { x: event.nativeEvent.pageX, y: event.nativeEvent.pageY };
  }

  const handlers: ViewProps = {
    onStartShouldSetResponder: () => true,
    onResponderTerminationRequest: () => false,
    onResponderGrant: (event) => {
      dragRef.current = { start: pageOf(event), from: at, moved: false };
    },
    onResponderMove: (event) => {
      const drag = dragRef.current;
      if (!drag) return;
      const page = pageOf(event);
      const dx = page.x - drag.start.x;
      const dy = page.y - drag.start.y;
      if (!drag.moved && Math.hypot(dx, dy) < TAP_SLOP) return;
      drag.moved = true;
      setSpot({ x: clamp01(drag.from.x + dx / free.x), y: clamp01(drag.from.y + dy / free.y) });
    },
    onResponderRelease: () => {
      if (dragRef.current && !dragRef.current.moved) onTap();
      dragRef.current = null;
    },
  };

  return { position: { left: MARGIN + free.x * at.x, top: MARGIN + free.y * at.y }, handlers };
}
