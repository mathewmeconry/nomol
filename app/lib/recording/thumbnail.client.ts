/** Wide enough to recognize a pose in the clip list, small enough to keep many in memory. */
const WIDTH = 192;

/** Grabs the current camera frame as a small JPEG data URL. */
export function captureThumbnail(video: HTMLVideoElement, canvas: HTMLCanvasElement): string {
  canvas.width = WIDTH;
  canvas.height = Math.round((WIDTH * video.videoHeight) / video.videoWidth);
  canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.6);
}
