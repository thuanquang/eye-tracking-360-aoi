import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const scriptPath = new URL('../scripts/runpod_scene_surface_aoi_batch.py', import.meta.url);
const runnerPath = new URL('../scripts/RUN_SKY_GROUND_ON_RUNPOD.sh', import.meta.url);

test('RunPod scene surface script generates semantic sky and ground AOIs', () => {
  assert.equal(existsSync(scriptPath), true);
  const script = readFileSync(scriptPath, 'utf8');

  assert.match(script, /AutoModelForSemanticSegmentation/);
  assert.match(script, /SURFACE_LABEL_GROUPS = {/);
  assert.match(script, /"sky": \{/);
  assert.match(script, /"ground": \{/);
  assert.match(script, /return any\(model_part in accepted_labels for model_part in model_parts\)/);
  assert.doesNotMatch(script, /accepted in model_part/);
  assert.match(script, /runpod-scene-surface-aoi/);
  assert.match(script, /"sceneSurface": True/);
  assert.match(script, /normalize_polygon\(polygon, width, height, projection\)/);
  assert.match(script, /\.scene-surface-aois\.json/);
});

test('RunPod sky ground runner uses the high quality SegFormer semantic model', () => {
  assert.equal(existsSync(runnerPath), true);
  const runner = readFileSync(runnerPath, 'utf8');

  assert.match(runner, /python3\s+-m\s+venv\s+--system-site-packages\s+\.venv-aoi/);
  assert.match(runner, /runpod_scene_surface_aoi_batch\.py/);
  assert.match(runner, /runpod_scene_surface_requirements\.txt/);
  assert.doesNotMatch(runner, /runpod_requirements\.txt/);
  assert.match(runner, /--segmentation-model\s+nvidia\/segformer-b5-finetuned-ade-640-640/);
  assert.match(runner, /--surface-labels\s+sky,ground/);
  assert.match(runner, /--output-dir\s+outputs-scene-surfaces/);
});
