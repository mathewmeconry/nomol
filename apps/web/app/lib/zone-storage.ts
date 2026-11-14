import type { RunUp } from '@nomol/core/detection/session';
import type { Zone } from '@nomol/core/detection/zone';
import { SETTINGS_KEYS, parseRunUp, parseZone } from '@nomol/core/settings';

/** The zone belongs to this tablet and its camera position, so it lives in local storage. */
export function loadZone(): Zone {
  return parseZone(localStorage.getItem(SETTINGS_KEYS.zone));
}

export function saveZone(zone: Zone) {
  localStorage.setItem(SETTINGS_KEYS.zone, JSON.stringify(zone));
}

/** Automatic start belongs to the apparatus the device is set up at, like the zone. */
export function loadRunUp(): RunUp | null {
  return parseRunUp(localStorage.getItem(SETTINGS_KEYS.runUp));
}

export function saveRunUp(runUp: RunUp | null) {
  if (runUp) localStorage.setItem(SETTINGS_KEYS.runUp, runUp);
  else localStorage.removeItem(SETTINGS_KEYS.runUp);
}
