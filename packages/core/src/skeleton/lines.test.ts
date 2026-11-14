import { LM } from '../detection/pose';
import { makePose } from '../tests/poses';
import { LIMB_COLORS, skeletonLines } from './lines';

describe('skeletonLines', () => {
  it('draws body, limbs, head and neck of a fully visible pose', () => {
    const lines = skeletonLines(makePose({ x: 0.5, feetY: 0.9 }));
    // 12 bones, 4 head lines, the neck.
    expect(lines).toHaveLength(17);
    expect(lines.filter(([, , color]) => color === LIMB_COLORS.leftLeg)).toHaveLength(2);
  });

  it('leaves out lines to points MediaPipe can not see', () => {
    const pose = makePose({ x: 0.5, feetY: 0.9 });
    pose[LM.leftKnee] = { ...pose[LM.leftKnee], visibility: 0.1 };
    pose[LM.nose] = { ...pose[LM.nose], visibility: 0.1 };
    const lines = skeletonLines(pose);
    // Both left leg bones, two head lines and the neck go.
    expect(lines).toHaveLength(12);
  });
});
