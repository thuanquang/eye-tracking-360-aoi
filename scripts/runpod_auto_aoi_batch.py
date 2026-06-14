#!/usr/bin/env python3
"""RunPod batch AOI generation for the eye-tracking 360 AOI prototype.

This script is meant to run on a CUDA pod. It takes exported AOI job JSON files
and matching videos, detects objects with Florence-2, segments their edges with
SAM 2.1, and writes importable polygon AOI JSON files.
"""

from __future__ import annotations

import argparse
import hashlib
import inspect
import json
import math
import os
import re
import sys
import time
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

import cv2
import numpy as np
import torch
from PIL import Image
from tqdm import tqdm
from transformers import AutoModelForCausalLM, AutoModelForZeroShotObjectDetection, AutoProcessor


SAM2_CHECKPOINTS = {
    "tiny": {
        "url": "https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_tiny.pt",
        "config": "configs/sam2.1/sam2.1_hiera_t.yaml",
    },
    "small": {
        "url": "https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_small.pt",
        "config": "configs/sam2.1/sam2.1_hiera_s.yaml",
    },
    "base_plus": {
        "url": "https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_base_plus.pt",
        "config": "configs/sam2.1/sam2.1_hiera_b+.yaml",
    },
    "large": {
        "url": "https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_large.pt",
        "config": "configs/sam2.1/sam2.1_hiera_l.yaml",
    },
}

COLORS = [
    "#ef4444",
    "#f97316",
    "#eab308",
    "#22c55e",
    "#14b8a6",
    "#06b6d4",
    "#3b82f6",
    "#8b5cf6",
    "#ec4899",
]

DEFAULT_AUTO_TAXONOMY = [
    "person",
    "man",
    "woman",
    "child",
    "face",
    "hand",
    "hat",
    "dress",
    "dancer",
    "fan",
    "drum",
    "musical instrument",
    "temple",
    "tower",
    "building",
    "door",
    "window",
    "bench",
    "chair",
    "table",
    "bag",
    "shoe",
    "tree",
    "plant",
    "flower",
    "flower pot",
    "road",
    "sidewalk",
    "car",
    "bus",
    "truck",
    "motorcycle",
    "bicycle",
    "street sign",
    "street light",
    "skyscraper",
    "boat",
    "rowboat",
    "river",
    "water",
    "rock",
    "cliff",
    "mountain",
    "cave",
    "sky",
    "grass",
    "vegetation",
]
APP_VIEWER_YAW_OFFSET_DEGREES = -90.0


def normalize_yaw(yaw: float) -> float:
    normalized = ((float(yaw) + 180.0) % 360.0) - 180.0
    return 180.0 if normalized == -180.0 and yaw > 0 else normalized


def source_x_to_app_yaw(normalized_x: float) -> float:
    return normalize_yaw(float(normalized_x) * 360.0 - 180.0 + APP_VIEWER_YAW_OFFSET_DEGREES)


def app_yaw_to_source_x(yaw: float) -> float:
    return ((float(yaw) - APP_VIEWER_YAW_OFFSET_DEGREES + 180.0) % 360.0) / 360.0

SCENE_AUTO_TAXONOMIES = {
    "nguyen_hue": [
        "pedestrian",
        "tourist",
        "street vendor",
        "security guard",
        "motorbike",
        "scooter",
        "motorcycle",
        "car",
        "taxi",
        "bus",
        "bicycle",
        "traffic light",
        "traffic sign",
        "street sign",
        "crosswalk",
        "zebra crossing",
        "sidewalk",
        "road lane",
        "curb",
        "median",
        "bollard",
        "barrier",
        "bench",
        "trash bin",
        "street lamp",
        "lamp post",
        "tree",
        "planter",
        "flower bed",
        "building facade",
        "storefront",
        "shop sign",
        "billboard",
        "flag",
        "fountain",
        "statue",
        "plaza",
    ],
    "thap_ba": [
        "performer",
        "costume",
        "headpiece",
        "headdress",
        "scarf",
        "stage",
        "platform",
        "audience",
        "tourist",
        "statue",
        "sculpture",
        "shrine",
        "altar",
        "pagoda",
        "column",
        "pillar",
        "roof",
        "stair",
        "railing",
        "wall",
        "banner",
        "speaker",
        "microphone",
        "umbrella",
        "lamp",
    ],
    "tam_coc": [
        "sampan",
        "paddle",
        "oar",
        "tourist",
        "passenger",
        "guide",
        "shoreline",
        "riverbank",
        "limestone cliff",
        "rock wall",
        "cave entrance",
        "reflection",
        "rice field",
        "field",
        "dock",
        "pier",
        "bridge",
        "hut",
        "house",
        "leaf",
        "bush",
    ],
}

GROUNDING_LABEL_ALIASES = {
    "adult": "person",
    "audience": "person",
    "child": "person",
    "dancer": "person",
    "guide": "person",
    "man": "person",
    "passenger": "person",
    "pedestrian": "person",
    "performer": "person",
    "tourist": "person",
    "woman": "person",
    "high-rise building": "building",
    "apartment building": "building",
    "glass building": "building",
    "pagoda": "temple",
    "shrine": "temple",
    "rowboat": "boat",
    "sampan": "boat",
    "river": "water",
    "paddle": "oar",
    "limestone cliff": "cliff",
    "rock wall": "cliff",
    "riverbank": "shoreline",
    "street": "road",
    "lane": "road",
    "lamp post": "street light",
    "utility pole": "street light",
    "shop sign": "sign",
    "street sign": "sign",
    "traffic sign": "sign",
    "zebra crossing": "crosswalk",
    "road lane": "road",
    "street lamp": "street light",
    "motorbike": "motorcycle",
    "scooter": "motorcycle",
    "drum musical": "drum",
    "drum musical instrument": "drum",
}

CANONICAL_LABEL_KEYWORDS = [
    ("person", ["person", "man", "woman", "child", "dancer", "performer", "tourist", "audience", "passenger", "guide", "pedestrian"]),
    ("umbrella", ["umbrella"]),
    ("boat", ["boat", "rowboat", "sampan"]),
    ("temple", ["temple", "pagoda", "shrine"]),
    ("building", ["building", "tower", "skyscraper"]),
    ("crosswalk", ["crosswalk", "zebra crossing"]),
    ("road", ["road", "street", "sidewalk", "lane"]),
    ("traffic light", ["traffic light", "traffic signal"]),
    ("street light", ["street light", "lamp post", "utility pole"]),
    ("sign", ["sign", "billboard"]),
    ("flower", ["flower"]),
    ("plant", ["plant", "vegetation", "bush", "leaf"]),
    ("water", ["water", "river", "reflection"]),
    ("cliff", ["cliff", "rock wall", "limestone cliff", "rock"]),
    ("cave", ["cave", "cave entrance"]),
    ("bench", ["bench"]),
    ("table", ["table"]),
    ("drum", ["drum", "musical instrument"]),
    ("motorcycle", ["motorcycle", "scooter"]),
]


@dataclass
class Detection:
    label: str
    score: float
    box: tuple[float, float, float, float]
    points: list[dict[str, float]]
    t: float


def slugify(text: str, fallback: str = "generated-aoi") -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return slug or fallback


def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def read_json(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8-sig") as handle:
        return json.load(handle)


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2)
        handle.write("\n")


def policy_number(policy: dict[str, Any], key: str, fallback: float) -> float:
    value = policy.get(key, fallback)
    try:
        value = float(value)
    except (TypeError, ValueError):
        return fallback
    return value if math.isfinite(value) else fallback


def normalize_label(label: Any) -> str:
    text = str(label or "object").strip()
    return text or "object"


def stable_id(label: str, box: Iterable[float], t: float) -> str:
    digest = hashlib.sha1(f"{label}:{t:.2f}:{list(box)}".encode("utf-8")).hexdigest()[:8]
    return f"{slugify(label)}-{digest}"


def download_file(url: str, destination: Path) -> Path:
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists() and destination.stat().st_size > 0:
        return destination
    print(f"Downloading {url}")
    urllib.request.urlretrieve(url, destination)
    return destination


def load_detector(model_name: str, device: str):
    print(f"Loading detector: {model_name}")
    processor = AutoProcessor.from_pretrained(model_name, trust_remote_code=True)
    dtype = torch.float16 if device == "cuda" else torch.float32
    model = AutoModelForCausalLM.from_pretrained(
        model_name,
        torch_dtype=dtype,
        trust_remote_code=True,
        attn_implementation="eager",
    ).to(device)
    model.eval()
    return processor, model


def load_grounding_detector(model_name: str, device: str):
    print(f"Loading GroundingDINO detector: {model_name}")
    processor = AutoProcessor.from_pretrained(model_name)
    dtype = torch.float32
    model = AutoModelForZeroShotObjectDetection.from_pretrained(
        model_name,
        dtype=dtype,
    ).to(device)
    model.eval()
    return processor, model


def get_model_floating_dtype(model: Any) -> torch.dtype:
    for parameter in model.parameters():
        if torch.is_floating_point(parameter):
            return parameter.dtype
    return torch.float32


def cast_floating_inputs_to_model_dtype(inputs: Any, model: Any) -> Any:
    dtype = get_model_floating_dtype(model)
    for key, value in list(inputs.items()):
        if torch.is_tensor(value) and torch.is_floating_point(value):
            inputs[key] = value.to(dtype=dtype)
    return inputs


def post_process_grounded_detections(
    processor: Any,
    outputs: Any,
    input_ids: Any,
    box_threshold: float,
    text_threshold: float,
    target_sizes: list[tuple[int, int]],
) -> list[dict[str, Any]]:
    post_process = processor.post_process_grounded_object_detection
    parameters = inspect.signature(post_process).parameters
    kwargs: dict[str, Any] = {
        "text_threshold": text_threshold,
        "target_sizes": target_sizes,
    }
    if "box_threshold" in parameters:
        kwargs["box_threshold"] = box_threshold
    else:
        kwargs["threshold"] = box_threshold
    if "input_ids" in parameters:
        kwargs["input_ids"] = input_ids
    return post_process(outputs, **kwargs)


def load_sam_predictor(size: str, device: str, checkpoint_dir: Path):
    from sam2.build_sam import build_sam2
    from sam2.automatic_mask_generator import SAM2AutomaticMaskGenerator
    from sam2.sam2_image_predictor import SAM2ImagePredictor

    spec = SAM2_CHECKPOINTS[size]
    checkpoint_path = download_file(spec["url"], checkpoint_dir / Path(spec["url"]).name)
    print(f"Loading SAM 2.1 {size}: {checkpoint_path}")
    sam_model = build_sam2(spec["config"], str(checkpoint_path), device=device)
    predictor = SAM2ImagePredictor(sam_model)
    predictor.automatic_mask_generator = SAM2AutomaticMaskGenerator(
        sam_model,
        points_per_side=24,
        points_per_batch=64,
        pred_iou_thresh=0.72,
        stability_score_thresh=0.82,
        box_nms_thresh=0.75,
        min_mask_region_area=256,
        output_mode="binary_mask",
    )
    return predictor


def crop_analysis_frame(frame: np.ndarray, stereo_layout: str, stereo_eye: str = "left") -> tuple[np.ndarray, dict[str, Any]]:
    height, width = frame.shape[:2]
    if stereo_layout == "top-bottom" and stereo_eye in {"top-left", "top-right", "bottom-left", "bottom-right"}:
        half_width = width // 2
        half_height = height // 2
        x = half_width if stereo_eye.endswith("right") else 0
        y = half_height if stereo_eye.startswith("bottom") else 0
        cropped = frame[y : y + half_height, x : x + half_width]
        return cropped, {"x": x, "y": y, "width": half_width, "height": half_height}
    if stereo_layout == "top-bottom":
        cropped = frame[: height // 2, :]
        return cropped, {"x": 0, "y": 0, "width": width, "height": height // 2}
    if stereo_layout == "side-by-side":
        cropped = frame[:, : width // 2]
        return cropped, {"x": 0, "y": 0, "width": width // 2, "height": height}
    return frame, {"x": 0, "y": 0, "width": width, "height": height}


def parse_float_list(value: str) -> list[float]:
    parsed = []
    for part in str(value).split(","):
        part = part.strip()
        if not part:
            continue
        parsed.append(float(part))
    return parsed


def panorama_view_grid(args: argparse.Namespace) -> list[dict[str, Any]]:
    yaw_step = clamp(float(args.panorama_yaw_step), 20.0, 180.0)
    view_size = int(clamp(float(args.panorama_view_size), 512.0, 1536.0))
    fov = clamp(float(args.panorama_view_fov), 60.0, 120.0)
    pitches = parse_float_list(args.panorama_pitches) or [0.0]
    yaws = []
    yaw = -180.0
    while yaw < 180.0:
        yaws.append(round(yaw, 4))
        yaw += yaw_step
    return [
        {
            "yaw": yaw_value,
            "pitch": clamp(float(pitch_value), -75.0, 75.0),
            "fov": fov,
            "width": view_size,
            "height": view_size,
        }
        for pitch_value in pitches
        for yaw_value in yaws
    ]


def yaw_pitch_to_vector(yaw_deg: float, pitch_deg: float) -> np.ndarray:
    yaw = math.radians(yaw_deg)
    pitch = math.radians(pitch_deg)
    return np.asarray([
        math.cos(pitch) * math.sin(yaw),
        math.sin(pitch),
        math.cos(pitch) * math.cos(yaw),
    ], dtype=np.float32)


def perspective_basis(view: dict[str, Any]) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    yaw = math.radians(float(view["yaw"]))
    forward = yaw_pitch_to_vector(float(view["yaw"]), float(view["pitch"]))
    right = np.asarray([math.cos(yaw), 0.0, -math.sin(yaw)], dtype=np.float32)
    up = np.cross(forward, right)
    up_norm = np.linalg.norm(up)
    if up_norm > 0:
        up = up / up_norm
    return forward, right, up.astype(np.float32)


def perspective_point_to_vector(x: float, y: float, view: dict[str, Any]) -> np.ndarray:
    width = max(1.0, float(view["width"]))
    height = max(1.0, float(view["height"]))
    tan_half_x = math.tan(math.radians(float(view["fov"])) / 2.0)
    tan_half_y = tan_half_x * (height / width)
    plane_x = ((float(x) + 0.5) / width * 2.0 - 1.0) * tan_half_x
    plane_y = (1.0 - (float(y) + 0.5) / height * 2.0) * tan_half_y
    forward, right, up = perspective_basis(view)
    direction = forward + right * plane_x + up * plane_y
    norm = np.linalg.norm(direction)
    return direction / norm if norm > 0 else forward


def vector_to_panorama_point(direction: np.ndarray) -> dict[str, float]:
    direction = np.asarray(direction, dtype=np.float32)
    norm = np.linalg.norm(direction)
    if norm > 0:
        direction = direction / norm
    yaw = source_x_to_app_yaw((math.degrees(math.atan2(float(direction[0]), float(direction[2]))) / 360.0) + 0.5)
    pitch = math.degrees(math.asin(clamp(float(direction[1]), -1.0, 1.0)))
    return {
        "yaw": round(yaw, 4),
        "pitch": round(pitch, 4),
    }


def perspective_point_to_panorama_point(x: float, y: float, view: dict[str, Any]) -> dict[str, float]:
    return vector_to_panorama_point(perspective_point_to_vector(x, y, view))


def equirectangular_to_perspective(image_rgb: np.ndarray, view: dict[str, Any]) -> np.ndarray:
    src_height, src_width = image_rgb.shape[:2]
    out_width = int(view["width"])
    out_height = int(view["height"])
    tan_half_x = math.tan(math.radians(float(view["fov"])) / 2.0)
    tan_half_y = tan_half_x * (out_height / max(1, out_width))
    xs = ((np.arange(out_width, dtype=np.float32) + 0.5) / out_width * 2.0 - 1.0) * tan_half_x
    ys = (1.0 - (np.arange(out_height, dtype=np.float32) + 0.5) / out_height * 2.0) * tan_half_y
    grid_x, grid_y = np.meshgrid(xs, ys)
    forward, right, up = perspective_basis(view)
    dirs = (
        forward.reshape(1, 1, 3)
        + grid_x[..., None] * right.reshape(1, 1, 3)
        + grid_y[..., None] * up.reshape(1, 1, 3)
    )
    dirs /= np.linalg.norm(dirs, axis=2, keepdims=True)
    lon = np.arctan2(dirs[..., 0], dirs[..., 2])
    lat = np.arcsin(np.clip(dirs[..., 1], -1.0, 1.0))
    map_x = ((lon / (2.0 * math.pi) + 0.5) * src_width).astype(np.float32)
    map_y = ((0.5 - lat / math.pi) * src_height).astype(np.float32)
    map_x = np.mod(map_x, max(1, src_width))
    map_y = np.clip(map_y, 0, max(0, src_height - 1))
    return cv2.remap(image_rgb, map_x, map_y, interpolation=cv2.INTER_LINEAR, borderMode=cv2.BORDER_WRAP)


def perspective_polygon_to_panorama_points(
    points: list[tuple[float, float]],
    view: dict[str, Any],
) -> list[dict[str, float]]:
    return [perspective_point_to_panorama_point(x, y, view) for x, y in points]


def tracking_box_from_points(
    points: list[dict[str, float]],
    projection: str,
    width: int,
    height: int,
) -> tuple[float, float, float, float]:
    if projection == "equirectangular":
        xs = [app_yaw_to_source_x(float(point["yaw"])) * width for point in points if "yaw" in point]
        ys = [(0.5 - float(point["pitch"]) / 180.0) * height for point in points if "pitch" in point]
        if not xs or not ys:
            return (0.0, 0.0, 1.0, 1.0)
        if max(xs) - min(xs) > width / 2.0:
            xs = [x + width if x < width / 2.0 else x for x in xs]
        return (min(xs), min(ys), max(xs), max(ys))
    xs = [float(point["x"]) * width for point in points if "x" in point]
    ys = [float(point["y"]) * height for point in points if "y" in point]
    if not xs or not ys:
        return (0.0, 0.0, 1.0, 1.0)
    return (min(xs), min(ys), max(xs), max(ys))


def perspective_box_to_panorama_box(
    box: tuple[float, float, float, float],
    view: dict[str, Any],
    width: int,
    height: int,
) -> tuple[float, float, float, float]:
    x1, y1, x2, y2 = box
    points = [
        perspective_point_to_panorama_point(x1, y1, view),
        perspective_point_to_panorama_point(x2, y1, view),
        perspective_point_to_panorama_point(x2, y2, view),
        perspective_point_to_panorama_point(x1, y2, view),
    ]
    return tracking_box_from_points(points, "equirectangular", width, height)


def detection_regions(
    image_rgb: np.ndarray,
    projection: str,
    args: argparse.Namespace,
) -> list[dict[str, Any]]:
    if projection == "equirectangular" and args.panorama_projection_mode == "perspective":
        regions = []
        for view in panorama_view_grid(args):
            view_image = equirectangular_to_perspective(image_rgb, view)
            regions.append({
                "x": 0,
                "y": 0,
                "width": view["width"],
                "height": view["height"],
                "image": view_image,
                "projectionView": view,
            })
        return regions
    return iter_analysis_regions(image_rgb, args.tile_size, args.tile_overlap)


def detect_objects(
    image_rgb: np.ndarray,
    processor: Any,
    model: Any,
    device: str,
    min_score: float,
) -> list[dict[str, Any]]:
    image = Image.fromarray(image_rgb)
    task = "<OD>"
    inputs = processor(text=task, images=image, return_tensors="pt").to(device)
    if "pixel_values" in inputs:
        inputs["pixel_values"] = inputs["pixel_values"].to(dtype=next(model.parameters()).dtype)
    with torch.inference_mode():
        generated_ids = model.generate(
            input_ids=inputs["input_ids"],
            pixel_values=inputs["pixel_values"],
            max_new_tokens=2048,
            num_beams=3,
            do_sample=False,
        )
    generated_text = processor.batch_decode(generated_ids, skip_special_tokens=False)[0]
    parsed = processor.post_process_generation(
        generated_text,
        task=task,
        image_size=(image.width, image.height),
    ).get(task, {})
    labels = parsed.get("labels", []) or []
    boxes = parsed.get("bboxes", []) or []
    scores = parsed.get("scores", []) or [1.0] * len(boxes)
    detections = []
    for label, box, score in zip(labels, boxes, scores):
        score = float(score)
        if score < min_score:
            continue
        x1, y1, x2, y2 = [float(value) for value in box]
        if x2 <= x1 or y2 <= y1:
            continue
        detections.append({"label": normalize_label(label), "box": (x1, y1, x2, y2), "score": score})
    return detections


def normalize_grounding_label(label: Any) -> str:
    text = normalize_label(label).lower().strip(" .")
    text = re.sub(r"^(a|an|the)\s+", "", text)
    return text or "object"


def canonical_grounding_label(label: Any) -> str:
    normalized = normalize_grounding_label(label)
    alias = GROUNDING_LABEL_ALIASES.get(normalized)
    if alias:
        return alias
    for canonical, keywords in CANONICAL_LABEL_KEYWORDS:
        if any(re.search(rf"(?<![a-z0-9]){re.escape(keyword)}(?![a-z0-9])", normalized) for keyword in keywords):
            return canonical
    return normalized


def unique_taxonomy_labels(labels: Iterable[str]) -> list[str]:
    cleaned = []
    seen = set()
    for label in labels:
        normalized = normalize_grounding_label(label)
        if normalized and normalized not in seen:
            cleaned.append(normalized)
            seen.add(normalized)
    return cleaned


def auto_taxonomy_for_video(video_name: str, video_info: dict[str, Any]) -> list[str]:
    descriptor = " ".join(
        str(value)
        for value in [
            video_name,
            video_info.get("id", ""),
            video_info.get("label", ""),
            video_info.get("name", ""),
        ]
        if value
    ).lower().replace("-", "_")
    labels = list(DEFAULT_AUTO_TAXONOMY)
    for scene_key, scene_labels in SCENE_AUTO_TAXONOMIES.items():
        if scene_key in descriptor:
            labels.extend(scene_labels)
    return unique_taxonomy_labels(labels)


def taxonomy_chunks(labels: list[str], chunk_size: int) -> list[list[str]]:
    safe_size = max(1, int(chunk_size))
    cleaned = unique_taxonomy_labels(labels)
    return [cleaned[index:index + safe_size] for index in range(0, len(cleaned), safe_size)]


def grounding_prompt(labels: list[str]) -> str:
    return " ".join(f"{normalize_grounding_label(label)}." for label in labels)


def grounded_result_labels(result: dict[str, Any]) -> list[Any]:
    text_labels = result.get("text_labels")
    if text_labels:
        return list(text_labels)
    labels = result.get("labels")
    if labels is None:
        return []
    return list(labels)


def detect_grounded_objects(
    image_rgb: np.ndarray,
    processor: Any,
    model: Any,
    device: str,
    labels: list[str],
    box_threshold: float,
    text_threshold: float,
) -> list[dict[str, Any]]:
    if not labels:
        return []
    image = Image.fromarray(image_rgb)
    inputs = processor(images=image, text=grounding_prompt(labels), return_tensors="pt").to(device)
    inputs = cast_floating_inputs_to_model_dtype(inputs, model)
    with torch.inference_mode():
        outputs = model(**inputs)
    results = post_process_grounded_detections(
        processor,
        outputs,
        inputs.input_ids,
        box_threshold=box_threshold,
        text_threshold=text_threshold,
        target_sizes=[(image.height, image.width)],
    )[0]
    result_labels = grounded_result_labels(results)
    boxes = results.get("boxes", [])
    scores = results.get("scores", [])
    if boxes is None:
        boxes = []
    if scores is None:
        scores = []
    detections = []
    for label, box, score in zip(result_labels, boxes, scores):
        score = float(score)
        x1, y1, x2, y2 = [float(value) for value in box]
        if x2 <= x1 or y2 <= y1:
            continue
        detections.append({
            "label": canonical_grounding_label(label),
            "box": (x1, y1, x2, y2),
            "score": score,
        })
    return detections


def iter_analysis_regions(
    image_rgb: np.ndarray,
    tile_size: int,
    overlap: int,
) -> list[dict[str, Any]]:
    height, width = image_rgb.shape[:2]
    safe_tile_size = max(256, int(tile_size))
    safe_overlap = int(clamp(float(overlap), 0, safe_tile_size - 1))
    if width <= safe_tile_size and height <= safe_tile_size:
        return [{"x": 0, "y": 0, "width": width, "height": height, "image": image_rgb}]

    stride = max(1, safe_tile_size - safe_overlap)

    def starts(limit: int) -> list[int]:
        values = list(range(0, max(limit - safe_tile_size, 0) + 1, stride))
        final = max(0, limit - safe_tile_size)
        if not values or values[-1] != final:
            values.append(final)
        return values

    regions = []
    for y in starts(height):
        for x in starts(width):
            x2 = min(width, x + safe_tile_size)
            y2 = min(height, y + safe_tile_size)
            regions.append({
                "x": x,
                "y": y,
                "width": x2 - x,
                "height": y2 - y,
                "image": image_rgb[y:y2, x:x2],
            })
    return regions


def offset_box(box: tuple[float, float, float, float], offset_x: float, offset_y: float) -> tuple[float, float, float, float]:
    x1, y1, x2, y2 = box
    return (x1 + offset_x, y1 + offset_y, x2 + offset_x, y2 + offset_y)


def offset_polygon(points: list[tuple[float, float]], offset_x: float, offset_y: float) -> list[tuple[float, float]]:
    return [(x + offset_x, y + offset_y) for x, y in points]


def box_area(box: tuple[float, float, float, float]) -> float:
    x1, y1, x2, y2 = box
    return max(0.0, x2 - x1) * max(0.0, y2 - y1)


def filter_candidate_area(
    candidates: list[dict[str, Any]],
    frame_width: int,
    frame_height: int,
    min_area_ratio: float,
    max_area_ratio: float,
) -> list[dict[str, Any]]:
    frame_area = max(1.0, float(frame_width * frame_height))
    kept = []
    for candidate in candidates:
        area_ratio = box_area(candidate["box"]) / frame_area
        if area_ratio < min_area_ratio or area_ratio > max_area_ratio:
            continue
        kept.append(candidate)
    return kept


def per_frame_nms(candidates: list[dict[str, Any]], threshold: float) -> list[dict[str, Any]]:
    kept: list[dict[str, Any]] = []
    for candidate in sorted(candidates, key=lambda item: float(item.get("score", 0.0)), reverse=True):
        if all(
            candidate["label"] != existing["label"] or iou(candidate["box"], existing["box"]) < threshold
            for existing in kept
        ):
            kept.append(candidate)
    return kept


def run_sam_boxes(image_rgb: np.ndarray, predictor: Any, boxes: list[tuple[float, float, float, float]]):
    if not boxes:
        return []
    predictor.set_image(image_rgb)
    box_array = np.asarray(boxes, dtype=np.float32)
    masks, scores, _ = predictor.predict(
        point_coords=None,
        point_labels=None,
        box=box_array,
        multimask_output=False,
    )
    masks = np.asarray(masks)
    if masks.ndim == 4:
        masks = masks[:, 0, :, :]
    if masks.ndim == 2:
        masks = masks.reshape((1, masks.shape[0], masks.shape[1]))
    scores = np.asarray(scores).reshape(-1)
    return list(zip(masks.astype(bool), scores.tolist()))


def automatic_sam_masks(
    image_rgb: np.ndarray,
    predictor: Any,
    max_masks: int,
) -> list[dict[str, Any]]:
    generator = getattr(predictor, "automatic_mask_generator", None)
    if generator is None:
        return []
    masks = generator.generate(image_rgb)
    masks = sorted(
        masks,
        key=lambda item: (float(item.get("predicted_iou", 0.0)), float(item.get("area", 0.0))),
        reverse=True,
    )
    return masks[:max_masks]


def polygon_area(points: list[tuple[float, float]]) -> float:
    if len(points) < 3:
        return 0.0
    area = 0.0
    for index, current in enumerate(points):
        nxt = points[(index + 1) % len(points)]
        area += current[0] * nxt[1] - nxt[0] * current[1]
    return abs(area) / 2.0


def simplify_polygon(points: list[tuple[float, float]], max_points: int) -> list[tuple[float, float]]:
    if len(points) <= max_points:
        return points
    stride = math.ceil(len(points) / max_points)
    sampled = points[::stride]
    return sampled if len(sampled) >= 3 else points[:max_points]


def mask_to_polygon(mask: np.ndarray, max_points: int, epsilon_ratio: float) -> list[tuple[float, float]]:
    mask_u8 = (mask.astype(np.uint8) * 255)
    contours, _ = cv2.findContours(mask_u8, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    if not contours:
        return []
    contour = max(contours, key=cv2.contourArea)
    if cv2.contourArea(contour) < 4:
        return []
    epsilon = epsilon_ratio * cv2.arcLength(contour, closed=True)
    approx = cv2.approxPolyDP(contour, epsilon, closed=True)
    points = [(float(x), float(y)) for x, y in approx.reshape(-1, 2)]
    if len(points) < 3 or polygon_area(points) <= 1:
        hull = cv2.convexHull(contour)
        points = [(float(x), float(y)) for x, y in hull.reshape(-1, 2)]
    if len(points) > max_points:
        points = simplify_polygon(points, max_points)
    return points if len(points) >= 3 and polygon_area(points) > 1 else []


def normalize_polygon(
    points: list[tuple[float, float]],
    width: int,
    height: int,
    projection: str,
) -> list[dict[str, float]]:
    normalized = []
    for x, y in points:
        nx = clamp(x / max(width, 1), 0.0, 1.0)
        ny = clamp(y / max(height, 1), 0.0, 1.0)
        if projection == "equirectangular":
            normalized.append({
                "yaw": round(source_x_to_app_yaw(nx), 4),
                "pitch": round(90.0 - ny * 180.0, 4),
            })
        else:
            normalized.append({
                "x": round(nx, 6),
                "y": round(ny, 6),
            })
    return normalized


def iou(box_a: tuple[float, float, float, float], box_b: tuple[float, float, float, float]) -> float:
    ax1, ay1, ax2, ay2 = box_a
    bx1, by1, bx2, by2 = box_b
    inter_x1 = max(ax1, bx1)
    inter_y1 = max(ay1, by1)
    inter_x2 = min(ax2, bx2)
    inter_y2 = min(ay2, by2)
    inter_area = max(0.0, inter_x2 - inter_x1) * max(0.0, inter_y2 - inter_y1)
    area_a = max(0.0, ax2 - ax1) * max(0.0, ay2 - ay1)
    area_b = max(0.0, bx2 - bx1) * max(0.0, by2 - by1)
    denom = area_a + area_b - inter_area
    return inter_area / denom if denom > 0 else 0.0


def group_detections(detections: list[Detection], min_track_iou: float) -> list[dict[str, Any]]:
    tracks: list[dict[str, Any]] = []

    def add_detection(track: dict[str, Any], detection: Detection) -> None:
        for index, existing in enumerate(track["detections"]):
            if abs(existing.t - detection.t) <= 0.001:
                if detection.score > existing.score:
                    track["detections"][index] = detection
                    track["last_box"] = detection.box
                return
        track["detections"].append(detection)
        track["last_box"] = detection.box

    for detection in sorted(detections, key=lambda item: item.t):
        best_track = None
        best_score = 0.0
        for track in tracks:
            if track["label"] != detection.label:
                continue
            score = iou(track["last_box"], detection.box)
            if score > best_score:
                best_score = score
                best_track = track
        if best_track is not None and best_score >= min_track_iou:
            add_detection(best_track, detection)
        else:
            tracks.append({
                "id": stable_id(detection.label, detection.box, detection.t),
                "label": detection.label,
                "last_box": detection.box,
                "detections": [detection],
            })
    return tracks


def track_quality_gate(
    track: dict[str, Any],
    args: argparse.Namespace,
    sampled_frame_count: int,
) -> bool:
    detections: list[Detection] = track["detections"]
    if len(detections) < args.min_track_frames:
        return False
    mean_score = float(np.mean([item.score for item in detections])) if detections else 0.0
    if mean_score < args.min_track_mean_score:
        return False
    coverage = len(detections) / max(1, int(sampled_frame_count))
    if coverage < args.min_track_coverage:
        return False
    return True


def make_aoi_from_track(
    track: dict[str, Any],
    index: int,
    projection: str,
    analysis_padding_px: float,
) -> dict[str, Any]:
    detections: list[Detection] = track["detections"]
    first = detections[0]
    keyframes = [
        {
            "t": round(detection.t, 3),
            "points": detection.points,
        }
        for detection in detections
    ]
    all_yaws = [point["yaw"] for detection in detections for point in detection.points if "yaw" in point]
    all_pitches = [point["pitch"] for detection in detections for point in detection.points if "pitch" in point]
    all_xs = [point["x"] for detection in detections for point in detection.points if "x" in point]
    all_ys = [point["y"] for detection in detections for point in detection.points if "y" in point]
    aoi = {
        "id": track["id"],
        "label": track["label"],
        "color": COLORS[index % len(COLORS)],
        "shape": "polygon",
        "space": "panorama" if projection == "equirectangular" else "video",
        "points": first.points,
        "keyframes": keyframes,
        "analysisPaddingPx": analysis_padding_px,
        "metadata": {
            "generatedBy": "runpod-auto-aoi",
            "detector": track.get("detector", "automatic object detector"),
            "segmenter": "SAM 2.1",
            "frameCount": len(detections),
            "meanScore": round(float(np.mean([item.score for item in detections])), 4),
        },
    }
    if projection == "equirectangular":
        aoi.update({
            "yawMin": round(min(all_yaws), 4) if all_yaws else -180,
            "yawMax": round(max(all_yaws), 4) if all_yaws else 180,
            "pitchMin": round(min(all_pitches), 4) if all_pitches else -90,
            "pitchMax": round(max(all_pitches), 4) if all_pitches else 90,
        })
    else:
        aoi.update({
            "xMin": round(min(all_xs), 6) if all_xs else 0,
            "xMax": round(max(all_xs), 6) if all_xs else 1,
            "yMin": round(min(all_ys), 6) if all_ys else 0,
            "yMax": round(max(all_ys), 6) if all_ys else 1,
        })
    return aoi


def frame_times(duration_sec: float, interval_sec: float) -> list[float]:
    times = []
    current = 0.0
    while current <= duration_sec:
        times.append(round(current, 3))
        current += interval_sec
    if duration_sec and (not times or abs(times[-1] - duration_sec) > 0.1):
        times.append(round(duration_sec, 3))
    return times


def detect_frame_candidates(
    analysis_rgb: np.ndarray,
    detector: tuple[Any, Any],
    device: str,
    args: argparse.Namespace,
    projection: str,
    taxonomy: list[str] | None = None,
) -> list[dict[str, Any]]:
    processor, model = detector
    height, width = analysis_rgb.shape[:2]
    candidates: list[dict[str, Any]] = []

    if args.detector_backend == "grounding-dino":
        chunks = taxonomy_chunks(taxonomy or DEFAULT_AUTO_TAXONOMY, args.taxonomy_chunk_size)
        for region in detection_regions(analysis_rgb, projection, args):
            region_image = region["image"]
            for label_chunk in chunks:
                for candidate in detect_grounded_objects(
                    region_image,
                    processor,
                    model,
                    device,
                    labels=label_chunk,
                    box_threshold=args.box_threshold,
                    text_threshold=args.text_threshold,
                ):
                    local_box = candidate["box"]
                    projection_view = region.get("projectionView")
                    full_box = (
                        perspective_box_to_panorama_box(local_box, projection_view, width, height)
                        if projection_view
                        else offset_box(local_box, region["x"], region["y"])
                    )
                    candidates.append({
                        **candidate,
                        "box": full_box,
                        "local_box": local_box,
                        "region": region,
                    })
    else:
        full_region = {"x": 0, "y": 0, "width": width, "height": height, "image": analysis_rgb}
        for candidate in detect_objects(
            analysis_rgb,
            processor,
            model,
            device,
            min_score=args.min_score,
        ):
            candidates.append({
                **candidate,
                "local_box": candidate["box"],
                "region": full_region,
            })

    candidates = filter_candidate_area(
        candidates,
        frame_width=width,
        frame_height=height,
        min_area_ratio=args.min_area_ratio,
        max_area_ratio=args.max_area_ratio,
    )
    candidates = per_frame_nms(candidates, args.frame_nms_iou)
    if args.max_detections_per_frame:
        candidates = sorted(candidates, key=lambda item: float(item.get("score", 0.0)), reverse=True)
        candidates = candidates[: args.max_detections_per_frame]
    return candidates


def append_segmented_candidates(
    detections: list[Detection],
    candidates: list[dict[str, Any]],
    sam_predictor: Any,
    projection: str,
    crop: dict[str, Any],
    max_points: int,
    epsilon_ratio: float,
    min_mask_score: float,
    timestamp: float,
) -> None:
    candidates_by_region: dict[tuple[Any, ...], list[dict[str, Any]]] = {}
    for candidate in candidates:
        region = candidate["region"]
        projection_view = region.get("projectionView")
        region_key = (
            "perspective",
            projection_view["yaw"],
            projection_view["pitch"],
            projection_view["fov"],
            projection_view["width"],
            projection_view["height"],
        ) if projection_view else (int(region["x"]), int(region["y"]), int(region["width"]), int(region["height"]))
        candidates_by_region.setdefault(region_key, []).append(candidate)

    for region_candidates in candidates_by_region.values():
        region = region_candidates[0]["region"]
        projection_view = region.get("projectionView")
        masks_and_scores = run_sam_boxes(
            region["image"],
            sam_predictor,
            [item["local_box"] for item in region_candidates],
        )
        for candidate, (mask, mask_score) in zip(region_candidates, masks_and_scores):
            if mask_score < min_mask_score:
                continue
            polygon = mask_to_polygon(mask, max_points=max_points, epsilon_ratio=epsilon_ratio)
            if len(polygon) < 3:
                continue
            if projection_view:
                points = perspective_polygon_to_panorama_points(polygon, projection_view)
            else:
                full_polygon = offset_polygon(polygon, float(region["x"]), float(region["y"]))
                points = normalize_polygon(full_polygon, int(crop["width"]), int(crop["height"]), projection)
            tracking_box = tracking_box_from_points(points, projection, int(crop["width"]), int(crop["height"]))
            detections.append(Detection(
                label=candidate["label"],
                score=float(candidate["score"]) * float(mask_score),
                box=tracking_box,
                points=points,
                t=timestamp,
            ))


def process_job(
    job_path: Path,
    videos_dir: Path,
    output_dir: Path,
    detector: tuple[Any, Any],
    sam_predictor: Any,
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
    max_points = int(clamp(policy_number(policy, "maxPolygonPoints", 160), 12, 240))
    epsilon_ratio = clamp(policy_number(policy, "polygonSimplificationEpsilon", 0.0015), 0.0005, 0.02)
    padding_px = policy_number(policy, "analysisPaddingPx", 18)
    min_score = args.min_score
    min_track_iou = args.min_track_iou

    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise RuntimeError(f"OpenCV could not open {video_path}")
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    frame_count = cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0.0
    duration = frame_count / fps if fps else 0.0
    times = frame_times(duration, sample_interval)
    processor, model = detector
    all_detections: list[Detection] = []
    taxonomy = auto_taxonomy_for_video(str(video_name), video_info)
    print(f"\nProcessing {video_name}: {duration:.2f}s, {len(times)} sampled frames")
    if args.detector_backend == "grounding-dino":
        print(f"Using {len(taxonomy)} automatic object labels")

    for timestamp in tqdm(times, desc=video_path.stem):
        cap.set(cv2.CAP_PROP_POS_MSEC, timestamp * 1000.0)
        ok, frame_bgr = cap.read()
        if not ok:
            continue
        analysis_bgr, crop = crop_analysis_frame(frame_bgr, stereo_layout, stereo_eye)
        analysis_rgb = cv2.cvtColor(analysis_bgr, cv2.COLOR_BGR2RGB)
        candidates = detect_frame_candidates(analysis_rgb, detector, device, args, projection=projection, taxonomy=taxonomy)
        if candidates:
            append_segmented_candidates(
                all_detections,
                candidates,
                sam_predictor,
                projection,
                crop,
                max_points=max_points,
                epsilon_ratio=epsilon_ratio,
                min_mask_score=args.min_mask_score,
                timestamp=timestamp,
            )
        elif not args.disable_sam_fallback:
            fallback_masks = automatic_sam_masks(analysis_rgb, sam_predictor, args.max_auto_masks_per_frame)
            for mask_index, fallback in enumerate(fallback_masks):
                mask = np.asarray(fallback.get("segmentation"), dtype=bool)
                if mask.size == 0:
                    continue
                polygon = mask_to_polygon(mask, max_points=max_points, epsilon_ratio=epsilon_ratio)
                if len(polygon) < 3:
                    continue
                x, y, width, height = [float(value) for value in fallback.get("bbox", [0, 0, 0, 0])]
                points = normalize_polygon(polygon, int(crop["width"]), int(crop["height"]), projection)
                all_detections.append(Detection(
                    label=f"auto-region-{mask_index + 1}",
                    score=float(fallback.get("predicted_iou", 0.0)),
                    box=(x, y, x + width, y + height),
                    points=points,
                    t=timestamp,
                ))
    cap.release()

    tracks = group_detections(all_detections, min_track_iou=min_track_iou)
    aois = [
        make_aoi_from_track(track, index, projection, analysis_padding_px=padding_px)
        for index, track in enumerate(tracks)
        if track_quality_gate(track, args, sampled_frame_count=len(times))
    ]
    payload = {
        "kind": "aoi-project",
        "version": 1,
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "source": "runpod-auto-aoi",
        "video": video_info,
        "aoiPolicy": {
            **policy,
            "detectorBackend": args.detector_backend,
            "detectorModel": args.grounding_model if args.detector_backend == "grounding-dino" else args.detector_model,
            "groundingModel": args.grounding_model if args.detector_backend == "grounding-dino" else None,
            "segmenterModel": f"SAM2.1-{args.sam_size}",
            "sampleIntervalSec": sample_interval,
            "minScore": min_score,
            "boxThreshold": args.box_threshold,
            "textThreshold": args.text_threshold,
            "minMaskScore": args.min_mask_score,
            "minTrackFrames": args.min_track_frames,
            "minTrackMeanScore": args.min_track_mean_score,
            "minTrackCoverage": args.min_track_coverage,
            "minTrackIou": min_track_iou,
            "frameNmsIou": args.frame_nms_iou,
            "tileSize": args.tile_size,
            "tileOverlap": args.tile_overlap,
            "panoramaProjectionMode": args.panorama_projection_mode,
            "panoramaViewSize": args.panorama_view_size,
            "panoramaViewFov": args.panorama_view_fov,
            "panoramaYawStep": args.panorama_yaw_step,
            "panoramaPitches": args.panorama_pitches,
            "autoTaxonomyCount": len(taxonomy),
            "outputShape": "polygon",
            "autoPromptMode": "built-in-taxonomy-grounding-dino" if args.detector_backend == "grounding-dino" else "open-vocabulary-object-detection",
        },
        "aois": aois,
        "stats": {
            "candidateDetections": len(all_detections),
            "tracks": len(tracks),
            "aois": len(aois),
            "filteredTracks": max(0, len(tracks) - len(aois)),
            "sampledFrames": len(times),
        },
    }
    out_path = output_dir / f"{video_path.stem}.generated-aois.json"
    write_json(out_path, payload)
    print(f"Wrote {out_path} ({len(aois)} AOIs)")
    if device == "cuda":
        torch.cuda.empty_cache()
    return out_path


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate polygon AOIs from videos on RunPod.")
    parser.add_argument("--jobs-dir", type=Path, default=Path("jobs"))
    parser.add_argument("--videos-dir", type=Path, default=Path("videos"))
    parser.add_argument("--output-dir", type=Path, default=Path("outputs"))
    parser.add_argument("--checkpoint-dir", type=Path, default=Path("checkpoints"))
    parser.add_argument("--detector-backend", choices=["florence", "grounding-dino"], default="grounding-dino")
    parser.add_argument("--detector-model", default="microsoft/Florence-2-large")
    parser.add_argument("--grounding-model", default="IDEA-Research/grounding-dino-base")
    parser.add_argument("--sam-size", choices=sorted(SAM2_CHECKPOINTS), default="large")
    parser.add_argument("--sample-interval", type=float, default=None)
    parser.add_argument("--min-score", type=float, default=0.05)
    parser.add_argument("--box-threshold", type=float, default=0.18)
    parser.add_argument("--text-threshold", type=float, default=0.18)
    parser.add_argument("--min-mask-score", type=float, default=0.0)
    parser.add_argument("--min-track-iou", type=float, default=0.15)
    parser.add_argument("--min-track-frames", type=int, default=1)
    parser.add_argument("--min-track-mean-score", type=float, default=0.0)
    parser.add_argument("--min-track-coverage", type=float, default=0.0)
    parser.add_argument("--max-detections-per-frame", type=int, default=80)
    parser.add_argument("--max-auto-masks-per-frame", type=int, default=12)
    parser.add_argument("--frame-nms-iou", type=float, default=0.55)
    parser.add_argument("--tile-size", type=int, default=1536)
    parser.add_argument("--tile-overlap", type=int, default=256)
    parser.add_argument("--taxonomy-chunk-size", type=int, default=12)
    parser.add_argument("--min-area-ratio", type=float, default=0.00002)
    parser.add_argument("--max-area-ratio", type=float, default=0.65)
    parser.add_argument("--panorama-projection-mode", choices=["direct", "perspective"], default="direct")
    parser.add_argument("--panorama-view-size", type=int, default=1024)
    parser.add_argument("--panorama-view-fov", type=float, default=90.0)
    parser.add_argument("--panorama-yaw-step", type=float, default=60.0)
    parser.add_argument("--panorama-pitches", default="-35,0,35")
    parser.add_argument("--disable-sam-fallback", action="store_true")
    parser.add_argument("--cpu", action="store_true")
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    device = "cuda" if torch.cuda.is_available() and not args.cpu else "cpu"
    if device != "cuda":
        print("WARNING: CUDA is not available. This will be very slow.", file=sys.stderr)
    else:
        torch.backends.cuda.matmul.allow_tf32 = True
        print(f"CUDA device: {torch.cuda.get_device_name(0)}")
    job_paths = sorted(args.jobs_dir.glob("*.json"))
    if not job_paths:
        raise FileNotFoundError(f"No job JSON files found in {args.jobs_dir}")
    args.output_dir.mkdir(parents=True, exist_ok=True)
    detector = (
        load_grounding_detector(args.grounding_model, device)
        if args.detector_backend == "grounding-dino"
        else load_detector(args.detector_model, device)
    )
    sam_predictor = load_sam_predictor(args.sam_size, device, args.checkpoint_dir)
    outputs = []
    for job_path in job_paths:
        outputs.append(process_job(
            job_path=job_path,
            videos_dir=args.videos_dir,
            output_dir=args.output_dir,
            detector=detector,
            sam_predictor=sam_predictor,
            device=device,
            args=args,
        ))
    manifest = {
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "outputs": [str(path) for path in outputs],
    }
    write_json(args.output_dir / "manifest.json", manifest)
    print("\nDone. Download the JSON files in outputs/ and import them in the app.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
