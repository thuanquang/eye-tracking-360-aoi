#!/usr/bin/env bash
set -euo pipefail

python3 -m venv .venv-aoi
source .venv-aoi/bin/activate
python -m pip install --upgrade pip
python -m pip install -r runpod_requirements.txt
python runpod_auto_aoi_batch.py \
  --jobs-dir jobs \
  --videos-dir videos \
  --output-dir outputs-absolute-quality \
  --detector-backend grounding-dino \
  --grounding-model IDEA-Research/grounding-dino-base \
  --sam-size large \
  --sample-interval 0.20 \
  --box-threshold 0.18 \
  --text-threshold 0.18 \
  --min-mask-score 0 \
  --min-track-iou 0.08 \
  --min-track-frames 8 \
  --min-track-mean-score 0.22 \
  --min-track-coverage 0.06 \
  --max-detections-per-frame 160 \
  --frame-nms-iou 0.35 \
  --tile-size 1536 \
  --tile-overlap 256 \
  --taxonomy-chunk-size 10 \
  --min-area-ratio 0.00002 \
  --max-area-ratio 0.65 \
  --panorama-projection-mode perspective \
  --panorama-view-size 1024 \
  --panorama-view-fov 90 \
  --panorama-yaw-step 60 \
  --panorama-pitches=-35,0,35 \
  --disable-sam-fallback
