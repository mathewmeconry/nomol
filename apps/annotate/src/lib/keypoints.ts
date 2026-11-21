import { LIMB_COLORS } from '@nomol/core/skeleton/lines';
import type { Keypoint } from './tasks';

/** COCO's 17 keypoints, in its order. */
export const KEYPOINTS = [
  'nose',
  'left_eye',
  'right_eye',
  'left_ear',
  'right_ear',
  'left_shoulder',
  'right_shoulder',
  'left_elbow',
  'right_elbow',
  'left_wrist',
  'right_wrist',
  'left_hip',
  'right_hip',
  'left_knee',
  'right_knee',
  'left_ankle',
  'right_ankle',
] as const;

export const KEYPOINT_NAMES = [
  'Nase',
  'linkes Auge',
  'rechtes Auge',
  'linkes Ohr',
  'rechtes Ohr',
  'linke Schulter',
  'rechte Schulter',
  'linker Ellbogen',
  'rechter Ellbogen',
  'linkes Handgelenk',
  'rechtes Handgelenk',
  'linke Hüfte',
  'rechte Hüfte',
  'linkes Knie',
  'rechtes Knie',
  'linker Knöchel',
  'rechter Knöchel',
];

/** For each keypoint the one on the other side (the nose stays). */
const OTHER_SIDE = [0, 2, 1, 4, 3, 6, 5, 8, 7, 10, 9, 12, 11, 14, 13, 16, 15];

/** The skeleton with each side's points on the other: the most common mistake, from behind. */
export function swapSides(keypoints: Keypoint[]) {
  return OTHER_SIDE.map((i) => keypoints[i]);
}

/** Bones as keypoint indices with their colour: Nomol's replay skeleton, left warm, right cool. */
export const BONES: [number, number, string][] = [
  [5, 6, LIMB_COLORS.body],
  [5, 11, LIMB_COLORS.body],
  [6, 12, LIMB_COLORS.body],
  [11, 12, LIMB_COLORS.body],
  [5, 7, LIMB_COLORS.leftArm],
  [7, 9, LIMB_COLORS.leftArm],
  [6, 8, LIMB_COLORS.rightArm],
  [8, 10, LIMB_COLORS.rightArm],
  [11, 13, LIMB_COLORS.leftLeg],
  [13, 15, LIMB_COLORS.leftLeg],
  [12, 14, LIMB_COLORS.rightLeg],
  [14, 16, LIMB_COLORS.rightLeg],
];

/**
 * The points labelled by hand, in the order they are set. The nose stands for the head; eyes
 * and ears are left out (the owner cares about the head, not the face) and exported as not
 * labelled, so training keeps what the model learned about faces instead of copying the
 * candidates' guesses, e.g. eyes on the back of the head upside down.
 */
export const LABELLED = [0, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];

/** The point after (or with `step` -1 before) `index` among the labelled ones, wrapping round. */
export function nextLabelled(index: number | null, step: 1 | -1) {
  if (index === null) return step === 1 ? LABELLED[0] : LABELLED.at(-1)!;
  const at = LABELLED.indexOf(index);
  return LABELLED[(at + step + LABELLED.length) % LABELLED.length];
}

/** The keypoints as exported: eyes and ears as not labelled. */
export function withoutFace(keypoints: Keypoint[]) {
  return keypoints.map((point, i): Keypoint => (LABELLED.includes(i) ? point : [0, 0, 0]));
}

/** A keypoint's own colour: its side's arm or leg, white for the head. */
export function keypointColor(index: number) {
  if (index < 5) return LIMB_COLORS.body;
  const left = index % 2 === 1;
  if (index < 11) return left ? LIMB_COLORS.leftArm : LIMB_COLORS.rightArm;
  return left ? LIMB_COLORS.leftLeg : LIMB_COLORS.rightLeg;
}

/** Below this score a candidate's point is right only about half the time (test labels). */
const UNSURE_SCORE = 0.5;

/**
 * The points still where `candidate` put them with a score below `UNSURE_SCORE`, to check
 * first: above 0.7 RTMPose's points were right in 98 % of the test labels. Also after swapping
 * sides, which only exchanges the points; moved, hidden or set anew, a point counts as checked.
 */
export function unsurePoints(keypoints: Keypoint[], candidate: [number, number, number][]) {
  const unsure = new Set<number>();
  for (const i of LABELLED) {
    const [x, y, v] = keypoints[i];
    if (v === 2 && candidate.some(([cx, cy, s]) => cx === x && cy === y && s < UNSURE_SCORE)) {
      unsure.add(i);
    }
  }
  return unsure;
}

/**
 * A candidate as a starting point: every point visible unless it lies outside the frame. Hidden
 * points are for the person labelling to judge; the models' scores don't tell.
 */
export function fromCandidate(points: [number, number, number][], width: number, height: number) {
  return points.map(([x, y]): Keypoint => {
    const inside = x >= 0 && y >= 0 && x <= width && y <= height;
    return [x, y, inside ? 2 : 0];
  });
}
