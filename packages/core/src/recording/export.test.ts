import type { Clip } from './clip';
import { exportBaseName, exportData, parseExport } from './export';

const CLIP: Clip = {
  id: 'clip',
  url: 'blob:clip',
  startedAt: new Date('2026-11-10T16:05:02Z'),
  durationMs: 8000,
  frames: [{ time: 0, pose: [{ x: 0.5, y: 0.5, visibility: 1 }] }],
  skeleton: [{ time: 0, pose: [{ x: 0.4, y: 0.5, visibility: 1 }] }],
  thumbnail: 'data:image/jpeg;base64,abc',
  zone: { left: 0.3, top: 0.35, right: 0.7, bottom: 0.95 },
  aspectRatio: 16 / 9,
  recordedWith: { appVersion: 'abc1234', startReason: 'runUp', runUp: 'left' },
};

describe('exportBaseName', () => {
  it('uses the local start time, safe for file names', () => {
    expect(exportBaseName(new Date(2026, 10, 10, 17, 5, 2))).toBe('nomol-2026-11-10_17-05-02');
  });
});

describe('exportData', () => {
  it('contains what is needed to replay the detection', () => {
    const clip = CLIP;
    expect(exportData(clip, 'test-agent')).toEqual({
      version: 3,
      appVersion: 'abc1234',
      startReason: 'runUp',
      runUp: 'left',
      startedAt: '2026-11-10T16:05:02.000Z',
      durationMs: 8000,
      aspectRatio: 16 / 9,
      zone: clip.zone,
      userAgent: 'test-agent',
      frames: clip.frames,
      skeleton: clip.skeleton,
    });
  });
});

describe('parseExport', () => {
  it('reads back an export after a trip through JSON', () => {
    const { id: _id, url: _url, thumbnail: _thumbnail, ...stored } = CLIP;
    const json = JSON.parse(JSON.stringify(exportData(CLIP, 'test-agent')));
    expect(parseExport(json)).toEqual(stored);
  });

  it('leaves out how it was recorded when the export does not say', () => {
    const json = { ...exportData(CLIP, 'test-agent'), appVersion: null, startReason: null };
    expect(parseExport(json)?.recordedWith).toBeUndefined();
  });

  it('still reads a clip with a NaN in a frame or its duration, without that frame', () => {
    const clip: Clip = {
      ...CLIP,
      durationMs: NaN,
      frames: [...CLIP.frames, { time: 40, pose: [{ x: NaN, y: 0.5, visibility: 1 }] }],
      skeleton: [...CLIP.skeleton, { time: Infinity, pose: [{ x: 0.4, y: 0.5 }] }],
    };
    const parsed = parseExport(JSON.parse(JSON.stringify(exportData(clip, 'test-agent'))));
    expect(parsed?.durationMs).toBe(0);
    expect(parsed?.frames).toEqual(CLIP.frames);
    expect(parsed?.skeleton).toEqual(CLIP.skeleton);
  });

  it('refuses other versions and broken data', () => {
    expect(parseExport({ ...exportData(CLIP, 'test-agent'), version: 2 })).toBeNull();
    expect(parseExport({ ...exportData(CLIP, 'test-agent'), zone: null })).toBeNull();
    expect(parseExport('nonsense')).toBeNull();
  });
});
