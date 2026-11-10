import { LM, boundingBox, isVisible, type Point, type Pose } from '~/lib/detection/pose';
import type { Zone } from '~/lib/detection/zone';

/**
 * Left is warm, right is cool, so sides stay apparent when the gymnast turns or flips; arms are
 * the lighter shade of their side, legs the stronger one. Left/right is the gymnast's own side.
 */
export const LIMB_COLORS = {
  leftArm: '#ffc145',
  leftLeg: '#ff6b35',
  rightArm: '#5ee6ff',
  rightLeg: '#4d7cff',
  body: '#ffffff',
} as const;

type Limb = keyof typeof LIMB_COLORS;

const BONES: [number, number, Limb][] = [
  [LM.leftShoulder, LM.rightShoulder, 'body'],
  [LM.leftShoulder, LM.leftHip, 'body'],
  [LM.rightShoulder, LM.rightHip, 'body'],
  [LM.leftHip, LM.rightHip, 'body'],
  [LM.leftShoulder, LM.leftElbow, 'leftArm'],
  [LM.leftElbow, LM.leftWrist, 'leftArm'],
  [LM.rightShoulder, LM.rightElbow, 'rightArm'],
  [LM.rightElbow, LM.rightWrist, 'rightArm'],
  [LM.leftHip, LM.leftKnee, 'leftLeg'],
  [LM.leftKnee, LM.leftAnkle, 'leftLeg'],
  [LM.rightHip, LM.rightKnee, 'rightLeg'],
  [LM.rightKnee, LM.rightAnkle, 'rightLeg'],
];

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

/** Ear – eye – nose – eye – ear: shows where the head points, also upside down. */
const HEAD: [number, number, Limb][] = [
  [LM.leftEar, LM.leftEye, 'body'],
  [LM.leftEye, LM.nose, 'body'],
  [LM.nose, LM.rightEye, 'body'],
  [LM.rightEye, LM.rightEar, 'body'],
];

export function drawSkeleton(ctx: CanvasRenderingContext2D, pose: Pose, w: number, h: number) {
  const neck = {
    x: (pose[LM.leftShoulder].x + pose[LM.rightShoulder].x) / 2,
    y: (pose[LM.leftShoulder].y + pose[LM.rightShoulder].y) / 2,
  };
  // In profile the far ear and eye are guesses; leave out what MediaPipe can't see.
  const lines: [Point, Point, string][] = [...BONES, ...HEAD]
    .filter(([a, b]) => isVisible(pose, a, b))
    .map(([a, b, limb]) => [pose[a], pose[b], LIMB_COLORS[limb]]);
  if (isVisible(pose, LM.nose, LM.leftShoulder, LM.rightShoulder)) {
    lines.push([neck, pose[LM.nose], LIMB_COLORS.body]);
  }

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
