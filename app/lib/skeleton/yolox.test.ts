import { makePose } from '~/tests/poses';
import { DETECTOR_SIZE, pickBox, readBoxes, toDetectorInput } from './yolox';

describe('toDetectorInput', () => {
  it('turns RGBA into unnormalized BGR planes', () => {
    const rgba = new Uint8ClampedArray(DETECTOR_SIZE * DETECTOR_SIZE * 4);
    rgba.set([10, 20, 30, 255]);
    const input = toDetectorInput(rgba);
    const plane = DETECTOR_SIZE * DETECTOR_SIZE;
    expect([input[0], input[plane], input[2 * plane]]).toEqual([30, 20, 10]);
  });
});

describe('readBoxes', () => {
  it('keeps confident boxes and undoes the input scaling', () => {
    const dets = new Float32Array([10, 20, 110, 220, 0.9, 0, 0, 5, 5, 0.01]);
    expect(readBoxes(dets, 0.5)).toEqual([{ left: 20, top: 40, right: 220, bottom: 440 }]);
  });
});

describe('pickBox', () => {
  // Gymnast around x = 0.5 in a 1000×1000 image, a spotter's box at the right.
  const pose = makePose({ x: 0.5, feetY: 0.9 });
  const gymnast = { left: 430, top: 520, right: 570, bottom: 910 };
  const spotter = { left: 700, top: 500, right: 850, bottom: 910 };

  it("takes the box around the tracked gymnast's torso", () => {
    expect(pickBox([spotter, gymnast], pose, 1000, 1000)).toEqual(gymnast);
  });

  it('prefers the box that matches the gymnast when boxes overlap', () => {
    const huge = { left: 0, top: 0, right: 1000, bottom: 1000 };
    expect(pickBox([huge, gymnast], pose, 1000, 1000)).toEqual(gymnast);
  });

  it('gives up when no box contains the gymnast', () => {
    expect(pickBox([spotter], pose, 1000, 1000)).toBeNull();
  });
});
