import { SETTINGS_KEYS, formatWide, parseWide } from '@nomol/core/settings';

/** The chosen camera belongs to this device, like the start zone, so it lives in local storage. */
export function loadCameraId(): string | null {
  return localStorage.getItem(SETTINGS_KEYS.camera);
}

export function saveCameraId(deviceId: string) {
  localStorage.setItem(SETTINGS_KEYS.camera, deviceId);
}

export function loadWide(): boolean {
  return parseWide(localStorage.getItem(SETTINGS_KEYS.zoom));
}

export function saveWide(wide: boolean) {
  localStorage.setItem(SETTINGS_KEYS.zoom, formatWide(wide));
}
