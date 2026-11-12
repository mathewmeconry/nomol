import { DEFAULT_ZONE, loadRunUp, loadZone, parseZone, saveRunUp, saveZone } from './zone-storage';

describe('zone storage', () => {
  it('round-trips a saved zone', () => {
    const zone = { left: 0.1, top: 0.2, right: 0.5, bottom: 0.9 };
    saveZone(zone);
    expect(loadZone()).toEqual(zone);
  });

  it('falls back to the default zone for missing or broken data', () => {
    expect(parseZone(null)).toEqual(DEFAULT_ZONE);
    expect(parseZone('not json')).toEqual(DEFAULT_ZONE);
    expect(parseZone('{"left":0.5,"top":0.2,"right":0.4,"bottom":0.9}')).toEqual(DEFAULT_ZONE);
  });

  it('remembers the automatic start, off by default', () => {
    expect(loadRunUp()).toBeNull();
    saveRunUp('right');
    expect(loadRunUp()).toBe('right');
    saveRunUp(null);
    expect(loadRunUp()).toBeNull();
    localStorage.setItem('nomol.runUp', 'up');
    expect(loadRunUp()).toBeNull();
  });
});
