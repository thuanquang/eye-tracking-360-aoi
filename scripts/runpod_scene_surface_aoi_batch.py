#!/usr/bin/env python3
"""Generate sky and ground scene-surface AOIs on RunPod.

This script complements runpod_auto_aoi_batch.py. The object detector is not a
good fit for large scene surfaces, so this pass uses semantic segmentation and
exports one dynamic polygon AOI per requested surface label.
"""

from __future__ import annotations

import argparse
import math
import sys
import time
from pathlib import Path
from typing import Any

import cv2
import numpy as np
import torch
from PIL import Image
from tqdm import tqdm
from transformers import AutoImageProcessor, AutoModelForSemanticSegmentation

from runpod_auto_aoi_batch import (
    COLORS,
    clamp,
    crop_analysis_frame,
    frame_times,
    mask_to_polygon,
    normalize_label,
    normalize_polygon,
    policy_number,
    read_json,
    tracking_box_from_points,
    write_json,
)


SURFACE_LABEL_GROUPS = {
    "sky": {
        "sky",
    },
    "ground": {
        "dirt track",
        "earth",
        "field",
        "floor",
        "flooring",
        "grass",
        "ground",
        "land",
        "path",
        "pavement",
        "plaza",
        "road",
        "route",
        "runway",
        "sand",
        "sidewalk",
        "street",
        "terrain",
    },
}

SURFACE_COLORS = {
    "sky": "#38bdf8",
    "ground": "#84cc16",
}


def normalize_surface_text(value: Any) -> str:
    return str(value or "").strip().lower().replace("_", " ").replace("-", " ")


def split_model_label(label: Any) -> set[str]:
    normalized = normalize_surface_text(label)
    parts = {normalized}
    for separator in [",", "/", ";", " or ", " and "]:
        expanded = set()
        for part in parts:
            expanded.update(item.strip() for item in part.split(separator) if item.strip())
        parts.update(expanded)
    return parts


def parse_surface_labels(value: str) -> list[str]:
    surfaces = []
    for item in str(value or "").split(","):
        normalized = normalize_surface_text(item)
        if normalized:
            surfaces.append(normalized)
    return surfaces or ["sky", "ground"]


def label_matches_surface(model_label: Any, accepted_labels: set[str]) -> bool:
    model_parts = split_model_label(model_label)
    return any(model_part in accepted_labels for model_part in model_parts)


def class_ids_for_surfaces(id_to_label: dict[Any, Any], surface_labels: list[str]) -> dict[str, set[int]]:
    class_ids: dict[str, set[int]] = {surface: set() for surface in surface_labels}
    for raw_class_id, model_label in id_to_label.items():
        try:
            class_id = int(raw_class_id)
        except (TypeError, ValueError):
            continue
        for surface in surface_labels:
            accepted = SURFACE_LABEL_GROUPS.get(surface, {surface})
            if label_matches_surface(model_label, accepted):
                class_ids[surface].add(class_id)
    return class_ids


def load_segmenter(model_name: str, device: str):
    print(f"Loading semantic segmenter: {model_name}")
    processor = AutoImageProcessor.from_pretrained(model_name)
    model = AutoModelForSemanticSegmentation.from_pretrained(model_name).to(device)
    model.eval()
    return processor, model


def predict_semantic_classes(image_rgb: np.ndarray, processor: Any, model: Any, device: str) -> np.ndarray:
    image = Image.fromarray(image_rgb)
    inputs = processor(images=image, return_tensors="pt").to(device)
    with torch.inference_mode():
        outputs = model(**inputs)
        logits = torch.nn.functional.interpolate(
            outputs.logits,
            size=image_rgb.shape[:2],
            mode="bilinear",
            align_corners=False,
        )
        prediction = logits.argmax(dim=1)[0]
    return prediction.detach().cpu().numpy().astype(np.int32)


def clean_surface_mask(mask: np.ndarray, kernel_size: int, close_iterations: int, open_iterations: int) -> np.ndarray:
    cleaned = mask.astype(np.uint8)
    if kernel_size > 1:
        safe_kernel_size = int(kernel_size)
        if safe_kernel_size % 2 == 0:
            safe_kernel_size += 1
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (safe_kernel_size, safe_kernel_size))
        if close_iterations > 0:
            cleaned = cv2.morphologyEx(cleaned, cv2.MORPH_CLOSE, kernel, iterations=close_iterations)
        if open_iterations > 0:
            cleaned = cv2.morphologyEx(cleaned, cv2.MORPH_OPEN, kernel, iterations=open_iterations)
    return cleaned.astype(bool)


def mask_area_ratio(mask: np.ndarray) -> float:
    return float(np.count_nonzero(mask)) / max(1.0, float(mask.shape[0] * mask.shape[1]))


def surface_frame_from_mask(
    surface: str,
    mask: np.ndarray,
    timestamp: float,
    width: int,
    height: int,
    projection: str,
    args: argparse.Namespace,
) -> dict[str, Any] | None:
    area_ratio = mask_area_ratio(mask)
    if area_ratio < args.min_area_ratio:
        return None

    polygon = mask_to_polygon(
        mask,
        max_points=args.max_polygon_points,
        epsilon_ratio=args.polygon_simplification_epsilon,
    )
    if len(polygon) < 3:
        return None

    points = normalize_polygon(polygon, width, height, projection)
    return {
        "t": round(timestamp, 3),
        "points": points,
        "box": tracking_box_from_points(points, projection, width, height),
        "score": round(area_ratio, 6),
        "surface": surface,
    }


def bounds_for_frames(frames: list[dict[str, Any]], projection: str) -> dict[str, float]:
    if projection == "equirectangular":
        yaws = [point["yaw"] for frame in frames for point in frame["points"] if "yaw" in point]
        pitches = [point["pitch"] for frame in frames for point in frame["points"] if "pitch" in point]
        return {
            "yawMin": round(min(yaws), 4) if yaws else -180,
            "yawMax": round(max(yaws), 4) if yaws else 180,
            "pitchMin": round(min(pitches), 4) if pitches else -90,
            "pitchMax": round(max(pitches), 4) if pitches else 90,
        }

    xs = [point["x"] for frame in frames for point in frame["points"] if "x" in point]
    ys = [point["y"] for frame in frames for point in frame["points"] if "y" in point]
    return {
        "xMin": round(min(xs), 6) if xs else 0,
        "xMax": round(max(xs), 6) if xs else 1,
        "yMin": round(min(ys), 6) if ys else 0,
        "yMax": round(max(ys), 6) if ys else 1,
    }


def make_surface_aoi(
    surface: str,
    frames: list[dict[str, Any]],
    index: int,
    projection: str,
    model_name: str,
    analysis_padding_px: float,
) -> dict[str, Any]:
    keyframes = [
        {
            "t": frame["t"],
            "points": frame["points"],
        }
        for frame in frames
    ]
    mean_score = float(np.mean([frame["score"] for frame in frames])) if frames else 0.0
    aoi = {
        "id": f"{surface}-scene-surface",
        "label": surface,
        "color": SURFACE_COLORS.get(surface, COLORS[index % len(COLORS)]),
        "shape": "polygon",
        "space": "panorama" if projection == "equirectangular" else "video",
        "points": keyframes[0]["points"],
        "keyframes": keyframes,
        "analysisPaddingPx": analysis_padding_px,
        "metadata": {
            "generatedBy": "runpod-scene-surface-aoi",
            "sceneSurface": True,
            "surfaceType": surface,
            "segmenter": model_name,
            "frameCount": len(frames),
            "meanScore": round(mean_score, 4),
        },
    }
    aoi.update(bounds_for_frames(frames, projection))
    return aoi


def process_job(
    job_path: Path,
    videos_dir: Path,
    output_dir: Path,
    segmenter: tuple[Any, Any],
    class_ids: dict[str, set[int]],
    device: str,
    args: argparse.Namespace,
) -> Path:
    job = read_json(job_path)
    if job.get("kind") != "aoi-colab-job":
        raise ValueError(f"{job_path} is not an AOI job JSON")

    video_info = job.get("video", {})
    policy = job.get("aoiPolicy", {})
    video_name = video_info.get("name") or job.get("videoName")
    if not video_name:
        raise ValueError(f"{job_path} does not specify video.name")

    video_path = videos_dir / video_name
    if not video_path.exists():
        raise FileNotFoundError(f"Missing video for job {job_path.name}: {video_path}")

    projection = video_info.get("projection") or job.get("projection") or "flat"
    stereo_layout = video_info.get("stereoLayout") or job.get("stereoLayout") or "mono"
    stereo_eye = video_info.get("stereoEye") or job.get("stereoEye") or "left"
    sample_interval = args.sample_interval or policy_number(policy, "sampleIntervalSec", 0.5)
    sample_interval = max(0.1, sample_interval)
    padding_px = policy_number(policy, "analysisPaddingPx", args.analysis_padding_px)

    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise RuntimeError(f"OpenCV could not open {video_path}")
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    frame_count = cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0.0
    duration = frame_count / fps if fps else 0.0
    times = frame_times(duration, sample_interval)
    processor, model = segmenter
    frames_by_surface = {surface: [] for surface in args.surface_labels}

    print(f"\nProcessing scene surfaces for {video_name}: {duration:.2f}s, {len(times)} sampled frames")
    for timestamp in tqdm(times, desc=video_path.stem):
        cap.set(cv2.CAP_PROP_POS_MSEC, timestamp * 1000.0)
        ok, frame_bgr = cap.read()
        if not ok:
            continue

        analysis_bgr, crop = crop_analysis_frame(frame_bgr, stereo_layout, stereo_eye)
        analysis_rgb = cv2.cvtColor(analysis_bgr, cv2.COLOR_BGR2RGB)
        prediction = predict_semantic_classes(analysis_rgb, processor, model, device)
        height, width = prediction.shape[:2]

        for surface, ids in class_ids.items():
            if not ids:
                continue
            mask = np.isin(prediction, list(ids))
            cleaned = clean_surface_mask(
                mask,
                kernel_size=args.morphology_kernel,
                close_iterations=args.close_iterations,
                open_iterations=args.open_iterations,
            )
            frame = surface_frame_from_mask(
                surface,
                cleaned,
                timestamp=timestamp,
                width=int(crop["width"]),
                height=int(crop["height"]),
                projection=projection,
                args=args,
            )
            if frame:
                frames_by_surface[surface].append(frame)

    cap.release()

    aois = [
        make_surface_aoi(
            surface,
            frames,
            index,
            projection,
            model_name=args.segmentation_model,
            analysis_padding_px=padding_px,
        )
        for index, (surface, frames) in enumerate(frames_by_surface.items())
        if len(frames) >= args.min_keyframes
    ]

    payload = {
        "kind": "aoi-project",
        "version": 1,
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "source": "runpod-scene-surface-aoi",
        "video": video_info,
        "aoiPolicy": {
            **policy,
            "sceneSurfaceGeneration": True,
            "surfaceLabels": args.surface_labels,
            "segmentationModel": args.segmentation_model,
            "sampleIntervalSec": sample_interval,
            "minAreaRatio": args.min_area_ratio,
            "minKeyframes": args.min_keyframes,
            "maxPolygonPoints": args.max_polygon_points,
            "polygonSimplificationEpsilon": args.polygon_simplification_epsilon,
            "morphologyKernel": args.morphology_kernel,
            "outputShape": "polygon",
        },
        "aois": aois,
        "stats": {
            "sampledFrames": len(times),
            "surfaceFrameCounts": {
                surface: len(frames)
                for surface, frames in frames_by_surface.items()
            },
            "aois": len(aois),
        },
    }

    out_path = output_dir / f"{video_path.stem}.scene-surface-aois.json"
    write_json(out_path, payload)
    print(f"Wrote {out_path} ({len(aois)} scene surface AOIs)")
    if device == "cuda":
        torch.cuda.empty_cache()
    return out_path


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate sky and ground AOIs from videos on RunPod.")
    parser.add_argument("--jobs-dir", type=Path, default=Path("jobs"))
    parser.add_argument("--videos-dir", type=Path, default=Path("videos"))
    parser.add_argument("--output-dir", type=Path, default=Path("outputs-scene-surfaces"))
    parser.add_argument("--segmentation-model", default="nvidia/segformer-b5-finetuned-ade-640-640")
    parser.add_argument("--surface-labels", default="sky,ground")
    parser.add_argument("--sample-interval", type=float, default=None)
    parser.add_argument("--min-area-ratio", type=float, default=0.01)
    parser.add_argument("--min-keyframes", type=int, default=2)
    parser.add_argument("--max-polygon-points", type=int, default=220)
    parser.add_argument("--polygon-simplification-epsilon", type=float, default=0.001)
    parser.add_argument("--analysis-padding-px", type=float, default=12)
    parser.add_argument("--morphology-kernel", type=int, default=9)
    parser.add_argument("--close-iterations", type=int, default=2)
    parser.add_argument("--open-iterations", type=int, default=1)
    parser.add_argument("--cpu", action="store_true")
    args = parser.parse_args(argv)
    args.surface_labels = parse_surface_labels(args.surface_labels)
    args.max_polygon_points = int(clamp(args.max_polygon_points, 12, 240))
    args.polygon_simplification_epsilon = clamp(args.polygon_simplification_epsilon, 0.0005, 0.02)
    args.min_area_ratio = clamp(args.min_area_ratio, 0.0, 0.95)
    args.min_keyframes = max(1, int(args.min_keyframes))
    args.morphology_kernel = max(0, int(args.morphology_kernel))
    args.close_iterations = max(0, int(args.close_iterations))
    args.open_iterations = max(0, int(args.open_iterations))
    return args


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    device = "cuda" if torch.cuda.is_available() and not args.cpu else "cpu"
    if device != "cuda":
        print("WARNING: CUDA is not available. This will be slow.", file=sys.stderr)
    else:
        torch.backends.cuda.matmul.allow_tf32 = True
        print(f"CUDA device: {torch.cuda.get_device_name(0)}")

    job_paths = sorted(args.jobs_dir.glob("*.json"))
    if not job_paths:
        raise FileNotFoundError(f"No job JSON files found in {args.jobs_dir}")

    args.output_dir.mkdir(parents=True, exist_ok=True)
    segmenter = load_segmenter(args.segmentation_model, device)
    id_to_label = getattr(segmenter[1].config, "id2label", {})
    class_ids = class_ids_for_surfaces(id_to_label, args.surface_labels)
    for surface, ids in class_ids.items():
        labels = ", ".join(str(id_to_label.get(class_id, class_id)) for class_id in sorted(ids))
        print(f"{surface}: matched {len(ids)} model labels [{labels}]")

    outputs = [
        process_job(
            job_path=job_path,
            videos_dir=args.videos_dir,
            output_dir=args.output_dir,
            segmenter=segmenter,
            class_ids=class_ids,
            device=device,
            args=args,
        )
        for job_path in job_paths
    ]

    write_json(args.output_dir / "manifest.json", {
        "kind": "eye-tracking-360-aoi-scene-surface-manifest",
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "segmentationModel": args.segmentation_model,
        "surfaceLabels": args.surface_labels,
        "outputs": [str(path) for path in outputs],
    })
    print("\nDone. Download outputs-scene-surfaces/*.scene-surface-aois.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
