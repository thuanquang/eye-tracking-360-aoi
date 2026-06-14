import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

const script = readFileSync(new URL('../scripts/runpod_auto_aoi_batch.py', import.meta.url), 'utf8');
const runner = readFileSync(new URL('../scripts/RUN_ME_ON_RUNPOD.sh', import.meta.url), 'utf8');
const groundingLoader = script.slice(
  script.indexOf('def load_grounding_detector'),
  script.indexOf('def get_model_floating_dtype'),
);
const uploadJobsDir = new URL('../runpod-aoi-upload/jobs/', import.meta.url);
const uploadVideosDir = new URL('../runpod-aoi-upload/videos/', import.meta.url);

test('RunPod batch script supports tiled GroundingDINO automatic discovery', () => {
  assert.match(script, /AutoModelForZeroShotObjectDetection/);
  assert.match(script, /DEFAULT_AUTO_TAXONOMY/);
  assert.match(script, /iter_analysis_regions/);
  assert.match(script, /--detector-backend/);
  assert.match(script, /--tile-size/);
  assert.match(script, /--tile-overlap/);
});

test('GroundingDINO inputs are cast to the model floating dtype before inference', () => {
  assert.match(script, /def cast_floating_inputs_to_model_dtype/);
  assert.match(script, /torch\.is_floating_point\(value\)/);
  assert.match(script, /inputs = cast_floating_inputs_to_model_dtype\(inputs, model\)/);
});

test('GroundingDINO post-processing adapts to transformers threshold parameter names', () => {
  assert.match(script, /def post_process_grounded_detections/);
  assert.match(script, /inspect\.signature\(post_process\)\.parameters/);
  assert.match(script, /if "box_threshold" in parameters:/);
  assert.match(script, /kwargs\["threshold"\] = box_threshold/);
  assert.match(script, /kwargs\["input_ids"\] = input_ids/);
});

test('GroundingDINO prefers text_labels over integer label ids', () => {
  assert.match(script, /def grounded_result_labels/);
  assert.match(script, /text_labels = result\.get\("text_labels"\)/);
  assert.match(script, /return list\(text_labels\)/);
  assert.match(script, /result_labels = grounded_result_labels\(results\)/);
});

test('RunPod automatic taxonomy expands by fixed study video scene', () => {
  assert.match(script, /SCENE_AUTO_TAXONOMIES = {/);
  assert.match(script, /"nguyen_hue": \[/);
  assert.match(script, /"motorbike"/);
  assert.match(script, /"traffic light"/);
  assert.match(script, /"crosswalk"/);
  assert.doesNotMatch(script, /"modern": \[/);
  assert.match(script, /def auto_taxonomy_for_video/);
  assert.match(script, /if scene_key in descriptor:/);
  assert.match(script, /taxonomy = auto_taxonomy_for_video\(str\(video_name\), video_info\)/);
  assert.match(script, /autoTaxonomyCount/);
});

test('RunPod upload package targets only the four Nguyen Hue videos', () => {
  const expectedVideoNames = [
    'nguyen-hue-2d-view-0500-0530-yaw0.mp4',
    'nguyen-hue-2d-view-0532-0602-yaw-45.mp4',
    'nguyen-hue-360-0500-0530.mp4',
    'nguyen-hue-360-0532-0602.mp4',
  ];
  const jobNames = readdirSync(uploadJobsDir)
    .filter((name) => name.endsWith('.json'))
    .sort();
  const videoNames = readdirSync(uploadVideosDir)
    .filter((name) => name.endsWith('.mp4'))
    .sort();
  const jobs = jobNames.map((name) => JSON.parse(readFileSync(new URL(name, uploadJobsDir), 'utf8')));

  assert.deepEqual(videoNames, expectedVideoNames);
  assert.deepEqual(jobNames, expectedVideoNames.map((name) => name.replace(/\.mp4$/, '.json')).sort());
  assert.deepEqual(jobs.map((job) => job.video.name).sort(), expectedVideoNames);
  assert.equal(jobs.filter((job) => job.video.projection === 'equirectangular').length, 2);
  assert.equal(jobs.filter((job) => job.video.projection === 'flat').length, 2);
  assert.ok(jobs.every((job) => job.video.stereoLayout === 'mono'));
  assert.ok(jobs.every((job) => job.aoiPolicy.automaticDiscovery === true));
  assert.ok(jobs.every((job) => job.aoiPolicy.outputShape === 'polygon'));
});

test('GroundingDINO canonicalizes duplicate-prone scene labels', () => {
  assert.match(script, /GROUNDING_LABEL_ALIASES = {/);
  assert.match(script, /"dancer": "person"/);
  assert.match(script, /"sampan": "boat"/);
  assert.match(script, /"high-rise building": "building"/);
  assert.match(script, /CANONICAL_LABEL_KEYWORDS = \[/);
  assert.match(script, /\("person", \["person", "man", "woman"/);
  assert.match(script, /def canonical_grounding_label/);
  assert.match(script, /re\.search\(rf"\(\?<!\[a-z0-9\]\)/);
  assert.match(script, /"label": canonical_grounding_label\(label\)/);
});

test('RunPod grouping keeps only one detection per track timestamp', () => {
  assert.match(script, /def add_detection\(track: dict\[str, Any\], detection: Detection\) -> None:/);
  assert.match(script, /abs\(existing\.t - detection\.t\) <= 0\.001/);
  assert.match(script, /if detection\.score > existing\.score:/);
  assert.match(script, /track\["detections"\]\[index\] = detection/);
  assert.match(script, /add_detection\(best_track, detection\)/);
});

test('RunPod maps 360 videos through perspective views before SAM polygon export', () => {
  assert.match(script, /def panorama_view_grid/);
  assert.match(script, /def equirectangular_to_perspective/);
  assert.match(script, /APP_VIEWER_YAW_OFFSET_DEGREES = -90\.0/);
  assert.match(script, /def source_x_to_app_yaw/);
  assert.match(script, /def app_yaw_to_source_x/);
  assert.match(script, /def perspective_point_to_panorama_point/);
  assert.match(script, /def perspective_polygon_to_panorama_points/);
  assert.match(script, /"yaw": round\(source_x_to_app_yaw\(nx\), 4\)/);
  assert.match(script, /xs = \[app_yaw_to_source_x\(float\(point\["yaw"\]\)\) \* width/);
  assert.match(script, /"projectionView"/);
  assert.match(script, /--panorama-projection-mode/);
  assert.match(runner, /--panorama-projection-mode\s+perspective/);
});

test('RunPod crops stereo frames before flat or panorama AOI generation', () => {
  assert.match(script, /stereo_eye = video_info\.get\("stereoEye"\) or job\.get\("stereoEye"\) or "left"/);
  assert.match(script, /analysis_bgr,\s*crop = crop_analysis_frame\(frame_bgr,\s*stereo_layout,\s*stereo_eye\)/);
  assert.match(script, /if stereo_layout == "top-bottom" and stereo_eye in \{"top-left", "top-right", "bottom-left", "bottom-right"\}:/);
  assert.doesNotMatch(script, /stereo_layout if projection == "equirectangular" else "mono"/);
});

test('RunPod filters noisy low-confidence short tracks after segmentation', () => {
  assert.match(script, /def track_quality_gate/);
  assert.match(script, /mean_score = float\(np\.mean/);
  assert.match(script, /args\.min_track_mean_score/);
  assert.match(script, /args\.min_track_coverage/);
  assert.match(script, /"minTrackMeanScore": args\.min_track_mean_score/);
  assert.match(runner, /--min-track-mean-score\s+0\.22/);
  assert.match(runner, /--min-track-coverage\s+0\.06/);
});

test('GroundingDINO loads in float32 to avoid mixed text and vision dtype crashes', () => {
  assert.match(groundingLoader, /dtype = torch\.float32/);
  assert.doesNotMatch(groundingLoader, /torch\.float16/);
});

test('RunPod command uses the high quality automatic detector path', () => {
  assert.match(runner, /--detector-backend\s+grounding-dino/);
  assert.match(runner, /--grounding-model\s+IDEA-Research\/grounding-dino-base/);
  assert.match(runner, /--sam-size\s+large/);
  assert.match(runner, /--min-track-frames\s+8/);
  assert.doesNotMatch(runner, /microsoft\/Florence-2-large/);
});

test('RunPod command installs dependencies inside a local virtualenv', () => {
  assert.match(runner, /python3?\s+-m\s+venv\s+\.venv-aoi/);
  assert.match(runner, /source\s+\.venv-aoi\/bin\/activate/);
  const venvIndex = runner.indexOf('python3 -m venv .venv-aoi');
  const activateIndex = runner.indexOf('source .venv-aoi/bin/activate');
  const pipIndex = runner.indexOf('python -m pip install --upgrade pip');
  assert.ok(venvIndex >= 0);
  assert.ok(activateIndex > venvIndex);
  assert.ok(pipIndex > activateIndex);
});
