import { useEffect, useState } from 'react';
import { loadWide, saveWide } from '~/lib/camera-choice';

// Zoom isn't in TypeScript's DOM types yet (Image Capture spec).
type ZoomRange = { min: number; max: number };

function zoomRange(track: MediaStreamTrack | undefined): ZoomRange | undefined {
  return (track?.getCapabilities() as { zoom?: ZoomRange } | undefined)?.zoom;
}

/**
 * Chrome on Android often shows a phone's lenses as one back camera. Where that camera can zoom
 * out below 1×, the lowest zoom switches to the ultra-wide lens.
 *
 * @returns the widest zoom (e.g. 0.5) if available, whether it's on, and a toggle
 */
export default function useWideAngle(stream: MediaStream | null) {
  const track = stream?.getVideoTracks()[0];
  const min = zoomRange(track)?.min;
  const available = min !== undefined && min < 1;
  const [wide, setWide] = useState(() => (typeof window === 'undefined' ? false : loadWide()));

  useEffect(() => {
    if (!track || !available) return;
    void track
      .applyConstraints({ advanced: [{ zoom: wide ? min : 1 } as MediaTrackConstraintSet] })
      // If the camera refuses, it simply stays at its current zoom.
      .catch(() => undefined);
  }, [track, available, min, wide]);

  function toggle() {
    saveWide(!wide);
    setWide(!wide);
  }

  return { zoom: available ? min : undefined, wide, toggle };
}
