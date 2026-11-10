import { frameAt, frameDuration, timelineThumbnails, type Clip, type ClipFrame } from './clip';

const frames: ClipFrame[] = [0, 33, 66, 100].map((time) => ({ time, pose: [] }));

function clip(overrides: Partial<Clip>): Clip {
  return {
    id: 'clip',
    url: 'blob:clip',
    startedAt: new Date(0),
    durationMs: 1000,
    frames: [],
    thumbnails: [],
    ...overrides,
  };
}

describe('frameAt', () => {
  it('returns the closest frame', () => {
    expect(frameAt(frames, 40)?.time).toBe(33);
    expect(frameAt(frames, 60)?.time).toBe(66);
  });

  it('clamps to the first and last frame', () => {
    expect(frameAt(frames, -10)?.time).toBe(0);
    expect(frameAt(frames, 500)?.time).toBe(100);
  });

  it('returns null without frames', () => {
    expect(frameAt([], 10)).toBeNull();
  });
});

describe('frameDuration', () => {
  it('measures the camera frame rate from the recorded frames', () => {
    const at60fps = Array.from({ length: 61 }, (_, i) => ({ time: (i * 1000) / 60, pose: [] }));
    expect(frameDuration(clip({ frames: at60fps }))).toBeCloseTo(1000 / 60);
  });

  it('ignores gaps where the gymnast was not detected', () => {
    const at24fps = Array.from({ length: 48 }, (_, i) => ({ time: (i * 1000) / 24, pose: [] }));
    const withGap = [...at24fps.slice(0, 20), ...at24fps.slice(30)];
    expect(frameDuration(clip({ frames: withGap }))).toBeCloseTo(1000 / 24);
  });

  it('falls back to 30 fps without enough frames', () => {
    expect(frameDuration(clip({ frames: [] }))).toBeCloseTo(1000 / 30);
  });
});

describe('timelineThumbnails', () => {
  it('picks one thumbnail per slot, spread over the clip', () => {
    const thumbnails = Array.from({ length: 50 }, (_, i) => ({ time: i * 20, url: `t${i}` }));
    const picked = timelineThumbnails(clip({ durationMs: 1000, thumbnails }), 5);
    expect(picked.map((t) => t.time)).toEqual([100, 300, 500, 700, 900]);
  });

  it('returns nothing for a clip without thumbnails', () => {
    expect(timelineThumbnails(clip({}), 5)).toEqual([]);
  });
});
