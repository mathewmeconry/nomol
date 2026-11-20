import { toCoco } from './coco';
import { fromCandidate, swapSides } from './keypoints';
import {
  labellingOrder,
  nextOpen,
  tasksFileSchema,
  type Keypoint,
  type Label,
  type Task,
} from './tasks';

function task(id: string, set: Task['set'], disagreement: number): Task {
  return {
    id,
    set,
    video: `${set}/v.mp4`,
    time: 1,
    image: `frames/${id}.jpg`,
    width: 100,
    height: 80,
    box: [10, 20, 30, 40],
    crop: [0, 0, 80, 80],
    context: [],
    disagreement,
    candidates: [{ name: 'RTMPose 0°', keypoints: Array.from({ length: 17 }, () => [1, 2, 0.9]) }],
  };
}

function label(id: string, discarded = false): Label {
  const keypoints = Array.from({ length: 17 }, (_, i): Keypoint => [i, i, 2]);
  keypoints[15] = [5, 5, 1];
  keypoints[16] = [9, 9, 0];
  return { id, keypoints, discarded, seconds: 8 };
}

describe('tasks', () => {
  it('reads what prepare.py writes', () => {
    const file = { version: 1, keypoints: [], videos: [], tasks: [task('a', 'test', 0.1)] };
    expect(tasksFileSchema.safeParse(file).success).toBe(true);
  });

  it('labels the test set first, the most disputed frames first', () => {
    const order = labellingOrder([
      task('train-hard', 'train', 0.9),
      task('test-easy', 'test', 0.1),
      task('test-hard', 'test', 0.5),
    ]);
    expect(order.map((t) => t.id)).toEqual(['test-hard', 'test-easy', 'train-hard']);
  });

  it('continues with the next frame without a label, wrapping around', () => {
    const order = [task('a', 'test', 0), task('b', 'test', 0), task('c', 'test', 0)];
    expect(nextOpen(order, new Map([['b', label('b')]]), 0)).toBe(2);
    expect(nextOpen(order, new Map([['c', label('c')]]), 1)).toBe(0);
    const all = new Map(order.map((t) => [t.id, label(t.id)]));
    expect(nextOpen(order, all, 0)).toBe(-1);
  });
});

describe('keypoints', () => {
  it('swaps left and right, keeping the nose', () => {
    const points = Array.from({ length: 17 }, (_, i): Keypoint => [i, 0, 2]);
    const swapped = swapSides(points).map(([x]) => x);
    expect(swapped.slice(0, 7)).toEqual([0, 2, 1, 4, 3, 6, 5]);
    expect(swapSides(swapSides(points))).toEqual(points);
  });

  it('starts from a candidate, points outside the frame as not in the picture', () => {
    expect(
      fromCandidate(
        [
          [50, 40, 0.1],
          [-3, 40, 0.9],
        ],
        100,
        80,
      ),
    ).toEqual([
      [50, 40, 2],
      [-3, 40, 0],
    ]);
  });
});

describe('toCoco', () => {
  it('exports the labelled frames of one set, without discarded ones', () => {
    const tasks = [task('a', 'test', 0), task('b', 'test', 0), task('c', 'train', 0)];
    const labels = new Map([
      ['a', label('a')],
      ['b', label('b', true)],
      ['c', label('c')],
    ]);
    const coco = toCoco(tasks, labels, 'test');
    expect(coco.images).toEqual([{ id: 1, file_name: 'frames/a.jpg', width: 100, height: 80 }]);
    const [annotation] = coco.annotations;
    expect(annotation.bbox).toEqual([10, 20, 30, 40]);
    expect(annotation.area).toBe(1200);
    expect(annotation.num_keypoints).toBe(16);
    expect(annotation.keypoints.slice(-6)).toEqual([5, 5, 1, 0, 0, 0]);
    expect(coco.categories[0].skeleton[0]).toEqual([6, 7]);
  });
});
