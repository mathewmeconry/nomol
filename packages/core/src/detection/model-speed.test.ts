import { measureSpeed } from './model-speed';

function run(times: number[]) {
  let timings: number[] = [];
  const slow: boolean[] = [];
  for (const ms of times) {
    const result = measureSpeed(timings, ms);
    timings = result.timings;
    slow.push(result.slow);
  }
  return { timings, slow };
}

describe('measureSpeed', () => {
  it('keeps measuring until 3 s of detection time', () => {
    const { timings, slow } = run(Array<number>(29).fill(100));
    expect(timings).toHaveLength(29);
    expect(slow.some(Boolean)).toBe(false);
  });

  it('finds a slow model by the median, not single outliers', () => {
    expect(run([...Array<number>(30).fill(30), 3000]).slow.at(-1)).toBe(false);
    expect(run(Array<number>(25).fill(120)).slow.at(-1)).toBe(true);
  });

  it('starts over after each measurement, as phones slow down when warm', () => {
    // 100 × 30 ms is the first measurement, 20 × 150 ms the second.
    const { timings, slow } = run([...Array<number>(100).fill(30), ...Array<number>(20).fill(150)]);
    expect(slow.indexOf(true)).toBe(119);
    expect(timings).toEqual([]);
  });
});
