import {
  DEFAULT_ZONE,
  formatSoundOn,
  formatWide,
  parseRunUp,
  parseSoundOn,
  parseWide,
  parseZones,
} from './settings';

describe('settings', () => {
  it('parses saved zones', () => {
    const zones = [
      { left: 0.1, top: 0.2, right: 0.3, bottom: 0.9 },
      { left: 0.6, top: 0.2, right: 0.8, bottom: 0.9 },
    ];
    expect(parseZones(JSON.stringify(zones))).toEqual(zones);
  });

  it('takes the one zone saved before there could be several', () => {
    const zone = { left: 0.1, top: 0.2, right: 0.5, bottom: 0.9 };
    expect(parseZones(JSON.stringify(zone))).toEqual([zone]);
  });

  it('falls back to the default zone for missing or broken data', () => {
    const zone = { left: 0.1, top: 0.2, right: 0.5, bottom: 0.9 };
    expect(parseZones(null)).toEqual([DEFAULT_ZONE]);
    expect(parseZones('not json')).toEqual([DEFAULT_ZONE]);
    expect(parseZones('[]')).toEqual([DEFAULT_ZONE]);
    expect(parseZones(JSON.stringify([zone, zone, zone]))).toEqual([DEFAULT_ZONE]);
    expect(parseZones('{"left":0.5,"top":0.2,"right":0.4,"bottom":0.9}')).toEqual([DEFAULT_ZONE]);
    expect(parseZones('[{"left":-0.1,"top":0.2,"right":0.4,"bottom":0.9}]')).toEqual([
      DEFAULT_ZONE,
    ]);
  });

  it('starts with the sign unless an automatic start is stored', () => {
    expect(parseRunUp('left')).toBe('left');
    expect(parseRunUp('any')).toBe('any');
    expect(parseRunUp(null)).toBeNull();
    expect(parseRunUp('up')).toBeNull();
    expect(parseRunUp('sign')).toBeNull();
  });

  it('keeps the beep on and the wide angle off by default', () => {
    expect(parseSoundOn(null)).toBe(true);
    expect(parseSoundOn(formatSoundOn(false))).toBe(false);
    expect(parseSoundOn(formatSoundOn(true))).toBe(true);
    expect(parseWide(null)).toBe(false);
    expect(parseWide(formatWide(true))).toBe(true);
    expect(parseWide(formatWide(false))).toBe(false);
  });
});
