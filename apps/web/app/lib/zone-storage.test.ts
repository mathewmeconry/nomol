import { DEFAULT_ZONE } from '@nomol/core/settings';
import { loadRunUp, loadZones, saveRunUp, saveZones } from './zone-storage';

describe('zone storage', () => {
  it('round-trips saved zones', () => {
    const zones = [
      { left: 0.1, top: 0.2, right: 0.3, bottom: 0.9 },
      { left: 0.6, top: 0.2, right: 0.8, bottom: 0.9 },
    ];
    saveZones(zones);
    expect(loadZones()).toEqual(zones);
  });

  it('falls back to the default zone for broken data', () => {
    localStorage.setItem('nomol.zone', 'not json');
    expect(loadZones()).toEqual([DEFAULT_ZONE]);
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
