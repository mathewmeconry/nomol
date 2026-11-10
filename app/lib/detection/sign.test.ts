import { makePose } from '~/tests/poses';
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

  it('rejects poses with hidden wrists', () => {
    const pose = makePose({ x: 0.5, feetY: 0.9, kind: 'sign' });
    pose[15] = { ...pose[15], visibility: 0.1 };
    expect(isStartSign(pose)).toBe(false);
  });
});
