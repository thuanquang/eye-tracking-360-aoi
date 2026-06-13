# Mixed Projection AOI Regeneration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Regenerate AOIs only after the app and RunPod pipeline use the visually verified projection/stereo layout for each of the six study clips.

**Architecture:** Treat projection and stereo layout as per-video facts, not category-wide assumptions. The app renders 2D clips on a contained flat plane, Culture 3D and Nature 3D as mono equirectangular, and Modern 3D as top-bottom equirectangular using the top/left eye crop. RunPod jobs must use the same metadata and produce preview renders before JSON import.

**Tech Stack:** Vanilla JS app, Three.js `VideoTexture`, Node test runner, Playwright screenshots, RunPod RTX GPU, Florence-2 large, SAM2.1 large, OpenCV.

---

### Task 1: Lock Per-Clip Projection Metadata

**Files:**
- Modify: `src/app/studyVideos.js`
- Modify: `tests/studyVideos.test.js`
- Modify: `tests/appState.test.js`

**Step 1: Write the failing test**

Assert:

```js
findStudyVideoByName('culture_thap_ba_01m19s-01m49s.mp4').stereoLayout === 'mono'
findStudyVideoByName('modern_01m00s-01m30s.mp4').stereoLayout === 'top-bottom'
findStudyVideoByName('nature_tam_coc_04m31s-05m01s.mp4').stereoLayout === 'mono'
```

**Step 2: Run test to verify it fails**

Run: `node --test tests/studyVideos.test.js tests/appState.test.js`

Expected before implementation: Modern or another 3D clip has the wrong stereo value.

**Step 3: Implement**

Set the exact study metadata:

- `culture-3d`: `projection: 'equirectangular'`, `stereoLayout: 'mono'`
- `modern-3d`: `projection: 'equirectangular'`, `stereoLayout: 'top-bottom'`
- `nature-3d`: `projection: 'equirectangular'`, `stereoLayout: 'mono'`
- all 2D clips: `projection: 'flat'`, `stereoLayout: 'mono'`

**Step 4: Run test to verify it passes**

Run: `node --test tests/studyVideos.test.js tests/appState.test.js`

Expected: pass.

### Task 2: Keep Stereo Texture Transform Available but Metadata-Driven

**Files:**
- Modify: `src/viewer/projection.js`
- Modify: `src/app/appController.js`
- Modify: `tests/viewerProjection.test.js`

**Step 1: Write the failing test**

Assert `getStereoTextureTransform()` returns:

```js
{ offsetX: 0, offsetY: 0, repeatX: 1, repeatY: 1 } // mono
{ offsetX: 0, offsetY: 0.5, repeatX: 1, repeatY: 0.5 } // top-bottom left eye
{ offsetX: 0, offsetY: 0, repeatX: 0.5, repeatY: 1 } // side-by-side left eye
```

**Step 2: Run test to verify it fails**

Run: `node --test tests/viewerProjection.test.js`

Expected before implementation: missing transform helper.

**Step 3: Implement**

Use `getStereoTextureTransform(getCurrentStereoLayout(), 'left')` only for equirectangular rendering. Flat videos force mono texture mapping and use the contained-plane path.

**Step 4: Run test to verify it passes**

Run: `node --test tests/viewerProjection.test.js`

Expected: pass.

### Task 3: Capture Visual Proof for Each 3D Clip

**Files:**
- Create/update: `diagnostics/current-3d-mixed-fixed-playing/*.png`

**Step 1: Run browser smoke**

Use Playwright to select `culture-3d`, `modern-3d`, and `nature-3d`, press Play, wait for playback to advance, and screenshot `#viewer`.

**Step 2: Verify metadata**

Expected browser values:

- Culture: `projection=equirectangular`, `stereo=mono`
- Modern: `projection=equirectangular`, `stereo=top-bottom`
- Nature: `projection=equirectangular`, `stereo=mono`

**Step 3: Visual gate**

Reject the metadata if:

- Culture looks vertically stretched
- Modern shows two stacked views at once
- Nature looks vertically stretched

### Task 4: Regenerate RunPod Upload Bundle

**Files:**
- Modify: `runpod-aoi-upload/jobs/*.json`
- Modify: `runpod-aoi-upload/RUN_ME_ON_RUNPOD.sh`
- Modify: `scripts/RUN_ME_ON_RUNPOD.sh`
- Create: `runpod-aoi-upload-stereo-quality.zip`

**Step 1: Sync jobs from study metadata**

Use the exact app metadata for each job. The three key 3D jobs must be:

```json
{ "name": "culture_thap_ba_01m19s-01m49s.mp4", "projection": "equirectangular", "stereoLayout": "mono" }
{ "name": "modern_01m00s-01m30s.mp4", "projection": "equirectangular", "stereoLayout": "top-bottom" }
{ "name": "nature_tam_coc_04m31s-05m01s.mp4", "projection": "equirectangular", "stereoLayout": "mono" }
```

**Step 2: Use quality inference settings**

Keep:

```bash
--sam-size large
--sample-interval 0.25
--min-score 0.05
--min-mask-score 0
--min-track-iou 0.15
--min-track-frames 1
--max-detections-per-frame 120
--max-auto-masks-per-frame 24
```

**Step 3: Rebuild zip**

Run: `Compress-Archive -Path runpod-aoi-upload\* -DestinationPath runpod-aoi-upload-stereo-quality.zip -Force`

Expected: zip exists and job JSONs show the mixed layout above.

### Task 5: RunPod Regeneration With Preview Gate

**Files:**
- Upload: `runpod-aoi-upload-stereo-quality.zip`
- Download: new `outputs/*.generated-aois.json`
- Download: preview frames/videos from RunPod

**Step 1: Run on GPU**

Use a 3090/4090/A40/A6000 class pod. Start from the corrected zip, not the old upload zip.

**Step 2: Run inference**

Run: `bash RUN_ME_ON_RUNPOD.sh`

**Step 3: Download full outputs**

Download both JSON and visual preview artifacts.

**Step 4: Hard reject without preview alignment**

Do not import JSONs until preview frames show AOIs aligned to object edges in the same projection/stereo layout as the app.

### Task 6: Import and Review

**Files:**
- App import path: admin AOI JSON input
- Test: focused Playwright import smoke

**Step 1: Import only matching metadata**

The app compatibility check should reject mismatched `projection` or `stereoLayout`.

**Step 2: Scrub each clip**

Review at start, middle, and end of each clip.

**Step 3: Manually correct**

Use polygon edit mode to refine object edges that survived preview but need small corrections.

**Step 4: Verify**

Run: `npm test`

Expected: all tests pass.
