import type { RunUp } from '@nomol/core/detection/session';
import type { Zone } from '@nomol/core/detection/zone';
import {
  SETTINGS_KEYS,
  formatSoundOn,
  formatWide,
  parseRunUp,
  parseSoundOn,
  parseWide,
  parseZone,
} from '@nomol/core/settings';
import Storage from 'expo-sqlite/kv-store';

// Synchronous like the web app's local storage, so settings are there on the first render.
// Everything here belongs to this device and where it's mounted.

export function loadZone(): Zone {
  return parseZone(Storage.getItemSync(SETTINGS_KEYS.zone));
}

export function saveZone(zone: Zone) {
  Storage.setItemSync(SETTINGS_KEYS.zone, JSON.stringify(zone));
}

export function loadRunUp(): RunUp | null {
  return parseRunUp(Storage.getItemSync(SETTINGS_KEYS.runUp));
}

export function saveRunUp(runUp: RunUp | null) {
  if (runUp) Storage.setItemSync(SETTINGS_KEYS.runUp, runUp);
  else Storage.removeItemSync(SETTINGS_KEYS.runUp);
}

export function loadCameraId(): string | null {
  return Storage.getItemSync(SETTINGS_KEYS.camera);
}

export function saveCameraId(id: string) {
  Storage.setItemSync(SETTINGS_KEYS.camera, id);
}

export function loadWide(): boolean {
  return parseWide(Storage.getItemSync(SETTINGS_KEYS.zoom));
}

export function saveWide(wide: boolean) {
  Storage.setItemSync(SETTINGS_KEYS.zoom, formatWide(wide));
}

export function loadSoundOn(): boolean {
  return parseSoundOn(Storage.getItemSync(SETTINGS_KEYS.sound));
}

export function saveSoundOn(on: boolean) {
  Storage.setItemSync(SETTINGS_KEYS.sound, formatSoundOn(on));
}
