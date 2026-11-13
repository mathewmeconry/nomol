/** Wide enough to recognize a pose in the clip list, small enough to keep many in memory. */
const WIDTH = 192;

/** A camera frame as a small JPEG data URL. */
export function captureThumbnail(frame: VideoFrame, canvas: HTMLCanvasElement): string {
  canvas.width = WIDTH;
  canvas.height = Math.round((WIDTH * frame.displayHeight) / frame.displayWidth);
  canvas.getContext('2d')?.drawImage(frame, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.6);
}
