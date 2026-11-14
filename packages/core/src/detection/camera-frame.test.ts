import { makePose } from '../tests/poses';
import { bufferCrop, cropArea, posesInArea, unmirrorPose } from './camera-frame';
import { LM } from './pose';

describe('bufferCrop', () => {
  // A 4:3 sensor buffer; a phone held upright shows it turned 90° clockwise.
  const width = 1280;
  const height = 960;

  it('takes the area as it is when the buffer is upright', () => {
    const area = { left: 0.25, top: 0.5, right: 0.75, bottom: 1 };
    expect(bufferCrop(area, width, height, { rotation: 0, mirrored: false })).toEqual({
      x: 320,
      y: 480,
      width: 640,
      height: 480,
    });
  });

  it("finds the picture's top left corner at the buffer's bottom left when turned 90°", () => {
    const area = { left: 0, top: 0, right: 0.5, bottom: 0.25 };
    expect(bufferCrop(area, width, height, { rotation: 90, mirrored: false })).toEqual({
      x: 0,
      y: 480,
      width: 320,
      height: 480,
    });
  });

  it("finds the picture's top left corner at the buffer's top right when turned 270°", () => {
    const area = { left: 0, top: 0, right: 0.5, bottom: 0.25 };
    expect(bufferCrop(area, width, height, { rotation: 270, mirrored: false })).toEqual({
      x: 960,
      y: 0,
      width: 320,
      height: 480,
    });
  });

  it('flips a mirrored picture back', () => {
    const area = { left: 0, top: 0, right: 0.25, bottom: 0.5 };
    expect(bufferCrop(area, width, height, { rotation: 0, mirrored: true })).toEqual({
      x: 960,
      y: 0,
      width: 320,
      height: 480,
    });
  });

  it('stays inside the buffer', () => {
    const area = { left: -0.2, top: 0.9, right: 0.3, bottom: 1.3 };
    expect(bufferCrop(area, width, height, { rotation: 180, mirrored: false })).toEqual({
      x: 896,
      y: 0,
      width: 384,
      height: 96,
    });
  });

  it('is undone by cropArea in every orientation', () => {
    const area = { left: 0.1, top: 0.2, right: 0.6, bottom: 0.9 };
    for (const rotation of [0, 90, 180, 270]) {
      for (const mirrored of [false, true]) {
        const crop = bufferCrop(area, width, height, { rotation, mirrored });
        const back = cropArea(crop, width, height, { rotation, mirrored });
        expect(back.left).toBeCloseTo(area.left, 2);
        expect(back.top).toBeCloseTo(area.top, 2);
        expect(back.right).toBeCloseTo(area.right, 2);
        expect(back.bottom).toBeCloseTo(area.bottom, 2);
      }
    }
  });
});

describe('posesInArea', () => {
  it('places landmarks of the crop in the picture', () => {
    const landmarks = Array.from({ length: 2 * 33 }, (_, i) => [0.5, i % 33 === 0 ? 0 : 1, 0.9])
      .flat()
      .map((value, i) => (i === 33 * 3 ? 0 : value));
    const poses = posesInArea(landmarks, { left: 0.2, top: 0.4, right: 0.6, bottom: 0.8 });
    expect(poses).toHaveLength(2);
    expect(poses[0][0]).toEqual({ x: 0.4, y: 0.4, visibility: 0.9 });
    expect(poses[0][1].y).toBeCloseTo(0.8);
    expect(poses[1][0].x).toBeCloseTo(0.2);
  });
});

describe('unmirrorPose', () => {
  it('turns what MediaPipe sees in a mirrored picture into the person as recorded', () => {
    // Someone at 0.3 facing the camera looks, mirrored, like a person facing it at 0.7.
    const recorded = makePose({ x: 0.3, feetY: 0.9 });
    const seen = makePose({ x: 0.7, feetY: 0.9 });
    const unmirrored = unmirrorPose(seen);
    unmirrored.forEach((landmark, i) => {
      expect(landmark.x).toBeCloseTo(recorded[i].x);
      expect(landmark.y).toBeCloseTo(recorded[i].y);
    });
  });

  it("swaps the body's sides, landmark by landmark", () => {
    const pose = Array.from({ length: 33 }, (_, i) => ({ x: 0.5, y: 0.5, visibility: i / 100 }));
    const swapped = unmirrorPose(pose).map((landmark) =>
      Math.round((landmark.visibility ?? 0) * 100),
    );
    expect(swapped[LM.nose]).toBe(LM.nose);
    expect(swapped[LM.leftEye]).toBe(LM.rightEye);
    expect(swapped[1]).toBe(4);
    expect(swapped[6]).toBe(3);
    expect(swapped[LM.leftEar]).toBe(LM.rightEar);
    expect(swapped[LM.rightWrist]).toBe(LM.leftWrist);
    expect(swapped[LM.leftAnkle]).toBe(LM.rightAnkle);
    expect(swapped[32]).toBe(31);
    expect(unmirrorPose(unmirrorPose(pose))).toEqual(pose);
  });
});
