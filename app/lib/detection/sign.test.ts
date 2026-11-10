import { makePose } from '~/tests/poses';
import { isStartSign } from './sign';

describe('isStartSign', () => {
  it('accepts forearms crossed above the head, facing the camera', () => {
    expect(isStartSign(makePose({ x: 0.5, feetY: 0.9, kind: 'sign' }))).toBe(true);
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
