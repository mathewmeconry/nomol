import { frameAt, type ClipFrame } from './clip';

const frames: ClipFrame[] = [0, 33, 66, 100].map((time) => ({ time, pose: [] }));

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
