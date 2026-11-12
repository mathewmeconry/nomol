import { useRef, useState, type PointerEvent } from 'react';
import type { Point } from '~/lib/detection/pose';

/** Distance from the screen edges, in CSS pixels. */
const MARGIN = 12;
/** Finger movement that still counts as a tap. */
const TAP_SLOP = 8;

type Drag = { start: Point; from: Point; free: Point; moved: boolean };

function clamp01(value: number) {
  return Math.min(Math.max(value, 0), 1);
}

/**
 * Lets the user drag an absolutely positioned element anywhere over its container. The spot is
 * 0–1 across the free space (0 left/top, 1 right/bottom), so it stays on screen when the device
 * is turned. Null until dragged, so the element keeps its default position.
 */
export default function useDragSpot() {
  const [spot, setSpot] = useState<Point | null>(null);
  const dragRef = useRef<Drag | null>(null);

  function onPointerDown(event: PointerEvent<HTMLElement>, element: HTMLElement | null) {
    const container = element?.offsetParent;
    if (!element || !container) return;
    const box = element.getBoundingClientRect();
    const area = container.getBoundingClientRect();
    const free = {
      x: Math.max(area.width - 2 * MARGIN - box.width, 1),
      y: Math.max(area.height - 2 * MARGIN - box.height, 1),
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      start: { x: event.clientX, y: event.clientY },
      from: {
        x: (box.left - area.left - MARGIN) / free.x,
        y: (box.top - area.top - MARGIN) / free.y,
      },
      free,
      moved: false,
    };
  }

  function onPointerMove(event: PointerEvent<HTMLElement>) {
    const drag = dragRef.current;
    if (!drag || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const dx = event.clientX - drag.start.x;
    const dy = event.clientY - drag.start.y;
    if (!drag.moved && Math.hypot(dx, dy) < TAP_SLOP) return;
    drag.moved = true;
    setSpot({
      x: clamp01(drag.from.x + dx / drag.free.x),
      y: clamp01(drag.from.y + dy / drag.free.y),
    });
  }

  /** The tap that ends a drag is not a click. */
  function wasDragged() {
    return dragRef.current?.moved ?? false;
  }

  const style = spot
    ? {
        left: `calc(${MARGIN}px + (100% - ${2 * MARGIN}px) * ${spot.x})`,
        top: `calc(${MARGIN}px + (100% - ${2 * MARGIN}px) * ${spot.y})`,
        transform: `translate(${-spot.x * 100}%, ${-spot.y * 100}%)`,
      }
    : undefined;

  return { style, onPointerDown, onPointerMove, wasDragged };
}
