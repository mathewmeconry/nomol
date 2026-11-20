/** How long the camera's light shines when a recording starts. */
const BLINK_MS = 500;

// Torch isn't in TypeScript's DOM types yet (Image Capture spec).
function setTorch(track: MediaStreamTrack, torch: boolean) {
  return track.applyConstraints({ advanced: [{ torch } as MediaTrackConstraintSet] });
}

/**
 * Blinks the camera's light, so the gymnast sees that a recording started. Does nothing where
 * the camera has none (front cameras, laptops) or the browser can't switch it (iPhone).
 */
export function blinkTorch(stream: MediaStream) {
  const track = stream.getVideoTracks()[0];
  if (!(track?.getCapabilities() as { torch?: boolean } | undefined)?.torch) return;
  setTorch(track, true)
    .then(() => setTimeout(() => void setTorch(track, false).catch(() => undefined), BLINK_MS))
    .catch(() => undefined);
}
