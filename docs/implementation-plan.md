# 360 Webcam AOI Prototype Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build an isolated browser prototype that plays a local 360-style video, records gaze-like screen points, maps them into panorama yaw/pitch coordinates, checks dynamic AOI hits, and exports samples for analysis.

**Architecture:** Keep this outside the Flutter app in `experiments/eye-tracking-360-aoi/`. Put reusable coordinate and AOI math in `src/aoiMath.js` with Node tests, and put browser-only viewer/gaze/export logic in `src/app.js`.

**Tech Stack:** Static HTML/CSS/JavaScript, Three.js from CDN for the 360 sphere viewer, optional WebGazer.js from CDN for webcam gaze, Node's built-in `node:test` for math verification, and a locally downloaded MP4 at `assets/test-video.mp4` when available.

---

### Task 1: Prototype Folder and Math Tests

**Files:**
- Create: `experiments/eye-tracking-360-aoi/package.json`
- Create: `experiments/eye-tracking-360-aoi/src/aoiMath.js`
- Create: `experiments/eye-tracking-360-aoi/tests/aoiMath.test.js`

**Step 1: Write the failing test**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { hitTestAois, normalizeYaw, screenPointToYawPitch } from '../src/aoiMath.js';

test('normalizes yaw to the -180..180 range', () => {
  assert.equal(normalizeYaw(190), -170);
  assert.equal(normalizeYaw(-190), 170);
});

test('maps center screen point to camera yaw and pitch', () => {
  const result = screenPointToYawPitch({ x: 960, y: 540, width: 1920, height: 1080, cameraYaw: 35, cameraPitch: -8, fov: 75 });
  assert.equal(Math.round(result.yaw), 35);
  assert.equal(Math.round(result.pitch), -8);
});

test('detects AOI hit including wraparound AOIs', () => {
  const hits = hitTestAois({ yaw: -178, pitch: 5 }, [
    { id: 'front', label: 'Front', yawMin: -20, yawMax: 20, pitchMin: -10, pitchMax: 10 },
    { id: 'seam', label: 'Panorama seam', yawMin: 170, yawMax: -170, pitchMin: -20, pitchMax: 20 },
  ]);

  assert.deepEqual(hits.map((aoi) => aoi.id), ['seam']);
});
```

**Step 2: Run test to verify it fails**

Run: `npm test --prefix experiments/eye-tracking-360-aoi`

Expected: FAIL because `src/aoiMath.js` does not exist yet.

**Step 3: Write minimal implementation**

Implement:
- `normalizeYaw(degrees)`
- `screenPointToYawPitch({ x, y, width, height, cameraYaw, cameraPitch, fov })`
- `hitTestAois(point, aois)`

**Step 4: Run test to verify it passes**

Run: `npm test --prefix experiments/eye-tracking-360-aoi`

Expected: PASS.

### Task 2: Browser Viewer

**Files:**
- Create: `experiments/eye-tracking-360-aoi/index.html`
- Create: `experiments/eye-tracking-360-aoi/styles.css`
- Create: `experiments/eye-tracking-360-aoi/src/app.js`

**Step 1: Add a Three.js 360 viewer**

Load `assets/test-video.mp4` as an HTML video, map it to the inside of a sphere, and let the user drag to rotate yaw/pitch.

**Step 2: Add gaze input modes**

Support:
- Mouse gaze mode for reliable local testing.
- Optional WebGazer mode for webcam gaze when the browser grants camera permission and the CDN loads.

**Step 3: Add AOI hit testing and export**

Sample at a steady interval:
- timestamp
- source mode
- screen x/y
- camera yaw/pitch
- panorama yaw/pitch
- hit AOI ids

Show a live hit readout and export JSON.

### Task 3: Video Asset

**Files:**
- Create when download succeeds: `experiments/eye-tracking-360-aoi/assets/test-video.mp4`
- Create when needed: `experiments/eye-tracking-360-aoi/assets/VIDEO_SOURCE.txt`

**Step 1: Try to install/use yt-dlp**

Run: `python -m pip install --user yt-dlp`

**Step 2: Try to download the provided YouTube test video**

Run from the prototype folder:

```bash
yt-dlp -f "bv*[ext=mp4][height<=720]+ba[ext=m4a]/b[ext=mp4][height<=720]/best[height<=720]" --merge-output-format mp4 -o "assets/test-video.%(ext)s" "https://www.youtube.com/watch?v=iQvIVWmjoLM"
```

Expected: `assets/test-video.mp4` exists, or the command reports a network/YouTube restriction. If blocked, document the source and leave the app ready to use any local MP4 renamed to `assets/test-video.mp4`.

### Task 4: Verification

**Files:**
- No new files unless a manual verification note is useful.

**Step 1: Run automated tests**

Run: `npm test --prefix experiments/eye-tracking-360-aoi`

Expected: PASS.

**Step 2: Start local static server**

Run from the prototype folder: `npx http-server . -p 5179`

Expected: server prints a local URL.

**Step 3: Manual browser check**

Open: `http://127.0.0.1:5179`

Expected:
- Page loads.
- Video element loads `assets/test-video.mp4` if present.
- Dragging rotates the sphere.
- Mouse gaze samples produce AOI hit readings.
- Export JSON downloads recorded samples.
