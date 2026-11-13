import type { Clip } from './clip';
import { exportBaseName, exportData } from './export';

describe('exportBaseName', () => {
  it('uses the local start time, safe for file names', () => {
    expect(exportBaseName(new Date(2026, 10, 10, 17, 5, 2))).toBe('nomol-2026-11-10_17-05-02');
  });
});

describe('exportData', () => {
  it('contains what is needed to replay the detection', () => {
    const clip: Clip = {
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
