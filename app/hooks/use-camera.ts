import { useEffect, useState } from 'react';

export type CameraState =
  | { status: 'starting' }
  | { status: 'ready'; stream: MediaStream }
  | { status: 'error'; message: string };

/**
 * The chosen camera, or the back camera by default, as sharp and smooth as it allows. Video only.
 */
function constraints(deviceId: string | null): MediaStreamConstraints {
  return {
    audio: false,
    video: {
      ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: 'environment' }),
      width: { ideal: 1920 },
      height: { ideal: 1080 },
      frameRate: { ideal: 60 },
    },
  };
}

/** Opens `deviceId`, falling back to the default camera if it's gone (e.g. a saved choice). */
export default function useCamera(deviceId: string | null): CameraState {
  const [state, setState] = useState<CameraState>({ status: 'starting' });

  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;

    navigator.mediaDevices
      .getUserMedia(constraints(deviceId))
      .catch((error: unknown) => {
        if (!deviceId) throw error;
        return navigator.mediaDevices.getUserMedia(constraints(null));
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
