import { LM } from '~/lib/detection/pose';
import { makePose } from '~/tests/poses';
import { INPUT_HEIGHT, INPUT_WIDTH, cropAround, decode, toInput } from './rtmpose';

describe('cropAround', () => {
  it("doesn't shrink when the current pose collapsed onto part of the body", () => {
    const whole = makePose({ x: 0.5, feetY: 0.9 });
    const collapsed = whole.map((p) => ({ ...p, y: 0.85 + (p.y - 0.85) * 0.2 }));
    const crop = cropAround([whole, whole, collapsed], 1280, 720);
    expect(crop.height).toBeCloseTo(cropAround([whole], 1280, 720).height);
  });

  it('centers a 3:4 region on the person, larger than their box', () => {
    const pose = makePose({ x: 0.5, feetY: 0.9 });
    const crop = cropAround([pose], 1280, 720);
    expect(crop.width / crop.height).toBeCloseTo(INPUT_WIDTH / INPUT_HEIGHT);
    expect(crop.x + crop.width / 2).toBeCloseTo(0.5 * 1280, 0);
    // The test pose spans 0.33 of the image height, feet to head.
    expect(crop.height).toBeGreaterThan(0.33 * 720);
  });
});

describe('toInput', () => {
  it('turns RGBA into normalized BGR planes', () => {
    const rgba = new Uint8ClampedArray(INPUT_WIDTH * INPUT_HEIGHT * 4);
    rgba.set([255, 0, 0, 255]); // first pixel red
    const input = toInput(rgba);
    const plane = INPUT_WIDTH * INPUT_HEIGHT;
    expect(input[0]).toBeCloseTo((0 - 123.675) / 58.395); // blue
    expect(input[2 * plane]).toBeCloseTo((255 - 103.53) / 57.375); // red
  });
});

describe('decode', () => {
  const crop = { x: 100, y: 0, width: 300, height: 400 };

  /** Model output with one peak per keypoint at the given grid positions. */
  function output(peaks: [number, number, number][]) {
    const simccX = new Float32Array(17 * INPUT_WIDTH * 2);
    const simccY = new Float32Array(17 * INPUT_HEIGHT * 2);
    peaks.forEach(([bx, by, score], k) => {
      simccX[k * INPUT_WIDTH * 2 + bx] = score;
      simccY[k * INPUT_HEIGHT * 2 + by] = score;
    });
    return { simccX, simccY };
  }

  it('maps keypoints from the crop back into the video, in MediaPipe layout', () => {
    // Nose at the crop's centre, everything else at its top-left corner.
    const peaks = Array.from({ length: 17 }, (): [number, number, number] => [0, 0, 0.9]);
    peaks[0] = [INPUT_WIDTH, INPUT_HEIGHT, 0.9];
    const { simccX, simccY } = output(peaks);
    const pose = decode(simccX, simccY, crop, 1000, 400);
    expect(pose).toHaveLength(33);
    expect(pose[LM.nose]).toEqual({ x: 0.25, y: 0.5, visibility: 1 });
    expect(pose[LM.leftAnkle]).toMatchObject({ x: 0.1, y: 0 });
  });

  it('hides unsure keypoints and the landmarks RTMPose lacks', () => {
    const peaks = Array.from({ length: 17 }, (): [number, number, number] => [10, 10, 0.9]);
    peaks[15] = [10, 10, 0.1]; // left ankle unsure
    const { simccX, simccY } = output(peaks);
    const pose = decode(simccX, simccY, crop, 1000, 400);
    expect(pose[LM.leftAnkle].visibility).toBe(0);
    expect(pose[LM.rightAnkle].visibility).toBe(1);
    expect(pose[19].visibility).toBe(0); // a hand landmark
  });
});
