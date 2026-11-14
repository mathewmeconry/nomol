/**
 * The heavy model is preferred: on a handstand recording it found the gymnast in every frame
 * where lite lost them in a fifth, and got upside-down poses right more often. It is ~3.5×
 * slower, so on devices where it takes longer than this per frame, lite takes over. Slower than
 * that, the sign and tracking get sluggish, and the automatic start missed runs below ~5
 * detections per second.
 */
const SLOW_MS = 100;
/**
 * Heavy is measured over this much detection time (median), again and again: phones slow down
 * as they heat up. A Pixel 8 took 25 ms per frame at first and 100–300 ms after ~45 minutes.
 */
const MEASURE_MS = 3000;

/**
 * Adds one detection's time to `timings`. Once they add up to `MEASURE_MS`, tells whether their
 * median was too slow for the heavy model and starts the next measurement.
 */
export function measureSpeed(timings: number[], ms: number): { timings: number[]; slow: boolean } {
  const next = [...timings, ms];
  if (next.reduce((sum, value) => sum + value, 0) < MEASURE_MS) {
    return { timings: next, slow: false };
  }
  const median = next.sort((a, b) => a - b)[Math.floor(next.length / 2)];
  return { timings: [], slow: median > SLOW_MS };
}
