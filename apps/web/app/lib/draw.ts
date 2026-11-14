import { boundingBox, type Pose } from '@nomol/core/detection/pose';
import type { Zone } from '@nomol/core/detection/zone';
import { skeletonLines } from '@nomol/core/skeleton/lines';

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

/** One loop of the start-sign animation: arms down, raise, hold crossed, lower. */
const SIGN_LOOP_MS = 3200;

/**
 * Elbow and wrist of the figure's right arm (x from the body's middle, y up from the feet, in
 * body heights). Crossed: elbows beside the head, forearms crossing near their middle above it.
 * The arms move straight between the two, in front of the body, so the figure stays narrow.
 */
const ARMS_DOWN = { elbow: { x: 0.14, y: 0.6 }, wrist: { x: 0.16, y: 0.36 } };
const ARMS_CROSSED = { elbow: { x: 0.13, y: 0.96 }, wrist: { x: -0.1, y: 1.1 } };

/** How far the arms are raised (0 down, 1 crossed) at `timeMs`, eased. */
function raised(timeMs: number) {
  const t = timeMs % SIGN_LOOP_MS;
  const u = t < 600 ? 0 : t < 1300 ? (t - 600) / 700 : t < 2800 ? 1 : 1 - (t - 2800) / 400;
  return u * u * (3 - 2 * u);
}

/**
 * Faint stick figure standing in the middle of the start zone, showing the start sign: arms
 * raised until the forearms cross in an X just above the head. Animated by `timeMs`.
 */
export function drawStartSign(
  ctx: CanvasRenderingContext2D,
  zone: Zone,
  w: number,
  h: number,
  timeMs: number,
) {
  const zoneWidth = (zone.right - zone.left) * w;
  const zoneHeight = (zone.bottom - zone.top) * h;
  // Height of the body; raised arms add ~12 % on top, the figure is never wider than ~0.35×.
  const size = Math.min((zoneHeight * 0.92) / 1.12, (zoneWidth * 0.9) / 0.35);
  if (size < 30) return;
  const centerX = ((zone.left + zone.right) / 2) * w;
  const feetY = zone.bottom * h - zoneHeight * 0.02;
  const at = (dx: number, dy: number): [number, number] => [centerX + dx * size, feetY - dy * size];

  const u = raised(timeMs);
  const between = (from: number, to: number) => from + (to - from) * u;
  /** Shoulder → elbow → wrist; `side` 1 for the image right, -1 mirrors it. */
  function arm(side: 1 | -1): [number, number][] {
    const { elbow: down, wrist: downWrist } = ARMS_DOWN;
    const { elbow: up, wrist: upWrist } = ARMS_CROSSED;
    return [
      at(0.11 * side, 0.78),
      at(between(down.x, up.x) * side, between(down.y, up.y)),
      at(between(downWrist.x, upWrist.x) * side, between(downWrist.y, upWrist.y)),
    ];
  }

  const strokes: [number, number][][] = [
    [at(-0.1, 0), at(-0.06, 0.25), at(0, 0.48), at(0.06, 0.25), at(0.1, 0)], // legs
    [at(0, 0.48), at(0, 0.8)], // body
    [at(-0.11, 0.78), at(0.11, 0.78)], // shoulders
    arm(1),
    arm(-1),
  ];
  // One path, stroked once: separate translucent strokes would stack up where they overlap and
  // show the joints as darker blobs.
  const figure = new Path2D();
  for (const points of strokes) {
    figure.moveTo(...points[0]);
    for (const point of points.slice(1)) figure.lineTo(...point);
  }
  const [headX, headY] = at(0, 0.88);
  const headRadius = size * 0.07;
  figure.moveTo(headX + headRadius, headY);
  figure.arc(headX, headY, headRadius, 0, Math.PI * 2);

  const width = Math.max(2, size * 0.018);
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
