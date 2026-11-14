import { boundingBox, type Pose } from '@nomol/core/detection/pose';
import type { Zone } from '@nomol/core/detection/zone';
import { skeletonLines } from '@nomol/core/skeleton/lines';
import { startFigure } from '@nomol/core/start-figure';

/**
 * Resizes the canvas to its displayed size (sharp on high-DPI tablets) and clears it.
 * Returns the drawing size in CSS pixels.
 */
export function prepareCanvas(canvas: HTMLCanvasElement) {
  const ratio = window.devicePixelRatio || 1;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);
  return { ctx, width, height };
}

export function drawSkeleton(ctx: CanvasRenderingContext2D, pose: Pose, w: number, h: number) {
  const lines = skeletonLines(pose);
  ctx.lineCap = 'round';
  // A dark outline keeps the colours readable on bright mats and walls.
  for (const [width, outline] of [
    [6, true],
    [3.5, false],
  ] as const) {
    ctx.lineWidth = width;
    for (const [a, b, color] of lines) {
      ctx.strokeStyle = outline ? 'rgba(0, 0, 0, 0.55)' : color;
      ctx.beginPath();
      ctx.moveTo(a.x * w, a.y * h);
      ctx.lineTo(b.x * w, b.y * h);
      ctx.stroke();
    }
  }
  for (const [a, b, color] of lines) {
    for (const p of [a, b]) {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(p.x * w, p.y * h, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

export function drawZone(ctx: CanvasRenderingContext2D, zone: Zone, w: number, h: number) {
  const x = zone.left * w;
  const y = zone.top * h;
  ctx.fillStyle = 'rgba(60, 211, 176, 0.08)';
  ctx.fillRect(x, y, (zone.right - zone.left) * w, (zone.bottom - zone.top) * h);
  ctx.setLineDash([8, 6]);
  ctx.strokeStyle = 'rgba(60, 211, 176, 0.7)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x, y, (zone.right - zone.left) * w, (zone.bottom - zone.top) * h);
  ctx.setLineDash([]);
  ctx.font = '600 12px system-ui, sans-serif';
  ctx.fillStyle = 'rgba(60, 211, 176, 0.95)';
  ctx.textBaseline = 'bottom';
  ctx.fillText('STARTZONE', x + 4, y - 4);
}

/** The start-sign figure (core's `startFigure`) in the start zone, animated by `timeMs`. */
export function drawStartSign(
  ctx: CanvasRenderingContext2D,
  zone: Zone,
  w: number,
  h: number,
  timeMs: number,
) {
  const shape = startFigure(zone, w, h, timeMs);
  if (!shape) return;
  // One path, stroked once: separate translucent strokes would stack up where they overlap and
  // show the joints as darker blobs.
  const figure = new Path2D();
  for (const [first, ...rest] of shape.strokes) {
    figure.moveTo(first!.x, first!.y);
    for (const point of rest) figure.lineTo(point.x, point.y);
  }
  const { head } = shape;
  figure.moveTo(head.x + head.radius, head.y);
  figure.arc(head.x, head.y, head.radius, 0, Math.PI * 2);

  const width = shape.lineWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // Faint, so the gymnast standing in the zone stays visible through it; a light dark outline
  // keeps it readable on bright backgrounds.
  for (const [color, lineWidth] of [
    ['rgba(0, 0, 0, 0.12)', width + 3],
    ['rgba(60, 211, 176, 0.35)', width],
  ] as const) {
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.stroke(figure);
  }
}

export function drawPersonBox(
  ctx: CanvasRenderingContext2D,
  pose: Pose,
  w: number,
  h: number,
  color: string,
  label: string,
) {
  const box = boundingBox(pose);
  const pad = 0.02;
  const x = (box.left - pad) * w;
  const y = (box.top - pad) * h;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.5;
  ctx.strokeRect(x, y, (box.right - box.left + 2 * pad) * w, (box.bottom - box.top + 2 * pad) * h);
  ctx.font = '600 12px system-ui, sans-serif';
  const textWidth = ctx.measureText(label).width + 10;
  ctx.fillStyle = color;
  ctx.fillRect(x, y - 18, textWidth, 18);
  ctx.fillStyle = '#08130f';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x + 5, y - 9);
}
