import { useEffect, useState } from 'react';

/**
 * Cameras of the device, e.g. normal and ultra-wide lens. Browsers only reveal names after camera
 * access was granted, so this waits for the first stream.
 */
export default function useCameras(accessGranted: boolean): MediaDeviceInfo[] {
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);

  useEffect(() => {
    if (!accessGranted) return;
    function update() {
      void navigator.mediaDevices
        .enumerateDevices()
        .then((devices) => setCameras(devices.filter((device) => device.kind === 'videoinput')));
    }
    update();
    navigator.mediaDevices.addEventListener('devicechange', update);
    return () => navigator.mediaDevices.removeEventListener('devicechange', update);
  }, [accessGranted]);

  return cameras;
}
