"""Prepares frames for the labelling tool (apps/annotate).

Reads the videos in WORK/videos/test and WORK/videos/train, samples frames, finds the largest
person in each and computes skeleton candidates for them: RTMPose-x upright and turned by 180°,
MediaPipe Pose heavy upright and turned by 90°, 180° and 270°. Per video it keeps the frames
where the candidates disagree most (plus some at random, so the test set isn't only the hardest
frames) and writes them with their candidates to WORK/tasks.json and WORK/frames/. Videos already
in tasks.json are skipped, so new videos can be added later.

    uv run prepare.py ~/nomol-annotate
"""

import argparse
import json
import random
import re
import sys
import urllib.request
from pathlib import Path

import cv2
import mediapipe as mp
import numpy as np
from mediapipe.tasks.python import BaseOptions, vision
from rtmlib import YOLOX, RTMPose

DET_MODEL = "https://download.openmmlab.com/mmpose/v1/projects/rtmposev1/onnx_sdk/yolox_x_8xb8-300e_humanart-a39d44ed.zip"
POSE_MODEL = "https://download.openmmlab.com/mmpose/v1/projects/rtmposev1/onnx_sdk/rtmpose-x_simcc-body7_pt-body7_700e-384x288-71d7b7e9_20230629.zip"
MP_MODEL = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/latest/pose_landmarker_heavy.task"

# MediaPipe's 33 landmarks in COCO's order of 17 keypoints.
MP_TO_COCO = [0, 2, 5, 7, 8, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]
KEYPOINTS = [
    "nose", "left_eye", "right_eye", "left_ear", "right_ear",
    "left_shoulder", "right_shoulder", "left_elbow", "right_elbow", "left_wrist", "right_wrist",
    "left_hip", "right_hip", "left_knee", "right_knee", "left_ankle", "right_ankle",
]  # fmt: skip
CONTEXT = [-0.2, -0.1, 0.1, 0.2]
VIDEO_EXTENSIONS = {".mp4", ".mov", ".webm", ".mkv"}
# A view around the person: their box plus a margin, turned, at most this many pixels wide.
VIEW_MARGIN = 1.3
VIEW_MAX = 768


class Models:
    def __init__(self, work: Path):
        # Blurred and upside-down gymnasts score low; the default threshold of 0.7 misses them.
        self.detector = YOLOX(DET_MODEL, model_input_size=(640, 640), score_thr=0.4)
        self.rtmpose = RTMPose(POSE_MODEL, model_input_size=(288, 384))
        model = work / "models" / "pose_landmarker_heavy.task"
        if not model.exists():
            model.parent.mkdir(parents=True, exist_ok=True)
            urllib.request.urlretrieve(MP_MODEL, model)
        self.mediapipe = vision.PoseLandmarker.create_from_options(
            vision.PoseLandmarkerOptions(
                base_options=BaseOptions(model_asset_path=str(model)),
                running_mode=vision.RunningMode.IMAGE,
                num_poses=2,
            )
        )

    def largest_person(self, frame):
        boxes = self.detector(frame)
        if len(boxes) == 0:
            return None
        areas = (boxes[:, 2] - boxes[:, 0]) * (boxes[:, 3] - boxes[:, 1])
        x0, y0, x1, y1 = boxes[int(np.argmax(areas))]
        return [float(x0), float(y0), float(x1 - x0), float(y1 - y0)]

    def candidates(self, frame, box):
        """Skeleton candidates for the person in `box` as (name, 17×3 array of x, y, score)."""
        result = []
        for angle in (0, 180):
            view, back = turned_view(frame, box, angle)
            size = view.shape[0]
            w, h = box[2] * size / (box_side(box)), box[3] * size / box_side(box)
            bbox = [size / 2 - w / 2, size / 2 - h / 2, size / 2 + w / 2, size / 2 + h / 2]
            points, scores = self.rtmpose(view, bboxes=[bbox])
            result.append((f"RTMPose {angle}°", with_scores(map_back(points[0], back), scores[0])))
        for angle in (0, 90, 180, 270):
            view, back = turned_view(frame, box, angle)
            size = view.shape[0]
            image = mp.Image(image_format=mp.ImageFormat.SRGB, data=cv2.cvtColor(view, cv2.COLOR_BGR2RGB))
            poses = self.mediapipe.detect(image).pose_landmarks
            if not poses:
                continue
            # The person the view is centred on, not someone else in it.
            pose = min(poses, key=lambda p: torso_offset(p))
            points = np.array([[pose[i].x * size, pose[i].y * size] for i in MP_TO_COCO])
            scores = np.array([pose[i].visibility for i in MP_TO_COCO])
            result.append((f"MediaPipe {angle}°", with_scores(map_back(points, back), scores)))
        return result


def box_side(box):
    return max(box[2], box[3]) * VIEW_MARGIN


def turned_view(frame, box, angle):
    """A square view centred on the box, turned by `angle` (counter-clockwise), and the matrix
    mapping its pixels back to the frame."""
    side = box_side(box)
    size = int(min(side, VIEW_MAX))
    cx, cy = box[0] + box[2] / 2, box[1] + box[3] / 2
    forward = cv2.getRotationMatrix2D((cx, cy), angle, size / side)
    forward[:, 2] += (size / 2 - cx, size / 2 - cy)
    view = cv2.warpAffine(frame, forward, (size, size), borderValue=(0, 0, 0))
    return view, cv2.invertAffineTransform(forward)


def map_back(points, back):
    return points @ back[:, :2].T + back[:, 2]


def with_scores(points, scores):
    return np.column_stack([points, scores])


def torso_offset(pose):
    x = (pose[11].x + pose[12].x + pose[23].x + pose[24].x) / 4
    y = (pose[11].y + pose[12].y + pose[23].y + pose[24].y) / 4
    return (x - 0.5) ** 2 + (y - 0.5) ** 2


def disagreement(candidates, box):
    """Orders the candidates by how well they agree with the others (best first) and returns how
    much the best one still disagrees, as the median distance per keypoint in box heights."""
    if len(candidates) < 2:
        return candidates, 1.0
    points = [c[1][:, :2] for c in candidates]

    def distance(a, b):
        return float(np.mean(np.linalg.norm(a - b, axis=1))) / box[3]

    medians = [
        float(np.median([distance(p, q) for j, q in enumerate(points) if j != i]))
        for i, p in enumerate(points)
    ]
    order = np.argsort(medians)
    return [candidates[i] for i in order], medians[order[0]]


def frames(video: Path):
    """Yields (seconds, frame) for every frame of the video."""
    capture = cv2.VideoCapture(str(video))
    while True:
        ok, frame = capture.read()
        if not ok:
            break
        yield capture.get(cv2.CAP_PROP_POS_MSEC) / 1000, frame
    capture.release()


def sample(models, video: Path, step: float):
    samples = []
    next_time = 0.0
    for time, frame in frames(video):
        if time < next_time:
            continue
        next_time = time + step
        box = models.largest_person(frame)
        if box is None or box[3] < frame.shape[0] * 0.1:
            continue
        candidates, score = disagreement(models.candidates(frame, box), box)
        samples.append({"time": time, "box": box, "candidates": candidates, "disagreement": score})
        print(f"\r  {time:6.1f} s, {len(samples)} frames with a person", end="", file=sys.stderr)
    print(file=sys.stderr)
    return samples


def choose(samples, count: int, gap: float, seed: str):
    """Two thirds of the frames where the candidates disagree most, the rest at random; frames
    at least `gap` seconds apart, since neighbouring frames teach little new."""
    chosen = []

    def take(pool, limit):
        for s in pool:
            if len(chosen) >= limit:
                return
            if all(abs(s["time"] - c["time"]) >= gap for c in chosen):
                chosen.append(s)

    take(sorted(samples, key=lambda s: -s["disagreement"]), round(count * 2 / 3))
    rest = [s for s in samples if s not in chosen]
    random.Random(seed).shuffle(rest)
    take(rest, count)
    return sorted(chosen, key=lambda s: s["time"])


def crop_rect(box, frame_shape):
    """The part of the frame the tool zooms to: the box with a margin of a quarter of its longer
    side all round (not a square, which left someone lying flat small), kept inside the frame."""
    height, width = frame_shape[:2]
    margin = max(box[2], box[3]) / 4
    x0, y0 = max(box[0] - margin, 0), max(box[1] - margin, 0)
    x1, y1 = min(box[0] + box[2] + margin, width), min(box[1] + box[3] + margin, height)
    return [x0, y0, x1 - x0, y1 - y0]


def save_frames(video: Path, chosen, ids, work: Path):
    """Writes each chosen frame whole and its neighbours as crops."""
    wanted = []
    for s, task_id in zip(chosen, ids):
        wanted.append((s["time"], f"{task_id}.jpg", None))
        for offset in CONTEXT:
            wanted.append((s["time"] + offset, f"{task_id}_{offset:+.1f}.jpg", s["crop"]))
    wanted.sort()
    previous = None
    for time, frame in frames(video):
        while wanted and wanted[0][0] <= time:
            target, name, crop = wanted.pop(0)
            # The frame nearest the target time, which may be the one before.
            use = previous if previous and target - previous[0] < time - target else (time, frame)
            image = use[1]
            if crop:
                x, y, w, h = (int(round(v)) for v in crop)
                image = image[y : y + h, x : x + w]
            cv2.imwrite(str(work / "frames" / name), image, [cv2.IMWRITE_JPEG_QUALITY, 92])
        previous = (time, frame)
    # Neighbours past the end of the video are left out.
    return {name for _, name, _ in wanted}


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("work", type=Path, help="work folder with videos/test and videos/train")
    parser.add_argument("--per-video", type=int, default=15, help="frames to keep per video")
    parser.add_argument("--step", type=float, default=0.5, help="seconds between sampled frames")
    parser.add_argument("--gap", type=float, default=1.0, help="minimum seconds between kept frames")
    args = parser.parse_args()

    work = args.work.expanduser().resolve()
    (work / "frames").mkdir(parents=True, exist_ok=True)
    tasks_file = work / "tasks.json"
    data = json.loads(tasks_file.read_text()) if tasks_file.exists() else {"version": 1, "videos": [], "tasks": []}
    data["keypoints"] = KEYPOINTS

    videos = [
        (split, path)
        for split in ("test", "train")
        for path in sorted((work / "videos" / split).glob("*"))
        if path.suffix.lower() in VIDEO_EXTENSIONS
    ]
    todo = [(split, path) for split, path in videos if f"{split}/{path.name}" not in data["videos"]]
    if not todo:
        print(f"No new videos in {work / 'videos'}/test or /train.", file=sys.stderr)
        return
    models = Models(work)

    for split, video in todo:
        print(f"{split}/{video.name}", file=sys.stderr)
        samples = sample(models, video, args.step)
        chosen = choose(samples, args.per_video, args.gap, video.name)
        stem = re.sub(r"[^A-Za-z0-9-]+", "-", video.stem)
        ids = [f"{split}_{stem}_{round(s['time'] * 1000):07d}" for s in chosen]
        height, width = next(frames(video))[1].shape[:2]
        for s in chosen:
            s["crop"] = crop_rect(s["box"], (height, width))
        missing = save_frames(video, chosen, ids, work)
        for s, task_id in zip(chosen, ids):
            data["tasks"].append(
                {
                    "id": task_id,
                    "set": split,
                    "video": f"{split}/{video.name}",
                    "time": round(s["time"], 3),
                    "image": f"frames/{task_id}.jpg",
                    "width": width,
                    "height": height,
                    "box": [round(v, 1) for v in s["box"]],
                    "crop": [round(v, 1) for v in s["crop"]],
                    "context": [
                        {"offset": offset, "image": f"frames/{task_id}_{offset:+.1f}.jpg"}
                        for offset in CONTEXT
                        if f"{task_id}_{offset:+.1f}.jpg" not in missing
                    ],
                    "disagreement": round(s["disagreement"], 4),
                    "candidates": [
                        {"name": name, "keypoints": [[round(float(v), 1 if k < 2 else 3) for k, v in enumerate(p)] for p in points]}
                        for name, points in s["candidates"]
                    ],
                }
            )
        data["videos"].append(f"{split}/{video.name}")
        # Written after every video, so a long run that stops keeps what it has.
        tasks_file.write_text(json.dumps(data))
        print(f"  {len(chosen)} frames kept", file=sys.stderr)


if __name__ == "__main__":
    main()
