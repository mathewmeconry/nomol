import { LM, boundingBox, type Pose } from '~/lib/detection/pose';
import type { Zone } from '~/lib/detection/zone';

const BONES: [number, number][] = [
  [LM.leftShoulder, LM.rightShoulder],
  [LM.leftShoulder, LM.leftElbow],
  [LM.leftElbow, LM.leftWrist],
  [LM.rightShoulder, LM.rightElbow],
  [LM.rightElbow, LM.rightWrist],
  [LM.leftShoulder, LM.leftHip],
  [LM.rightShoulder, LM.rightHip],
  [LM.leftHip, LM.rightHip],
  [LM.leftHip, LM.leftKnee],
  [LM.leftKnee, LM.leftAnkle],
  [LM.rightHip, LM.rightKnee],
  [LM.rightKnee, LM.rightAnkle],
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

export function drawSkeleton(ctx: CanvasRenderingContext2D, pose: Pose, w: number, h: number) {
  ctx.lineCap = 'round';
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(94, 230, 255, 0.95)';
  for (const [a, b] of BONES) {
    ctx.beginPath();
    ctx.moveTo(pose[a].x * w, pose[a].y * h);
    ctx.lineTo(pose[b].x * w, pose[b].y * h);
    ctx.stroke();
  }
  ctx.fillStyle = '#fff';
  for (const [a, b] of BONES) {
    for (const i of [a, b]) {
      ctx.beginPath();
      ctx.arc(pose[i].x * w, pose[i].y * h, 3.5, 0, Math.PI * 2);
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
