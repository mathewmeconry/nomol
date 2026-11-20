import { BONES, KEYPOINTS } from './keypoints';
import type { Label, Task } from './tasks';

/**
 * A COCO keypoint file for one set. Only the labelled person of each frame is annotated, which
 * suits top-down models (RTMPose, ViTPose) that are trained on person crops; bottom-up models
 * would take the others in the picture for background.
 */
export function toCoco(tasks: Task[], labels: Map<string, Label>, set: Task['set']) {
  const labelled = tasks.filter((task) => {
    const label = labels.get(task.id);
    return task.set === set && label && !label.discarded;
  });
  return {
    images: labelled.map((task, i) => ({
      id: i + 1,
      file_name: task.image,
      width: task.width,
      height: task.height,
    })),
    annotations: labelled.map((task, i) => {
      const keypoints = labels.get(task.id)!.keypoints;
      const [x, y, w, h] = task.box;
      return {
        id: i + 1,
        image_id: i + 1,
        category_id: 1,
        iscrowd: 0,
        bbox: [x, y, w, h],
        area: w * h,
        // COCO wants unlabelled points as 0, 0, 0.
        keypoints: keypoints.flatMap(([px, py, v]) => (v === 0 ? [0, 0, 0] : [px, py, v])),
        num_keypoints: keypoints.filter(([, , v]) => v > 0).length,
      };
    }),
    categories: [
      {
        id: 1,
        name: 'person',
        supercategory: 'person',
        keypoints: KEYPOINTS,
        skeleton: BONES.map(([a, b]) => [a + 1, b + 1]),
      },
    ],
  };
}
