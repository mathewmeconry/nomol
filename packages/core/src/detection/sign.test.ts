import { makePose } from '../tests/poses';
import { LM } from './pose';
import { isStartSign } from './sign';

describe('isStartSign', () => {
  it('accepts forearms crossed above the head, facing the camera', () => {
    expect(isStartSign(makePose({ x: 0.5, feetY: 0.9, kind: 'sign' }))).toBe(true);
  });

  it('accepts crossed forearms when the wrists overlap without swapping sides', () => {
    // A real recording: both wrists land on almost the same x, the left one a hair to its side.
    const pose = makePose({ x: 0.5, feetY: 0.9, kind: 'sign' });
    pose[LM.leftWrist] = { ...pose[LM.leftWrist], x: 0.504 };
    pose[LM.rightWrist] = { ...pose[LM.rightWrist], x: 0.5 };
    expect(isStartSign(pose)).toBe(true);
  });

  it('accepts the sign when the shoulders look as narrow as on a real camera', () => {
    // Facing the camera, MediaPipe measured shoulder width / torso length at about 0.43.
    const pose = makePose({ x: 0.5, feetY: 0.9, kind: 'sign' });
    pose[LM.leftShoulder] = { ...pose[LM.leftShoulder], x: 0.5195 };
    pose[LM.rightShoulder] = { ...pose[LM.rightShoulder], x: 0.4805 };
    expect(isStartSign(pose)).toBe(true);
  });

  it('accepts the sign from far away, where MediaPipe is unsure about the crossed wrists', () => {
    // A phone recording shrunk to a third: wrist visibility 0.1–0.2, positions still right.
    const pose = makePose({ x: 0.5, feetY: 0.9, kind: 'sign' });
    pose[LM.leftWrist] = { ...pose[LM.leftWrist], visibility: 0.12 };
    pose[LM.rightWrist] = { ...pose[LM.rightWrist], visibility: 0.08 };
    pose[LM.rightElbow] = { ...pose[LM.rightElbow], visibility: 0.42 };
    expect(isStartSign(pose)).toBe(true);
  });

  it('rejects the sign when the body itself is not visible', () => {
    const pose = makePose({ x: 0.5, feetY: 0.9, kind: 'sign' });
    pose[LM.leftHip] = { ...pose[LM.leftHip], visibility: 0.1 };
    expect(isStartSign(pose)).toBe(false);
  });

  it('rejects hands held together above the head with straight arms', () => {
    const pose = makePose({ x: 0.5, feetY: 0.9, kind: 'sign' });
    pose[LM.leftElbow] = { ...pose[LM.leftElbow], x: 0.52 };
    pose[LM.rightElbow] = { ...pose[LM.rightElbow], x: 0.48 };
    expect(isStartSign(pose)).toBe(false);
  });

  it('rejects raised arms that are not crossed', () => {
    expect(isStartSign(makePose({ x: 0.5, feetY: 0.9, kind: 'armsUp' }))).toBe(false);
  });

  it('rejects arms down', () => {
    expect(isStartSign(makePose({ x: 0.5, feetY: 0.9 }))).toBe(false);
  });

  it('rejects the sign when the person is seen from the side', () => {
    expect(isStartSign(makePose({ x: 0.5, feetY: 0.9, kind: 'sign', side: true }))).toBe(false);
  });
});
