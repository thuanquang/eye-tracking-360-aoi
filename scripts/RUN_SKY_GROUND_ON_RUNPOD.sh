#!/usr/bin/env bash
set -euo pipefail

python3 -m venv --system-site-packages .venv-aoi
source .venv-aoi/bin/activate
python -m pip install --upgrade pip
python -m pip install -r runpod_scene_surface_requirements.txt
python runpod_scene_surface_aoi_batch.py \
  --jobs-dir jobs \
  --videos-dir videos \
  --output-dir outputs-scene-surfaces \
  --segmentation-model nvidia/segformer-b5-finetuned-ade-640-640 \
  --surface-labels sky,ground \
  --sample-interval 0.20 \
  --min-area-ratio 0.01 \
  --min-keyframes 8 \
  --max-polygon-points 220 \
  --polygon-simplification-epsilon 0.001 \
  --analysis-padding-px 12 \
  --morphology-kernel 9 \
  --close-iterations 2 \
  --open-iterations 1
