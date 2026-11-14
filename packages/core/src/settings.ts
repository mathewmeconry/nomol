import z from 'zod';
import type { RunUp } from './detection/session';
import type { Zone } from './detection/zone';

/**
 * Per-device settings as both apps store them (as strings, under the same keys), parsed here so
 * a broken or outdated value falls back the same way everywhere.
 */
export const SETTINGS_KEYS = {
  zone: 'nomol.zone',
  runUp: 'nomol.runUp',
  camera: 'nomol.camera',
  zoom: 'nomol.zoom',
  sound: 'nomol.sound',
} as const;

/** Lower middle of the picture: a reasonable guess until the coach draws the real zone. */
export const DEFAULT_ZONE: Zone = { left: 0.3, top: 0.35, right: 0.7, bottom: 0.95 };

const unit = z.number().min(0).max(1);
export const zoneSchema = z
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

const runUpSchema = z.enum(['left', 'right', 'any']);

/** Anything but a known automatic start means starting with the sign. */
export function parseRunUp(raw: unknown): RunUp | null {
  const result = runUpSchema.safeParse(raw);
  return result.success ? result.data : null;
}

/** The start beep is on unless switched off. */
export function parseSoundOn(raw: string | null): boolean {
  return raw !== 'off';
}

export function formatSoundOn(on: boolean): string {
  return on ? 'on' : 'off';
}

/** The ultra-wide lens (lowest zoom) is off unless switched on. */
export function parseWide(raw: string | null): boolean {
  return raw === 'wide';
}

export function formatWide(wide: boolean): string {
  return wide ? 'wide' : 'normal';
}
