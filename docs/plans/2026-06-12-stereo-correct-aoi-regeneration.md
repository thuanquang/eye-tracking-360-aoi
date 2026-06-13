# Stereo-Correct AOI Regeneration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

> **Status:** Superseded. Do not execute this all-3D-top-bottom plan. The actual clip audit showed mixed layouts: Culture 3D is mono equirectangular, Modern 3D is top-bottom, and Nature/Tam Coc 3D is mono equirectangular. Use `docs/plans/2026-06-12-mixed-projection-aoi-regeneration.md` instead.

**Goal:** Replace the broken 3D/2D AOI results with stereo-correct, visually verified object-edge AOIs for all six study clips.

**Architecture:** The app must render each study video in the same coordinate system used by the AOI generator. Flat videos render on a contained plane; 3D/360 videos render from the left eye of the top-bottom stereo source. RunPod outputs must include matching `video.projection` and `video.stereoLayout` metadata, plus preview renders that let us reject bad JSON before import.

**Tech Stack:** Vanilla JS app, Three.js `VideoTexture`, Node test runner, RunPod RTX GPU, Florence-2 large, SAM2.1 large, OpenCV.

---

### Task 1: Lock Correct Study Metadata

**Files:**
- Modify: `src/app/studyVideos.js`
- Modify: `tests/studyVideos.test.js`
- Modify: `tests/appState.test.js`

**Step 1: Write/update failing tests**

Assert the three 3D clips have `stereoLayout: 'top-bottom'` and the three 2D clips have `stereoLayout: 'mono'`.

**Step 2: Run tests**

Run: `node --test tests/studyVideos.test.js tests/appState.test.js`

Expected before fix: 3D clips still report `mono`.

**Step 3: Implement**

Set `culture-3d`, `modern-3d`, and `nature-3d` to `top-bottom`.

**Step 4: Verify**

Run: `node --test tests/studyVideos.test.js tests/appState.test.js`

Expected: pass.

### Task 2: Render Stereo 3D Correctly

**Files:**
- Modify: `src/viewer/projection.js`
- Modify: `src/app/appController.js`
- Modify: `tests/viewerProjection.test.js`

**Step 1: Write failing tests**

Add `getStereoTextureTransform()` expectations:

```js
getStereoTextureTransform('top-bottom') === {
  offsetX: 0,
  offsetY: 0.5,
  repeatX: 1,
  repeatY: 0.5,
}
```

Also assert `normalizeStereoLayout('side-by-side')` remains `side-by-side`.

**Step 2: Run tests**

Run: `node --test tests/viewerProjection.test.js`

Expected before fix: missing export / side-by-side collapses to mono.

**Step 3: Implement**

Use `VideoTexture.offset` and `VideoTexture.repeat` in `syncProjectionMesh()`:

- `top-bottom` left eye: `offset=(0, 0.5)`, `repeat=(1, 0.5)`
- `side-by-side` left eye: `offset=(0, 0)`, `repeat=(0.5, 1)`
- `mono`: `offset=(0, 0)`, `repeat=(1, 1)`

**Step 4: Verify**

Run: `node --test tests/viewerProjection.test.js`

Expected: pass.

### Task 3: Keep Flat Video Mapping Correct

**Files:**
- Modify: `src/viewer/projection.js`
- Modify: `src/aois/aoiOverlay.js`
- Modify: `src/app/appController.js`
- Modify: `tests/aoiOverlay.test.js`
- Modify: `tests/viewerProjection.test.js`

**Step 1: Test contained video rect**

Assert a 4:3 video in a 2:1 viewer is pillarboxed and AOIs project into the contained video rect, not full viewer bounds.

**Step 2: Implement**

Use `getContainedMediaRect()` for:

- flat video plane scale/position
- video-space AOI overlay projection
- manual polygon clicks and vertex dragging
- video-space gaze hit testing

**Step 3: Verify**

Run: `node --test tests/aoiOverlay.test.js tests/viewerProjection.test.js`

Expected: pass.

### Task 4: Regenerate RunPod Upload Bundle

**Files:**
- Modify: `runpod-aoi-upload/jobs/*.json`
- Modify: `runpod-aoi-upload/RUN_ME_ON_RUNPOD.sh`
- Modify: `scripts/RUN_ME_ON_RUNPOD.sh`
- Copy: `scripts/runpod_auto_aoi_batch.py` to `runpod-aoi-upload/runpod_auto_aoi_batch.py`
- Copy: `scripts/runpod_requirements.txt` to `runpod-aoi-upload/runpod_requirements.txt`
- Create: `runpod-aoi-upload-stereo-quality.zip`

**Step 1: Update jobs**

Set:

- 3D jobs: `projection: 'equirectangular'`, `stereoLayout: 'top-bottom'`
- 2D jobs: `projection: 'flat'`, `stereoLayout: 'mono'`
- `sampleIntervalSec: 0.25`
- `maxPolygonPoints: 200`
- `polygonSimplificationEpsilon: 0.001`
- `analysisPaddingPx: 12`

**Step 2: Update RunPod command**

Use:

```bash
python runpod_auto_aoi_batch.py \
  --jobs-dir jobs \
  --videos-dir videos \
  --output-dir outputs \
  --detector-model microsoft/Florence-2-large \
  --sam-size large \
  --sample-interval 0.25 \
  --min-score 0.05 \
  --min-mask-score 0 \
  --min-track-iou 0.15 \
  --min-track-frames 1 \
  --max-detections-per-frame 120 \
  --max-auto-masks-per-frame 24
```

**Step 3: Build zip**

Run: `Compress-Archive -Path runpod-aoi-upload\* -DestinationPath runpod-aoi-upload-stereo-quality.zip -Force`

Expected: zip exists and includes corrected jobs.

### Task 5: RunPod Regeneration With Visual Gate

**Files:**
- Upload: `runpod-aoi-upload-stereo-quality.zip`
- Download: new `outputs/*.generated-aois.json`
- Download: preview images or preview videos from RunPod

**Step 1: Start pod**

Use RTX 3090 or better. Prefer RTX 4090/A40/A6000 if cheap enough.

**Step 2: Upload bundle**

Upload and unzip `runpod-aoi-upload-stereo-quality.zip`.

**Step 3: Run inference**

Run `bash RUN_ME_ON_RUNPOD.sh`.

**Step 4: Download outputs**

Download the entire `outputs/` folder.

**Step 5: Reject bad results before import**

Do not import JSONs until preview renders show:

- 3D AOIs align to the left-eye top-bottom panorama
- 2D AOIs align to the flat video frame
- object edges are polygonal, not boxes
- labels are either correct enough or neutral enough to review

### Task 6: Import and Validate

**Files:**
- App import path: admin AOI JSON input
- Test: focused Playwright import smoke

**Step 1: Import one file per video**

Select the matching study video before importing the AOI JSON.

**Step 2: Check compatibility**

Old bad 3D JSONs should fail with a stereo mismatch. New 3D JSONs should pass with `top-bottom`.

**Step 3: Visual review**

Scrub each video at multiple timestamps and delete/refine bad AOIs manually.

**Step 4: Run verification**

Run:

```powershell
npm test
```

Expected: all tests pass.
