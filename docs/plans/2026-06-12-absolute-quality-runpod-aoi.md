# Absolute Quality RunPod AOI Regeneration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Regenerate the six study AOI files with higher-quality fully automatic polygon object annotations on the existing RunPod RTX 3090.

**Architecture:** Keep the app-side fixed-video metadata as the source of truth, then replace the weak Florence-only discovery run with a tiled open-vocabulary detection pass plus SAM 2.1 polygon segmentation. The RunPod pipeline should run without user object prompts, use a built-in broad taxonomy, preserve correct 2D/3D/stereo metadata, and output importable AOI JSON plus preview artifacts for review before study use.

**Tech Stack:** Browser app metadata in `src/app/studyVideos.js`, RunPod Python batch script, Hugging Face Transformers GroundingDINO, SAM 2.1, OpenCV, PowerShell/SSH/SCP, Node test runner.

---

### Task 1: Freeze The Visual Diagnosis

**Files:**
- Read: `C:\Users\Wang\Desktop\eye-tracking-360-aoi\src\app\studyVideos.js`
- Read: `C:\Users\Wang\Desktop\eye-tracking-360-aoi\runpod-aoi-results\outputs\*.json`
- Read: `C:\Users\Wang\Desktop\eye-tracking-360-aoi\runpod-aoi-results-enhanced\outputs\*.json`
- Create: `C:\Users\Wang\Desktop\eye-tracking-360-aoi\diagnostics\absolute-quality-aoi-summary.json`

**Step 1: Summarize existing outputs**

Run:

```powershell
node -e "const fs=require('fs'); for (const dir of ['runpod-aoi-results/outputs','runpod-aoi-results-enhanced/outputs']) for (const f of fs.readdirSync(dir).filter(x=>x.endsWith('.json')&&x!=='manifest.json')) { const j=JSON.parse(fs.readFileSync(`${dir}/${f}`,'utf8')); console.log(dir, f, j.video?.projection, j.video?.stereoLayout, j.aois?.length); }"
```

Expected: Confirms old Modern 3D outputs have stale `stereoLayout: "mono"`, 3D clips are under-detected, Modern 2D is sparse, and Tam Coc 2D has many `auto-region-*` duplicates.

**Step 2: Capture viewer screenshots**

Use Computer Use or Playwright to load each study video and problematic AOI file.

Expected: Screenshots show whether the displayed video is geometrically sane and whether AOIs are wrong because of viewer projection, stale metadata, or detection quality.

**Step 3: Save findings**

Create `diagnostics/absolute-quality-aoi-summary.json` with per-clip notes:

```json
{
  "culture-3d": "Viewer metadata mono/equirectangular; AOIs under-detect people/architecture.",
  "modern-3d": "Viewer metadata top-bottom/equirectangular; old AOI JSON stereo metadata is stale.",
  "nature-2d": "Detection output overuses anonymous auto-region tracks."
}
```

### Task 2: Add A Regression Test For The RunPod Upgrade

**Files:**
- Create: `C:\Users\Wang\Desktop\eye-tracking-360-aoi\tests\runpodAutoAoiBatch.test.js`
- Read: `C:\Users\Wang\Desktop\eye-tracking-360-aoi\scripts\runpod_auto_aoi_batch.py`
- Read: `C:\Users\Wang\Desktop\eye-tracking-360-aoi\scripts\RUN_ME_ON_RUNPOD.sh`

**Step 1: Write the failing test**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const script = readFileSync(new URL('../scripts/runpod_auto_aoi_batch.py', import.meta.url), 'utf8');
const runner = readFileSync(new URL('../scripts/RUN_ME_ON_RUNPOD.sh', import.meta.url), 'utf8');

test('RunPod batch script supports tiled GroundingDINO automatic discovery', () => {
  assert.match(script, /AutoModelForZeroShotObjectDetection/);
  assert.match(script, /DEFAULT_AUTO_TAXONOMY/);
  assert.match(script, /iter_analysis_regions/);
  assert.match(script, /--detector-backend/);
  assert.match(script, /--tile-size/);
  assert.match(script, /--tile-overlap/);
});

test('RunPod command uses the high quality automatic detector path', () => {
  assert.match(runner, /--detector-backend\s+grounding-dino/);
  assert.match(runner, /--grounding-model\s+IDEA-Research\/grounding-dino-base/);
  assert.match(runner, /--sam-size\s+large/);
  assert.doesNotMatch(runner, /microsoft\/Florence-2-large/);
});
```

**Step 2: Run test to verify it fails**

Run:

```powershell
npm test -- tests/runpodAutoAoiBatch.test.js
```

Expected: FAIL because the current script is Florence-only and the runner still calls `--detector-model microsoft/Florence-2-large`.

### Task 3: Implement Tiled GroundingDINO + SAM2 Detection

**Files:**
- Modify: `C:\Users\Wang\Desktop\eye-tracking-360-aoi\scripts\runpod_auto_aoi_batch.py`
- Modify: `C:\Users\Wang\Desktop\eye-tracking-360-aoi\scripts\runpod_requirements.txt`
- Modify: `C:\Users\Wang\Desktop\eye-tracking-360-aoi\scripts\RUN_ME_ON_RUNPOD.sh`

**Step 1: Add detector backend selection**

Add CLI flags:

```python
parser.add_argument("--detector-backend", choices=["florence", "grounding-dino"], default="grounding-dino")
parser.add_argument("--grounding-model", default="IDEA-Research/grounding-dino-base")
parser.add_argument("--box-threshold", type=float, default=0.18)
parser.add_argument("--text-threshold", type=float, default=0.18)
parser.add_argument("--tile-size", type=int, default=1536)
parser.add_argument("--tile-overlap", type=int, default=256)
parser.add_argument("--taxonomy-chunk-size", type=int, default=12)
```

**Step 2: Add built-in no-prompt taxonomy**

Add `DEFAULT_AUTO_TAXONOMY` with broad study-relevant object labels such as `person`, `dancer`, `fan`, `drum`, `temple`, `building`, `tree`, `bench`, `car`, `street sign`, `boat`, `river`, `rock`, `mountain`, and `plant`.

**Step 3: Tile analysis frames**

Implement `iter_analysis_regions(image_rgb, tile_size, overlap)` so 4K/8K equirectangular frames are analyzed in overlapping crops instead of as one tiny-object panorama.

**Step 4: Run GroundingDINO per taxonomy chunk per tile**

Load with:

```python
from transformers import AutoModelForZeroShotObjectDetection, AutoProcessor
```

Use lowercase period-ended prompts per Hugging Face GroundingDINO guidance, then map boxes back into the full analysis frame.

**Step 5: Segment each grounded box with SAM2-large**

Run SAM on the tile crop, convert the mask contour into polygon points, offset the polygon back to full analysis coordinates, and normalize to either video coordinates or panorama yaw/pitch.

**Step 6: Deduplicate before tracking**

Add per-frame NMS so overlapping tiled detections of the same object do not become duplicated AOIs.

**Step 7: Update output metadata**

Write `detectorBackend`, `groundingModel`, `tileSize`, `tileOverlap`, thresholds, and `autoPromptMode: "built-in-taxonomy-grounding-dino"`.

**Step 8: Run test to verify it passes**

Run:

```powershell
npm test -- tests/runpodAutoAoiBatch.test.js
```

Expected: PASS.

### Task 4: Sync The Upload Bundle

**Files:**
- Modify: `C:\Users\Wang\Desktop\eye-tracking-360-aoi\runpod-aoi-upload\runpod_auto_aoi_batch.py`
- Modify: `C:\Users\Wang\Desktop\eye-tracking-360-aoi\runpod-aoi-upload\runpod_requirements.txt`
- Modify: `C:\Users\Wang\Desktop\eye-tracking-360-aoi\runpod-aoi-upload\RUN_ME_ON_RUNPOD.sh`
- Verify: `C:\Users\Wang\Desktop\eye-tracking-360-aoi\runpod-aoi-upload\jobs\*.json`

**Step 1: Copy scripts into bundle**

Run:

```powershell
Copy-Item scripts\runpod_auto_aoi_batch.py runpod-aoi-upload\runpod_auto_aoi_batch.py -Force
Copy-Item scripts\runpod_requirements.txt runpod-aoi-upload\runpod_requirements.txt -Force
Copy-Item scripts\RUN_ME_ON_RUNPOD.sh runpod-aoi-upload\RUN_ME_ON_RUNPOD.sh -Force
```

**Step 2: Verify metadata**

Run:

```powershell
Get-ChildItem runpod-aoi-upload\jobs\*.json | ForEach-Object {
  $j = Get-Content -Raw $_ | ConvertFrom-Json
  [PSCustomObject]@{ Name=$_.Name; Projection=$j.video.projection; Stereo=$j.video.stereoLayout }
}
```

Expected: Culture 3D mono, Modern 3D top-bottom, Nature 3D mono, all 2D mono flat.

### Task 5: Upload And Start RunPod Job

**Files:**
- Upload: `C:\Users\Wang\Desktop\eye-tracking-360-aoi\runpod-aoi-upload\runpod_auto_aoi_batch.py`
- Upload: `C:\Users\Wang\Desktop\eye-tracking-360-aoi\runpod-aoi-upload\runpod_requirements.txt`
- Upload: `C:\Users\Wang\Desktop\eye-tracking-360-aoi\runpod-aoi-upload\RUN_ME_ON_RUNPOD.sh`
- Upload: `C:\Users\Wang\Desktop\eye-tracking-360-aoi\runpod-aoi-upload\jobs\*.json`

**Step 1: SSH smoke test**

Run:

```powershell
ssh -i "$env:USERPROFILE\.ssh\runpod_aoi_ed25519" -p 40136 root@213.192.2.72 "nvidia-smi"
```

Expected: RTX 3090 visible.

**Step 2: SCP updated scripts/jobs**

Run:

```powershell
scp -i "$env:USERPROFILE\.ssh\runpod_aoi_ed25519" -P 40136 runpod-aoi-upload\runpod_auto_aoi_batch.py runpod-aoi-upload\runpod_requirements.txt runpod-aoi-upload\RUN_ME_ON_RUNPOD.sh root@213.192.2.72:/workspace/runpod-aoi-upload/
scp -i "$env:USERPROFILE\.ssh\runpod_aoi_ed25519" -P 40136 runpod-aoi-upload\jobs\*.json root@213.192.2.72:/workspace/runpod-aoi-upload/jobs/
```

**Step 3: Start detached processing**

Run:

```bash
cd /workspace/runpod-aoi-upload
mkdir -p logs outputs-grounded
nohup bash RUN_ME_ON_RUNPOD.sh > logs/runpod-aoi-grounded.log 2>&1 &
echo $!
```

Expected: A PID is printed, and `logs/runpod-aoi-grounded.log` starts installing/loading models.

**Step 4: Monitor**

Run:

```powershell
ssh -i "$env:USERPROFILE\.ssh\runpod_aoi_ed25519" -p 40136 root@213.192.2.72 "tail -n 80 /workspace/runpod-aoi-upload/logs/runpod-aoi-grounded.log"
```

Expected: The process is running or has written new JSON files under `/workspace/runpod-aoi-upload/outputs-grounded`.

### Task 6: Review Before Import

**Files:**
- Download: `/workspace/runpod-aoi-upload/outputs-grounded/*.json`
- Create: `C:\Users\Wang\Desktop\eye-tracking-360-aoi\runpod-aoi-results-grounded\outputs\*.json`

**Step 1: Download outputs**

Run:

```powershell
scp -i "$env:USERPROFILE\.ssh\runpod_aoi_ed25519" -P 40136 -r root@213.192.2.72:/workspace/runpod-aoi-upload/outputs-grounded runpod-aoi-results-grounded\
```

**Step 2: Summarize AOI counts**

Run the same JSON summary command from Task 1.

Expected: More meaningful object labels than Florence-only, fewer anonymous `auto-region-*` duplicates, and Modern 3D metadata set to `top-bottom`.

**Step 3: Visual preview**

Load each output in the app and capture screenshots before using the files for participants.

Expected: Clear polygon edges around visible objects. If a clip still fails, adjust thresholds/taxonomy for that clip and rerun only that job.
