import { describe, expect, it } from 'vitest';
import { makePose } from '../tests/poses';
import { tracePreroll, type Seen } from './preroll';

describe('tracePreroll', () => {
  const runner = (t: number) => makePose({ x: 0.1 + (0.5 * t) / 1000, feetY: 0.9 });
  const bystander = makePose({ x: 0.55, feetY: 0.9 });
  // A still was kept of every other frame.
  const seen: Seen<string>[] = [0, 100, 200, 300, 400].map((time) => ({
    time,
    poses: [bystander, runner(time)],
    kept: time % 200 === 0 ? `${time}.jpg` : null,
  }));
  const start = runner(500);

  it('gives the runner before the trigger with what was kept of each frame', () => {
    const traced = tracePreroll(seen, 0, start, [bystander, start], 500, 1, 'left');
    expect(traced.map((frame) => frame.time)).toEqual([0, 100, 200, 300, 400]);
    expect(traced.every((frame, i) => frame.pose === seen[i].poses[1])).toBe(true);
    expect(traced.map((frame) => frame.kept)).toEqual(['0.jpg', null, '200.jpg', null, '400.jpg']);
  });

  it('leaves out what was before the video', () => {
    const traced = tracePreroll(seen, 250, start, [bystander, start], 500, 1, 'left');
    expect(traced.map((frame) => frame.time)).toEqual([300, 400]);
  });
});
