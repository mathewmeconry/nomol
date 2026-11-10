const STORAGE_KEY = 'nomol.camera';

/** The chosen camera belongs to this device, like the start zone, so it lives in local storage. */
export function loadCameraId(): string | null {
  return localStorage.getItem(STORAGE_KEY);
}

export function saveCameraId(deviceId: string) {
  localStorage.setItem(STORAGE_KEY, deviceId);
}
