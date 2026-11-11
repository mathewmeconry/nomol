import { makePose } from '~/tests/poses';
import {
  frameDuration,
  insertFrame,
  poseAt,
  routineRange,
  type Clip,
  type ClipFrame,
} from './clip';

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
    skeleton: [],
    thumbnail: null,
    zone: { left: 0, top: 0, right: 1, bottom: 1 },
    aspectRatio: 16 / 9,
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

  it('takes the nearest frame at the edge of a gap without detections', () => {
    expect(poseAt(frames, 120)?.[0].x).toBe(80);
    expect(poseAt(frames, 380)?.[0].x).toBe(400);
  });

  it('shows nothing in the middle of a gap', () => {
    // E.g. a part of the skeleton that isn't computed yet.
    expect(poseAt(frames, 240)).toBeNull();
  });

  it('extends the first and last frame only a little', () => {
    expect(poseAt(frames, -10)?.[0].x).toBe(0);
    expect(poseAt(frames, 450)?.[0].x).toBe(400);
    expect(poseAt(frames, 600)).toBeNull();
  });

  it('returns null without frames', () => {
    expect(poseAt([], 10)).toBeNull();
  });
});

describe('insertFrame', () => {
  it('keeps frames in time order', () => {
    const at = (time: number) => ({ time, pose: [] });
    const frames = insertFrame(insertFrame([at(100), at(300)], at(200)), at(0));
    expect(frames.map((f) => f.time)).toEqual([0, 100, 200, 300]);
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

describe('routineRange', () => {
  /** Stands until 4 s, does elements from 4 s to 8 s, then stands until 20 s. */
  const routine = clip({
    durationMs: 20_000,
    zone: { left: 0.3, top: 0.3, right: 0.6, bottom: 0.9 },
    aspectRatio: 1,
    frames: Array.from({ length: 200 }, (_, i) => {
      const time = i * 100;
      return {
        time,
        pose: makePose({ x: 0.45, feetY: 0.9, lift: time >= 4000 && time <= 8000 ? 0.3 : 0 }),
      };
    }),
  });

  it('cuts the wait before and the idle time after the routine', () => {
    expect(routineRange(routine)).toEqual({ startMs: 2500, endMs: 10_000 });
  });

  it('keeps the whole clip when no element was recognized', () => {
    const standing = clip({ ...routine, frames: routine.frames.slice(0, 30) });
    expect(routineRange(standing)).toEqual({ startMs: 0, endMs: 20_000 });
  });
});
