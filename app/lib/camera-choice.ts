const STORAGE_KEY = 'nomol.camera';
const ZOOM_KEY = 'nomol.zoom';

/** The chosen camera belongs to this device, like the start zone, so it lives in local storage. */
export function loadCameraId(): string | null {
  return localStorage.getItem(STORAGE_KEY);
}

export function saveCameraId(deviceId: string) {
  localStorage.setItem(STORAGE_KEY, deviceId);
}

export function loadWide(): boolean {
  return localStorage.getItem(ZOOM_KEY) === 'wide';
}

export function saveWide(wide: boolean) {
  localStorage.setItem(ZOOM_KEY, wide ? 'wide' : 'normal');
}
