import {
  DEFAULT_ZONE,
  formatSoundOn,
  formatWide,
  parseRunUp,
  parseSoundOn,
  parseWide,
  parseZone,
} from './settings';

describe('settings', () => {
  it('parses a saved zone', () => {
    const zone = { left: 0.1, top: 0.2, right: 0.5, bottom: 0.9 };
    expect(parseZone(JSON.stringify(zone))).toEqual(zone);
  });

  it('falls back to the default zone for missing or broken data', () => {
    expect(parseZone(null)).toEqual(DEFAULT_ZONE);
    expect(parseZone('not json')).toEqual(DEFAULT_ZONE);
    expect(parseZone('{"left":0.5,"top":0.2,"right":0.4,"bottom":0.9}')).toEqual(DEFAULT_ZONE);
    expect(parseZone('{"left":-0.1,"top":0.2,"right":0.4,"bottom":0.9}')).toEqual(DEFAULT_ZONE);
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
