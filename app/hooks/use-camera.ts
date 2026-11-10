import { useEffect, useState } from 'react';

export type CameraState =
  | { status: 'starting' }
  | { status: 'ready'; stream: MediaStream }
  | { status: 'error'; message: string };

/** Back camera of the tablet, as sharp and smooth as it allows. Video only. */
const CONSTRAINTS: MediaStreamConstraints = {
  audio: false,
  video: {
    facingMode: 'environment',
    width: { ideal: 1920 },
    height: { ideal: 1080 },
    frameRate: { ideal: 60 },
  },
};

export default function useCamera(): CameraState {
  const [state, setState] = useState<CameraState>({ status: 'starting' });

  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;

    navigator.mediaDevices
      .getUserMedia(CONSTRAINTS)
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
  }, []);

  return state;
}
