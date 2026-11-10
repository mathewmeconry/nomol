import { frameDuration, poseAt, type Clip, type ClipFrame } from './clip';

/** One-landmark poses whose x equals the frame time, so interpolation is easy to read. */
const frames: ClipFrame[] = [0, 40, 80, 400].map((time) => ({
  time,
  pose: [{ x: time, y: 0, visibility: 1 }],
}));

function clip(overrides: Partial<Clip>): Clip {
  return {
    id: 'clip',
    url: 'blob:clip',
    startedAt: new Date(0),
    durationMs: 1000,
    frames: [],
    thumbnail: null,
    ...overrides,
  };
}

describe('poseAt', () => {
  it('interpolates between the neighbouring frames', () => {
    expect(poseAt(frames, 10)?.[0].x).toBeCloseTo(10);
    expect(poseAt(frames, 60)?.[0].x).toBeCloseTo(60);
  });

  it('returns a frame exactly at its time', () => {
    expect(poseAt(frames, 40)?.[0].x).toBe(40);
  });

  it('takes the nearest frame across a gap without detections', () => {
    expect(poseAt(frames, 120)?.[0].x).toBe(80);
    expect(poseAt(frames, 380)?.[0].x).toBe(400);
  });

  it('clamps to the first and last frame', () => {
    expect(poseAt(frames, -10)?.[0].x).toBe(0);
    expect(poseAt(frames, 500)?.[0].x).toBe(400);
  });

  it('returns null without frames', () => {
    expect(poseAt([], 10)).toBeNull();
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
