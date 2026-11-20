"""Prepares frames for the labelling tool (apps/annotate).

Reads the videos in WORK/videos/test and WORK/videos/train, samples frames, finds the largest
person in each and computes skeleton candidates for them: RTMPose-x upright and turned by 180°,
MediaPipe Pose heavy upright and turned by 90°, 180° and 270°. Per video it keeps the frames
where the candidates disagree most (plus some at random, so the test set isn't only the hardest
frames) and writes them with their candidates to WORK/tasks.json and WORK/frames/. Videos already
in tasks.json are skipped, so new videos can be added later.

With --app-gaps it adds, per clip, frames where the app's replay skeleton (from the clip's
.nomol.txt) was missing although the gymnast was seen within 1.5 s, the person nearest that
sighting: where the app shows nothing, the frames that matter most. They are marked appMissed.

With --elements it follows the gymnast through each clip at 10 frames per second and adds up
to 6 moments where they are upside down or sideways: sampled every 0.5 s, a salto (upside down
for ~0.3 s) is mostly missed. They are marked with their element.

    uv run prepare.py ~/nomol-annotate
    uv run prepare.py ~/nomol-annotate --app-gaps
    uv run prepare.py ~/nomol-annotate --elements
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

# YOLOX-m: 3× faster than YOLOX-x on the laptop's CPU and picked the same person in 32 of 35
# frames of two gym clips; the detector took most of the time.
DET_MODEL = "https://download.openmmlab.com/mmpose/v1/projects/rtmposev1/onnx_sdk/yolox_m_8xb8-300e_humanart-c2c7a14a.zip"
POSE_MODEL = "https://download.openmmlab.com/mmpose/v1/projects/rtmposev1/onnx_sdk/rtmpose-x_simcc-body7_pt-body7_700e-384x288-71d7b7e9_20230629.zip"
# Following a gymnast at 10 frames per second only needs their orientation: RTMPose-m is ~4×
# faster than -x.
FOLLOW_MODEL = "https://download.openmmlab.com/mmpose/v1/projects/rtmposev1/onnx_sdk/rtmpose-m_simcc-body7_pt-body7_420e-256x192-e48f03d0_20230504.zip"
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
# Nose, shoulders to wrists, hips to ankles in MediaPipe's layout: the app's skeleton is usable
# where 8 of them are visible.
APP_BODY = [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]
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

    def follow_pose(self, frame, box):
        """The quick pose of the person in `box`: 17×2 points and their scores."""
        if not hasattr(self, "follower"):
            self.follower = RTMPose(FOLLOW_MODEL, model_input_size=(192, 256))
        x, y, w, h = box
        points, scores = self.follower(frame, bboxes=[[x, y, x + w, y + h]])
        return points[0], scores[0]

    def people(self, frame):
        """Everyone the detector finds, as x, y, width, height."""
        return [[float(x0), float(y0), float(x1 - x0), float(y1 - y0)] for x0, y0, x1, y1 in self.detector(frame)]

    def largest_person(self, frame):
        return max(self.people(frame), key=lambda b: b[2] * b[3], default=None)

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


def export_of(video: Path):
    """The app's export beside the clip (the video is usually a link into the clip's folder)."""
    clip = video.resolve()
    path = clip.with_name(f"{clip.stem}.nomol.txt")
    return json.loads(path.read_text()) if path.exists() else None


def sightings(export):
    """Where the app saw the gymnast: (time in ms, torso centre normalized), live or replay."""

    def torso(pose):
        points = [pose[i] for i in (11, 12, 23, 24)]
        if min(p["visibility"] for p in points) < 0.5:
            return None
        return (sum(p["x"] for p in points) / 4, sum(p["y"] for p in points) / 4)

    seen = [(e["time"], torso(e["pose"])) for e in export["frames"] + export["skeleton"]]
    return [(t, c) for t, c in seen if c]


def app_gaps(export):
    """The times (s, every 0.1 s) where the app's replay skeleton had no usable pose although the
    gymnast was seen within 1.5 s, each with the torso centre (normalized) of that sighting."""

    def usable(pose):
        return sum(pose[i]["visibility"] > 0.5 for i in APP_BODY) >= 8

    covered = [e["time"] for e in export["skeleton"] if usable(e["pose"])]
    seen = sightings(export)
    gaps = []
    for slot in range(int(export["durationMs"] // 100)):
        t = slot * 100 + 50
        if any(abs(c - t) <= 60 for c in covered):
            continue
        near = min(seen, key=lambda s: abs(s[0] - t), default=None)
        if near and abs(near[0] - t) <= 1500:
            gaps.append((t / 1000, near[1]))
    return gaps


def sample_gaps(models, video: Path, gaps, count: int, gap: float, taken, seed: str):
    """Frames from the app's gaps, at least `gap` s apart and 0.3 s from frames already taken
    (clips are short and often full at 1 s; 0.3 s on, a gymnast's pose has changed): the person
    nearest the gymnast's last sighting, if near enough to be them, with candidates."""
    order = gaps[:]
    random.Random(seed).shuffle(order)
    wanted = []
    for t, centre in order:
        if all(abs(t - w[0]) >= gap for w in wanted) and all(abs(t - s) >= 0.3 for s in taken):
            wanted.append((t, centre))
        # Some won't show the gymnast: more tries than frames needed.
        if len(wanted) >= count * 2:
            break
    wanted.sort()
    samples = []
    for time, frame in frames(video):
        if not wanted or len(samples) >= count:
            break
        if time < wanted[0][0]:
            continue
        _, (cx, cy) = wanted.pop(0)
        height, width = frame.shape[:2]
        x, y = cx * width, cy * height

        def offset(b):
            return np.hypot(b[0] + b[2] / 2 - x, b[1] + b[3] / 2 - y)

        box = min(models.people(frame), key=offset, default=None)
        if box is None or offset(box) > 0.75 * max(box[2], box[3]) or box[3] < height * 0.1:
            continue
        candidates, score = disagreement(models.candidates(frame, box), box)
        samples.append({"time": time, "box": box, "candidates": candidates, "disagreement": score})
    return samples


def orientation(points):
    """Upright, sideways or upside down, by the angle from the hips' to the shoulders' middle."""
    sx, sy = (points[5] + points[6]) / 2
    hx, hy = (points[11] + points[12]) / 2
    angle = abs(np.degrees(np.arctan2(sx - hx, hy - sy)))
    return "upright" if angle < 35 else "upside down" if angle > 135 else "sideways"


def follow(models, video: Path, export, step: float):
    """Follows the gymnast through the clip every `step` s: the person the app saw (or, without
    a sighting, the largest), detected anew every 0.5 s and in between boxed by their own
    skeleton, so a salto doesn't need the detector. Returns their box and orientation."""
    seen = sightings(export) if export else []
    records = []
    box = None
    detected = -1.0
    next_time = 0.0
    for time, frame in frames(video):
        if time < next_time:
            continue
        next_time = time + step
        height, width = frame.shape[:2]
        if box is None or time - detected >= 0.5:
            detected = time
            people = models.people(frame)
            near = min(seen, key=lambda s: abs(s[0] - time * 1000), default=None)
            if box is not None:
                target = (box[0] + box[2] / 2, box[1] + box[3] / 2)
            elif near and abs(near[0] - time * 1000) <= 1500:
                target = (near[1][0] * width, near[1][1] * height)
            else:
                target = None
            if target is None:
                box = max(people, key=lambda b: b[2] * b[3], default=None)
            else:

                def offset(b):
                    return np.hypot(b[0] + b[2] / 2 - target[0], b[1] + b[3] / 2 - target[1])

                match = min(people, key=offset, default=None)
                if match is not None and offset(match) <= 0.75 * max(match[2], match[3]):
                    box = match
        if box is None:
            continue
        points, scores = models.follow_pose(frame, box)
        if np.mean(scores[[0] + list(range(5, 17))]) < 0.3:
            box = None
            continue
        sure = points[scores >= 0.3]
        x0, y0 = sure.min(axis=0)
        x1, y1 = sure.max(axis=0)
        pad = 0.2 * max(x1 - x0, y1 - y0)
        x0, y0 = max(x0 - pad, 0), max(y0 - pad, 0)
        x1, y1 = min(x1 + pad, width), min(y1 + pad, height)
        box = [float(x0), float(y0), float(x1 - x0), float(y1 - y0)]
        if max(box[2], box[3]) < height * 0.05:
            box = None
            continue
        records.append({"time": time, "box": box, "element": orientation(points)})
    return records


def choose_elements(records, count: int, taken):
    """Up to `count` moments of an element, upside down first, then sideways, at least 0.3 s
    apart and from frames already taken (a salto is upside down for only ~0.3 s)."""
    chosen = []
    for kind in ("upside down", "sideways"):
        for r in records:
            if len(chosen) >= count:
                break
            if r["element"] == kind and all(abs(r["time"] - t) >= 0.3 for t in taken + [c["time"] for c in chosen]):
                chosen.append(r)
    return sorted(chosen, key=lambda r: r["time"])


def with_candidates(models, video: Path, chosen):
    """Computes the full candidates for chosen moments, at the frame of each."""
    wanted = list(chosen)
    for time, frame in frames(video):
        if not wanted:
            break
        if time >= wanted[0]["time"] - 0.001:
            s = wanted.pop(0)
            s["candidates"], s["disagreement"] = disagreement(models.candidates(frame, s["box"]), s["box"])
    return [s for s in chosen if "candidates" in s]


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


def add_tasks(data, work: Path, split: str, video: Path, chosen, app_missed: bool):
    """Saves the chosen frames and adds them to tasks.json's data."""
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
                "appMissed": s.get("appMissed", app_missed),
                **({"element": s["element"]} if "element" in s else {}),
                "candidates": [
                    {"name": name, "keypoints": [[round(float(v), 1 if k < 2 else 3) for k, v in enumerate(p)] for p in points]}
                    for name, points in s["candidates"]
                ],
            }
        )


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("work", type=Path, help="work folder with videos/test and videos/train")
    parser.add_argument(
        "--app-gaps",
        action="store_true",
        help="add frames where the app's replay skeleton was missing (reads each clip's .nomol.txt)",
    )
    parser.add_argument(
        "--elements",
        action="store_true",
        help="add moments where the gymnast is sideways or upside down (follows them at 10 per second)",
    )
    parser.add_argument("--per-video", type=int, help="frames to keep per video (15, --app-gaps 8, --elements 6)")
    parser.add_argument("--step", type=float, default=0.5, help="seconds between sampled frames")
    parser.add_argument("--gap", type=float, default=1.0, help="minimum seconds between kept frames")
    args = parser.parse_args()
    per_video = args.per_video or (8 if args.app_gaps else 6 if args.elements else 15)

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
    done = data.setdefault("gapVideos" if args.app_gaps else "elementVideos" if args.elements else "videos", [])
    todo = [(split, path) for split, path in videos if f"{split}/{path.name}" not in done]
    if not todo:
        print(f"No new videos in {work / 'videos'}/test or /train.", file=sys.stderr)
        return
    models = Models(work)

    for split, video in todo:
        print(f"{split}/{video.name}", file=sys.stderr)
        if args.app_gaps:
            export = export_of(video)
            if export is None:
                print("  no .nomol.txt beside the clip", file=sys.stderr)
                continue
            gaps = app_gaps(export)
            existing = [t for t in data["tasks"] if t["video"] == f"{split}/{video.name}"]
            # Frames prepared before can fall into a gap too.
            for task in existing:
                task["appMissed"] = any(abs(task["time"] - t) <= 0.06 for t, _ in gaps)
            taken = [t["time"] for t in existing]
            chosen = sample_gaps(models, video, gaps, per_video, args.gap, taken, video.name)
        elif args.elements:
            export = export_of(video)
            taken = [t["time"] for t in data["tasks"] if t["video"] == f"{split}/{video.name}"]
            records = follow(models, video, export, 0.1)
            chosen = with_candidates(models, video, choose_elements(records, per_video, taken))
            gaps = [t for t, _ in app_gaps(export)] if export else []
            for s in chosen:
                s["appMissed"] = any(abs(s["time"] - t) <= 0.06 for t in gaps)
            kinds = {k: sum(r["element"] == k for r in records) for k in ("upright", "sideways", "upside down")}
            print(f"  followed {len(records)} moments: {kinds}", file=sys.stderr)
        else:
            chosen = choose(sample(models, video, args.step), per_video, args.gap, video.name)
        add_tasks(data, work, split, video, chosen, args.app_gaps)
        done.append(f"{split}/{video.name}")
        # Written after every video, so a long run that stops keeps what it has.
        tasks_file.write_text(json.dumps(data))
        print(f"  {len(chosen)} frames kept", file=sys.stderr)


if __name__ == "__main__":
    main()
