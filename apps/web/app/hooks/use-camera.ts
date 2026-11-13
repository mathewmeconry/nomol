import { useEffect, useState } from 'react';

export type CameraState =
  | { status: 'starting' }
  | { status: 'ready'; stream: MediaStream }
  | { status: 'error'; message: string };

/**
 * The chosen camera, or the back camera by default. Video only.
 *
 * `smooth` insists on 60 fps at 720p: asked for 1080p at an ideal 60, phones delivered 1080p at
 * 22–33 fps, and in dim gyms they lengthen the exposure, which blurs fast elements. Not every
 * camera can, so the sharpest picture at any frame rate is the fallback.
 */
function constraints(deviceId: string | null, smooth: boolean): MediaStreamConstraints {
  // Zoom isn't in TypeScript's DOM types yet. Chrome only reports zoom (and with it the
  // ultra-wide lens) when asked for it.
  const video: MediaTrackConstraints & { zoom: boolean } = {
    ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: 'environment' }),
    ...(smooth
      ? { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { min: 50, ideal: 60 } }
      : { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 60 } }),
    zoom: true,
  };
  return { audio: false, video };
}

function open(deviceId: string | null) {
  return navigator.mediaDevices
    .getUserMedia(constraints(deviceId, true))
    .catch(() => navigator.mediaDevices.getUserMedia(constraints(deviceId, false)));
}

/** Opens `deviceId`, falling back to the default camera if it's gone (e.g. a saved choice). */
export default function useCamera(deviceId: string | null): CameraState {
  const [state, setState] = useState<CameraState>({ status: 'starting' });

  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;

    open(deviceId)
      .catch((error: unknown) => {
        if (!deviceId) throw error;
        return open(null);
      })
      .then((result) => {
        if (cancelled) {
          result.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = result;
        setState({ status: 'ready', stream: result });
      })
      .catch((_error: unknown) => {
        if (!cancelled) {
          setState({
            status: 'error',
            message: 'Kamera nicht verfügbar. Erlaube den Kamerazugriff und lade die Seite neu.',
          });
        }
      });

    return () => {
      cancelled = true;
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [deviceId]);

  return state;
}
