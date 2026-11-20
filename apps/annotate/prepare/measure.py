"""Measures skeletons against the hand labels of the labelling tool (apps/annotate).

Compares, per labelled frame of a set: the app's own skeletons from each clip's .nomol.txt (the
replay skeleton and the live poses, as recorded) and the candidates prepare.py computed on a
full-resolution view of the detected person (RTMPose-x upright and turned 180°, MediaPipe heavy
upright and turned 90°, 180°, 270°), plus picking a view without knowing the label (each
model's most confident view, or the candidate agreeing best with the others).

A point counts if it is drawn (MediaPipe visibility >= 0.5 as in the app, RTMPose score >= 0.3)
and lies within 10 % of the person's size (the longer side of their box) from the label; points
not drawn count as missed. Only the nose (standing for the head) and the 12 body points are
labelled. "Found" is the share of frames with at least 8 of them drawn, the app's criterion for
a usable skeleton.

The labels started from the candidates (the best agreeing one first), so the candidates are
favoured; the column "corrected" only has frames where the label moved points of every one.
"App missed" are the frames where the app's replay skeleton wasn't found.

    uv run measure.py ~/nomol-annotate
"""

import argparse
import json
from pathlib import Path

import numpy as np

from prepare import MP_TO_COCO, export_of

POINTS = [0] + list(range(5, 17))
MP_VISIBLE = 0.5
RTM_VISIBLE = 0.3
NEAR = 0.1


def person_size(task, label):
    """The longer side of the box grown to every labelled point, as exported."""
    x, y, w, h = task["box"]
    xs = [p[0] for i, p in enumerate(label) if i in POINTS and p[2]] + [x, x + w]
    ys = [p[1] for i, p in enumerate(label) if i in POINTS and p[2]] + [y, y + h]
    return max(max(xs) - min(xs), max(ys) - min(ys))


def app_pose(entries, time_ms, width, height):
    """The app's pose nearest the frame (within 60 ms) in COCO order, None where not drawn."""
    entry = min(entries, key=lambda e: abs(e["time"] - time_ms), default=None)
    if entry is None or abs(entry["time"] - time_ms) > 60:
        return None
    pose = [entry["pose"][i] for i in MP_TO_COCO]
    return [(p["x"] * width, p["y"] * height) if p["visibility"] >= MP_VISIBLE else None for p in pose]


def candidate_pose(candidate):
    threshold = MP_VISIBLE if candidate["name"].startswith("MediaPipe") else RTM_VISIBLE
    return [(x, y) if s >= threshold else None for x, y, s in candidate["keypoints"]]


def most_confident(candidates, model):
    own = [c for c in candidates if c["name"].startswith(model)]
    return max(own, key=lambda c: np.mean([c["keypoints"][i][2] for i in POINTS]), default=None)


def score(pose, label, size):
    """Points hit, points labelled, and whether the pose counts as found."""
    labelled = [i for i in POINTS if label[i][2]]
    if pose is None:
        return 0, len(labelled), False
    drawn = sum(1 for i in POINTS if pose[i] is not None)
    hit = sum(
        1 for i in labelled if pose[i] is not None and np.hypot(pose[i][0] - label[i][0], pose[i][1] - label[i][1]) <= NEAR * size
    )
    return hit, len(labelled), drawn >= 8


def upside_down(label, size):
    """Shoulders clearly below the hips (image y grows downwards)."""
    if not all(label[i][2] for i in (5, 6, 11, 12)):
        return False
    shoulders = (label[5][1] + label[6][1]) / 2
    hips = (label[11][1] + label[12][1]) / 2
    return shoulders - hips > 0.1 * size


def corrected(task, label, size):
    """The label moved at least two points of every candidate, so it isn't one taken as it was
    (any of them could be picked by its number)."""

    def moved(candidate):
        k = candidate["keypoints"]
        return sum(1 for i in POINTS if label[i][2] and np.hypot(k[i][0] - label[i][0], k[i][1] - label[i][1]) > 0.05 * size)

    return all(moved(c) >= 2 for c in task["candidates"])


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("work", type=Path, help="the labelling tool's work folder")
    parser.add_argument("--set", default="test", choices=["test", "train"])
    args = parser.parse_args()
    work = args.work.expanduser().resolve()

    tasks = [t for t in json.loads((work / "tasks.json").read_text())["tasks"] if t["set"] == args.set]
    labels = {}
    for path in (work / "labels").glob("*.json"):
        label = json.loads(path.read_text())
        if not label["discarded"]:
            labels[label["id"]] = label["keypoints"]

    methods = [
        "App: replay skeleton",
        "App: live",
        "RTMPose-x upright",
        "RTMPose-x 180°",
        "RTMPose-x, more confident view",
        "MediaPipe upright",
        "MediaPipe, most confident view",
        "Best agreeing candidate",
    ]
    groups = ["all", "app had skeleton", "app missed", "upside down", "corrected"]
    totals = {(m, g): [0, 0, 0, 0] for m in methods for g in groups}  # hit, labelled, found, frames
    exports = {}

    for task in tasks:
        label = labels.get(task["id"])
        if label is None:
            continue
        size = person_size(task, label)
        video = work / "videos" / task["video"]
        if task["video"] not in exports:
            exports[task["video"]] = export_of(video)
        export = exports[task["video"]]
        time_ms = task["time"] * 1000
        by_name = {c["name"]: c for c in task["candidates"]}

        def pose_of(name):
            return candidate_pose(by_name[name]) if name in by_name else None

        rtm = most_confident(task["candidates"], "RTMPose")
        mp = most_confident(task["candidates"], "MediaPipe")
        poses = {
            "App: replay skeleton": export and app_pose(export["skeleton"], time_ms, task["width"], task["height"]),
            "App: live": export and app_pose(export["frames"], time_ms, task["width"], task["height"]),
            "RTMPose-x upright": pose_of("RTMPose 0°"),
            "RTMPose-x 180°": pose_of("RTMPose 180°"),
            "RTMPose-x, more confident view": rtm and candidate_pose(rtm),
            "MediaPipe upright": pose_of("MediaPipe 0°"),
            "MediaPipe, most confident view": mp and candidate_pose(mp),
            "Best agreeing candidate": task["candidates"] and candidate_pose(task["candidates"][0]),
        }
        app_drawn = poses["App: replay skeleton"]
        app_found = bool(app_drawn) and sum(p is not None for i, p in enumerate(app_drawn) if i in POINTS) >= 8
        in_groups = ["all", "app had skeleton" if app_found else "app missed"]
        if upside_down(label, size):
            in_groups.append("upside down")
        if corrected(task, label, size):
            in_groups.append("corrected")
        for method, pose in poses.items():
            hit, labelled, found = score(pose or None, label, size)
            for group in in_groups:
                total = totals[(method, group)]
                total[0] += hit
                total[1] += labelled
                total[2] += found
                total[3] += 1

    frames = {g: totals[(methods[0], g)][3] for g in groups}
    print(f"{args.set} set: points within {NEAR:.0%} of the person's size / frames with a skeleton found\n")
    print("| | " + " | ".join(f"{g} ({frames[g]})" for g in groups) + " |")
    print("|---|" + "---|" * len(groups))
    for method in methods:
        cells = []
        for group in groups:
            hit, labelled, found, n = totals[(method, group)]
            cells.append(f"{hit / labelled:.0%} / {found / n:.0%}" if n else "–")
        print(f"| {method} | " + " | ".join(cells) + " |")


if __name__ == "__main__":
    main()
