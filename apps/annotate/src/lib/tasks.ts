import { z } from 'zod';

const point = z.tuple([z.number(), z.number(), z.number()]);
const rect = z.tuple([z.number(), z.number(), z.number(), z.number()]);

/** One frame to label, as written by prepare.py. Coordinates are frame pixels. */
const taskSchema = z.object({
  id: z.string(),
  set: z.enum(['test', 'train']),
  video: z.string(),
  time: z.number(),
  image: z.string(),
  width: z.number(),
  height: z.number(),
  box: rect,
  crop: rect,
  context: z.array(z.object({ offset: z.number(), image: z.string() })),
  disagreement: z.number(),
  /** Best agreeing first; keypoints are x, y and the model's score. */
  candidates: z.array(z.object({ name: z.string(), keypoints: z.array(point).length(17) })),
});
export type Task = z.infer<typeof taskSchema>;

export const tasksFileSchema = z.object({ tasks: z.array(taskSchema) });

/** A keypoint as COCO stores it: x, y and 0 = not in the picture, 1 = hidden, 2 = visible. */
export type Keypoint = [x: number, y: number, v: 0 | 1 | 2];

export const labelSchema = z.object({
  id: z.string(),
  keypoints: z.array(z.tuple([z.number(), z.number(), z.literal([0, 1, 2])])).length(17),
  /** Too blurred or the wrong person: left out of the export. */
  discarded: z.boolean(),
  /** Time spent on the frame, to see whether labelling gets faster. */
  seconds: z.number(),
});
export type Label = z.infer<typeof labelSchema>;

/**
 * The order to label in: the test set first, so stopping early still leaves something to measure
 * with. In each set round by round through the videos, each video's most disputed frame not yet
 * shown first: sorted by disagreement alone, one clip with many similar hard frames came up 9
 * times among the first 33.
 */
export function labellingOrder(tasks: Task[]) {
  const rank = new Map<string, number>();
  const byVideo = Map.groupBy(tasks, (task) => task.video);
  for (const frames of byVideo.values()) {
    frames
      .toSorted((a, b) => b.disagreement - a.disagreement)
      .forEach((task, i) => rank.set(task.id, i));
  }
  return tasks.toSorted(
    (a, b) =>
      Number(a.set === 'train') - Number(b.set === 'train') ||
      rank.get(a.id)! - rank.get(b.id)! ||
      b.disagreement - a.disagreement,
  );
}

/** The first frame in the labelling order without a label, or null when all are done. */
export function firstOpen(order: Task[], labels: Map<string, Label>) {
  return order.find((task) => !labels.has(task.id))?.id ?? null;
}

/**
 * P goes back through the frames in the order they were saved (`saved`, oldest first), not
 * through the labelling order: that one changes as frames of new videos come in.
 */
export function previousSaved(saved: string[], current: string | null) {
  const at = current === null ? -1 : saved.indexOf(current);
  if (at === -1) return saved.at(-1) ?? current;
  return saved[at - 1] ?? current;
}

/** V: the next discarded frame after `current` in the order saved, wrapping round, or null. */
export function nextDiscarded(saved: string[], labels: Map<string, Label>, current: string | null) {
  const discarded = saved.filter((id) => labels.get(id)?.discarded);
  const at = current === null ? -1 : saved.indexOf(current);
  return discarded.find((id) => saved.indexOf(id) > at) ?? discarded[0] ?? null;
}

/** After saving: from a frame gone back to, on to the one saved after it, else to `open`. */
export function afterSave(saved: string[], id: string, open: string | null) {
  const at = saved.indexOf(id);
  return at === -1 ? open : (saved[at + 1] ?? open);
}
