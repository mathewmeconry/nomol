import z from 'zod';
import type { RunUp } from '~/lib/detection/session';
import type { Zone } from '~/lib/detection/zone';

const STORAGE_KEY = 'nomol.zone';
const RUN_UP_KEY = 'nomol.runUp';

/** Lower middle of the picture: a reasonable guess until the coach draws the real zone. */
export const DEFAULT_ZONE: Zone = { left: 0.3, top: 0.35, right: 0.7, bottom: 0.95 };

const unit = z.number().min(0).max(1);
const zoneSchema = z
  .object({ left: unit, top: unit, right: unit, bottom: unit })
  .refine((zone) => zone.left < zone.right && zone.top < zone.bottom);

export function parseZone(raw: string | null): Zone {
  if (!raw) return DEFAULT_ZONE;
  try {
    const result = zoneSchema.safeParse(JSON.parse(raw));
    return result.success ? result.data : DEFAULT_ZONE;
  } catch (_error) {
    return DEFAULT_ZONE;
  }
}

/** The zone belongs to this tablet and its camera position, so it lives in local storage. */
export function loadZone(): Zone {
  return parseZone(localStorage.getItem(STORAGE_KEY));
}

export function saveZone(zone: Zone) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(zone));
}

/** Automatic start belongs to the apparatus the device is set up at, like the zone. */
export function loadRunUp(): RunUp | null {
  const result = z.enum(['left', 'right']).safeParse(localStorage.getItem(RUN_UP_KEY));
  return result.success ? result.data : null;
}

export function saveRunUp(runUp: RunUp | null) {
  if (runUp) localStorage.setItem(RUN_UP_KEY, runUp);
  else localStorage.removeItem(RUN_UP_KEY);
}
