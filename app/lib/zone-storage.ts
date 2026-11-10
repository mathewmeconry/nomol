import z from 'zod';
import type { Zone } from '~/lib/detection/zone';

const STORAGE_KEY = 'nomol.zone';

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
