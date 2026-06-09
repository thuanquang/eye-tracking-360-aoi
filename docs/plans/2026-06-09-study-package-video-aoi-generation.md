# Study Package Video AOI Generation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add admin-mode support for packaging any uploaded study video, generating reviewable AOIs from that video for 2D and 360/3D layouts, and exporting one participant-ready `.aoi-study` file.

**Architecture:** Keep the app as a static browser prototype. Add a single-file zip-backed study package format that contains a manifest, AOIs, and the video binary, then add a lightweight admin-side AOI generator based on seeded box tracking rather than required SAM/cloud inference. Extend the AOI model so existing yaw/pitch 360 AOIs remain backward compatible while flat 2D videos use normalized video-space AOIs.

**Tech Stack:** Static HTML/CSS/JavaScript, ES modules, Three.js, WebGazer, Canvas frame sampling, JSZip, Node `node:test`, Playwright smoke tests.

---

## Context and Assumptions

- Required default path is free and feasible on an RTX 3060.
- SAM 3 is not required for this feature. Add import seams for future external detections, but do not make local SAM inference part of the core workflow.
- Admins can generate AOIs semi-automatically by drawing a seed box/polygon around an object and tracking it through sampled video frames.
- Participants should upload one `.aoi-study` file. That file should immediately hydrate video metadata, video binary, and AOIs.
- Existing exported recording JSON remains separate from the new study package export.
- Existing AOIs without a `space` field are treated as panorama AOIs for backward compatibility.

## Study Package Format

Use a zip file with extension `.aoi-study`:

```text
study.aoi-study
  manifest.json
  aois.json
  video/<original-video-name>
```

`manifest.json`:

```json
{
  "kind": "aoi-study",
  "version": 1,
  "createdAt": "2026-06-09T00:00:00.000Z",
  "video": {
    "file": "video/test-video.mp4",
    "name": "test-video.mp4",
    "type": "video/mp4",
    "size": 123456,
    "durationSec": 16,
    "projection": "equirectangular",
    "stereoLayout": "mono"
  },
  "aois": {
    "file": "aois.json",
    "count": 3,
    "generatedBy": "seeded-template-tracker"
  }
}
```

AOI schema additions:

```js
// Existing 360 AOI, backward compatible.
{
  id: 'front-center',
  label: 'Front center',
  color: '#ffd166',
  space: 'panorama',
  yawMin: -18,
  yawMax: 18,
  pitchMin: -10,
  pitchMax: 16,
  keyframes: [
    { t: 0, yawMin: -18, yawMax: 18, pitchMin: -10, pitchMax: 16 }
  ]
}

// New flat 2D AOI.
{
  id: 'screen-logo',
  label: 'Screen logo',
  color: '#5dd7c8',
  space: 'video',
  xMin: 0.32,
  xMax: 0.48,
  yMin: 0.18,
  yMax: 0.34,
  keyframes: [
    { t: 0, xMin: 0.32, xMax: 0.48, yMin: 0.18, yMax: 0.34 }
  ]
}
```

---

### Task 1: Study Package Codec

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/studyPackage.js`
- Create: `tests/studyPackage.test.js`
- Modify: `index.html`

**Step 1: Install JSZip**

Run:

```powershell
npm install jszip@3.10.1
```

Expected: `package.json` and `package-lock.json` include `jszip`.

**Step 2: Add browser import map entry**

In `index.html`, extend the import map:

```json
{
  "imports": {
    "three": "https://cdn.jsdelivr.net/npm/three@0.167.1/build/three.module.js",
    "jszip": "https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm"
  }
}
```

**Step 3: Write failing package tests**

Create `tests/studyPackage.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  STUDY_PACKAGE_KIND,
  createStudyPackage,
  readStudyPackage,
} from '../src/studyPackage.js';

test('creates and reads one-file AOI study packages', async () => {
  const videoFile = new File(['fake mp4 bytes'], 'demo.mp4', { type: 'video/mp4' });
  const aois = [
    {
      id: 'logo',
      label: 'Logo',
      color: '#ffd166',
      space: 'video',
      xMin: 0.1,
      xMax: 0.2,
      yMin: 0.3,
      yMax: 0.4,
    },
  ];

  const packageBlob = await createStudyPackage({
    videoFile,
    video: {
      durationSec: 12.5,
      projection: 'flat',
      stereoLayout: 'mono',
    },
    aois,
    generatedBy: 'test',
  });

  const result = await readStudyPackage(packageBlob);

  assert.equal(result.manifest.kind, STUDY_PACKAGE_KIND);
  assert.equal(result.manifest.version, 1);
  assert.equal(result.manifest.video.file, 'video/demo.mp4');
  assert.equal(result.manifest.video.projection, 'flat');
  assert.equal(result.manifest.aois.count, 1);
  assert.deepEqual(result.aois, aois);
  assert.equal(result.videoBlob.type, 'video/mp4');
  assert.equal(await result.videoBlob.text(), 'fake mp4 bytes');
});

test('rejects files that are not AOI study packages', async () => {
  await assert.rejects(
    readStudyPackage(new Blob(['{}'], { type: 'application/json' })),
    /study package/i,
  );
});
```

**Step 4: Run failing test**

Run:

```powershell
node --test tests/studyPackage.test.js
```

Expected: FAIL because `src/studyPackage.js` does not exist.

**Step 5: Implement package codec**

Create `src/studyPackage.js`:

```js
import JSZip from 'jszip';

export const STUDY_PACKAGE_KIND = 'aoi-study';
export const STUDY_PACKAGE_VERSION = 1;

function sanitizePackagePath(name) {
  return String(name || 'study-video.mp4').replace(/[\\/:*?"<>|]+/g, '-');
}

function assertValidManifest(manifest) {
  if (
    manifest?.kind !== STUDY_PACKAGE_KIND ||
    manifest?.version !== STUDY_PACKAGE_VERSION ||
    typeof manifest?.video?.file !== 'string' ||
    typeof manifest?.aois?.file !== 'string'
  ) {
    throw new Error('File is not a supported AOI study package.');
  }
}

export async function createStudyPackage({
  videoFile,
  video,
  aois,
  generatedBy = 'manual',
}) {
  if (!videoFile) {
    throw new Error('A study package requires a video file.');
  }

  if (!Array.isArray(aois) || !aois.length) {
    throw new Error('A study package requires at least one AOI.');
  }

  const zip = new JSZip();
  const videoName = sanitizePackagePath(videoFile.name);
  const videoPath = `video/${videoName}`;
  const manifest = {
    kind: STUDY_PACKAGE_KIND,
    version: STUDY_PACKAGE_VERSION,
    createdAt: new Date().toISOString(),
    video: {
      file: videoPath,
      name: videoFile.name || videoName,
      type: videoFile.type || 'video/mp4',
      size: videoFile.size,
      durationSec: video.durationSec ?? null,
      projection: video.projection || 'equirectangular',
      stereoLayout: video.stereoLayout || 'mono',
    },
    aois: {
      file: 'aois.json',
      count: aois.length,
      generatedBy,
    },
  };

  zip.file('manifest.json', JSON.stringify(manifest, null, 2));
  zip.file('aois.json', JSON.stringify(aois, null, 2));
  zip.file(videoPath, videoFile);

  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}

export async function readStudyPackage(file) {
  let zip;
  try {
    zip = await JSZip.loadAsync(file);
  } catch {
    throw new Error('File is not a readable AOI study package.');
  }

  const manifestEntry = zip.file('manifest.json');
  if (!manifestEntry) {
    throw new Error('File is not an AOI study package: missing manifest.json.');
  }

  const manifest = JSON.parse(await manifestEntry.async('string'));
  assertValidManifest(manifest);

  const aoisEntry = zip.file(manifest.aois.file);
  const videoEntry = zip.file(manifest.video.file);

  if (!aoisEntry || !videoEntry) {
    throw new Error('AOI study package is missing AOIs or video content.');
  }

  return {
    manifest,
    aois: JSON.parse(await aoisEntry.async('string')),
    videoBlob: await videoEntry.async('blob'),
  };
}
```

**Step 6: Run package test**

Run:

```powershell
node --test tests/studyPackage.test.js
```

Expected: PASS.

**Step 7: Commit**

```powershell
git add package.json package-lock.json index.html src/studyPackage.js tests/studyPackage.test.js
git commit -m "feat: add AOI study package codec"
```

---

### Task 2: AOI Geometry for 2D, 360, and Stereo Layouts

**Files:**
- Modify: `src/aoiMath.js`
- Create: `src/aoiGeneration.js`
- Modify: `tests/aoiMath.test.js`
- Create: `tests/aoiGeneration.test.js`

**Step 1: Write failing geometry tests**

Add to `tests/aoiMath.test.js`:

```js
import {
  hitTestAois,
  screenPointToVideoPoint,
} from '../src/aoiMath.js';

test('maps screen gaze to normalized flat-video coordinates', () => {
  const point = screenPointToVideoPoint({
    x: 640,
    y: 360,
    width: 1280,
    height: 720,
  });

  assert.deepEqual(point, { x: 0.5, y: 0.5 });
});

test('hit tests normalized 2D video AOIs', () => {
  const hits = hitTestAois({ x: 0.35, y: 0.25 }, [
    {
      id: 'logo',
      label: 'Logo',
      color: '#ffd166',
      space: 'video',
      xMin: 0.2,
      xMax: 0.5,
      yMin: 0.1,
      yMax: 0.4,
    },
  ]);

  assert.deepEqual(hits.map((aoi) => aoi.id), ['logo']);
});
```

Create `tests/aoiGeneration.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getStereoFrameRect,
  pixelBoxToAoiKeyframe,
} from '../src/aoiGeneration.js';

test('converts flat video boxes to normalized AOI keyframes', () => {
  const keyframe = pixelBoxToAoiKeyframe({
    t: 2,
    box: { x: 320, y: 180, width: 320, height: 180 },
    videoWidth: 1280,
    videoHeight: 720,
    projection: 'flat',
    stereoLayout: 'mono',
  });

  assert.deepEqual(keyframe, {
    t: 2,
    xMin: 0.25,
    xMax: 0.5,
    yMin: 0.25,
    yMax: 0.5,
  });
});

test('converts equirectangular boxes to yaw and pitch keyframes', () => {
  const keyframe = pixelBoxToAoiKeyframe({
    t: 0,
    box: { x: 0, y: 0, width: 960, height: 540 },
    videoWidth: 1920,
    videoHeight: 1080,
    projection: 'equirectangular',
    stereoLayout: 'mono',
  });

  assert.deepEqual(keyframe, {
    t: 0,
    yawMin: -180,
    yawMax: 0,
    pitchMin: 0,
    pitchMax: 90,
  });
});

test('resolves stereo eye frame rectangles', () => {
  assert.deepEqual(
    getStereoFrameRect({ videoWidth: 3840, videoHeight: 1920, stereoLayout: 'side-by-side', eye: 'right' }),
    { x: 1920, y: 0, width: 1920, height: 1920 },
  );
  assert.deepEqual(
    getStereoFrameRect({ videoWidth: 3840, videoHeight: 1920, stereoLayout: 'top-bottom', eye: 'left' }),
    { x: 0, y: 0, width: 3840, height: 960 },
  );
});
```

**Step 2: Run failing tests**

Run:

```powershell
node --test tests/aoiMath.test.js tests/aoiGeneration.test.js
```

Expected: FAIL because flat-video geometry and `src/aoiGeneration.js` do not exist.

**Step 3: Extend AOI math dispatch**

In `src/aoiMath.js`:

- Treat missing `aoi.space` as `'panorama'`.
- Keep existing yaw/pitch functions unchanged for panorama AOIs.
- Add `screenPointToVideoPoint`.
- Add `hitTestVideoAois`.
- Make `hitTestAois(point, aois)` dispatch to video AOIs when `aoi.space === 'video'`.
- Make `resolveAoisAtTime` interpolate either yaw/pitch keyframes or x/y keyframes.

Implementation shape:

```js
export function screenPointToVideoPoint({ x, y, width, height }) {
  if (width <= 0 || height <= 0) {
    throw new Error('Viewport width and height must be positive.');
  }

  return {
    x: clamp(x / width, 0, 1),
    y: clamp(y / height, 0, 1),
  };
}

function isVideoAoi(aoi) {
  return aoi.space === 'video';
}

function hitTestVideoAois(point, aois) {
  return aois.filter((aoi) => (
    point.x >= Math.min(aoi.xMin, aoi.xMax) &&
    point.x <= Math.max(aoi.xMin, aoi.xMax) &&
    point.y >= Math.min(aoi.yMin, aoi.yMax) &&
    point.y <= Math.max(aoi.yMin, aoi.yMax)
  ));
}
```

**Step 4: Add AOI generation helpers**

Create `src/aoiGeneration.js`:

```js
import { normalizeYaw } from './aoiMath.js';

function round(value) {
  return Number(value.toFixed(6));
}

export function getStereoFrameRect({
  videoWidth,
  videoHeight,
  stereoLayout = 'mono',
  eye = 'left',
}) {
  if (stereoLayout === 'side-by-side') {
    const width = videoWidth / 2;
    return {
      x: eye === 'right' ? width : 0,
      y: 0,
      width,
      height: videoHeight,
    };
  }

  if (stereoLayout === 'top-bottom') {
    const height = videoHeight / 2;
    return {
      x: 0,
      y: eye === 'right' ? height : 0,
      width: videoWidth,
      height,
    };
  }

  return { x: 0, y: 0, width: videoWidth, height: videoHeight };
}

export function normalizeBoxToFrame(box, frameRect) {
  const xMin = (box.x - frameRect.x) / frameRect.width;
  const xMax = (box.x + box.width - frameRect.x) / frameRect.width;
  const yMin = (box.y - frameRect.y) / frameRect.height;
  const yMax = (box.y + box.height - frameRect.y) / frameRect.height;

  return {
    xMin: round(Math.min(xMin, xMax)),
    xMax: round(Math.max(xMin, xMax)),
    yMin: round(Math.min(yMin, yMax)),
    yMax: round(Math.max(yMin, yMax)),
  };
}

export function pixelBoxToAoiKeyframe({
  t,
  box,
  videoWidth,
  videoHeight,
  projection = 'equirectangular',
  stereoLayout = 'mono',
  eye = 'left',
}) {
  const frameRect = getStereoFrameRect({ videoWidth, videoHeight, stereoLayout, eye });
  const normalized = normalizeBoxToFrame(box, frameRect);

  if (projection === 'flat') {
    return { t, ...normalized };
  }

  return {
    t,
    yawMin: normalizeYaw(normalized.xMin * 360 - 180),
    yawMax: normalizeYaw(normalized.xMax * 360 - 180),
    pitchMin: round(90 - normalized.yMax * 180),
    pitchMax: round(90 - normalized.yMin * 180),
  };
}
```

**Step 5: Run geometry tests**

Run:

```powershell
node --test tests/aoiMath.test.js tests/aoiGeneration.test.js
```

Expected: PASS.

**Step 6: Commit**

```powershell
git add src/aoiMath.js src/aoiGeneration.js tests/aoiMath.test.js tests/aoiGeneration.test.js
git commit -m "feat: support 2d and stereo AOI geometry"
```

---

### Task 3: Video Metadata Controls and Flat-Video Rendering

**Files:**
- Modify: `index.html`
- Modify: `styles.css`
- Modify: `src/app.js`
- Modify: `tests/uiSmoke.mjs`

**Step 1: Write failing smoke assertions**

In `tests/uiSmoke.mjs`, after the admin page loads, assert new controls exist:

```js
await assert.doesNotReject(
  page.locator('#projectionSelect').waitFor({ state: 'visible', timeout: 1000 }),
  'Admin should expose video projection controls.',
);
await assert.doesNotReject(
  page.locator('#stereoLayoutSelect').waitFor({ state: 'visible', timeout: 1000 }),
  'Admin should expose stereo layout controls.',
);
```

Add a flat-video sidecar load assertion:

```js
const flatSidecarPath = join(tmpDir, 'flat-video.aoi.json');
await writeFile(flatSidecarPath, JSON.stringify({
  video: {
    name: 'flat-demo.mp4',
    durationSec: 10,
    projection: 'flat',
    stereoLayout: 'mono',
  },
  aois: [
    {
      id: 'flat-logo',
      label: 'Flat logo',
      color: '#ffd166',
      space: 'video',
      xMin: 0.2,
      xMax: 0.4,
      yMin: 0.2,
      yMax: 0.4,
    },
  ],
}, null, 2));
await page.locator('#aoiFileInput').setInputFiles(flatSidecarPath);
await page.waitForFunction(() => document.querySelector('#projectionSelect')?.value === 'flat');
assert.equal(await page.locator('#aoiOverlay [data-aoi-id="flat-logo"]').count(), 1);
```

**Step 2: Run failing smoke test**

Run:

```powershell
npm run test:ui
```

Expected: FAIL because metadata controls and flat AOI overlay are missing.

**Step 3: Add admin metadata controls**

In `index.html`, inside `#controlPanel` input section after local video loading:

```html
<label class="field-label compact-field">
  <span>Projection</span>
  <select id="projectionSelect">
    <option value="equirectangular">360 equirectangular</option>
    <option value="flat">2D flat</option>
  </select>
</label>
<label class="field-label compact-field">
  <span>Stereo layout</span>
  <select id="stereoLayoutSelect">
    <option value="mono">Mono</option>
    <option value="side-by-side">Side by side</option>
    <option value="top-bottom">Top bottom</option>
  </select>
</label>
```

**Step 4: Store source video file and metadata**

In `src/app.js`:

- Add DOM references for `#projectionSelect` and `#stereoLayoutSelect`.
- Add `let sourceVideoFile = null;`.
- Add `projection` and `stereoLayout` defaults to `sourceVideoInfo`.
- Update `loadLocalVideo` to store `sourceVideoFile = file`.
- Add `syncVideoMetadataControlsFromSource()` and `applyVideoMetadataControls()`.
- When sidecar metadata loads in `registerAois`, update controls from `registeredProjectMetadata.video`.

Implementation shape:

```js
let sourceVideoFile = null;

function getCurrentVideoProjection() {
  return projectionSelect.value || registeredProjectMetadata.video?.projection || 'equirectangular';
}

function getCurrentStereoLayout() {
  return stereoLayoutSelect.value || registeredProjectMetadata.video?.stereoLayout || 'mono';
}
```

**Step 5: Render flat video AOIs**

In `src/app.js`:

- Add `projectVideoAoiRange(aoi, rect)` that maps normalized `xMin/xMax/yMin/yMax` to viewer screen points.
- Update `drawAoiOverlay()` to use video projection for `space: 'video'`.
- Keep panorama overlay logic unchanged.
- Update current sample generation so flat video samples store `videoPoint` and use flat AOI hit testing.

Implementation shape:

```js
function projectVideoAoiRange(aoi, rect) {
  return [
    { x: aoi.xMin * rect.width, y: aoi.yMin * rect.height },
    { x: aoi.xMax * rect.width, y: aoi.yMin * rect.height },
    { x: aoi.xMax * rect.width, y: aoi.yMax * rect.height },
    { x: aoi.xMin * rect.width, y: aoi.yMax * rect.height },
  ];
}
```

**Step 6: Switch rendering mode**

Add a minimal flat projection mode:

- Keep Three.js sphere for `projection === 'equirectangular'`.
- For `projection === 'flat'`, either render a plane with the same video texture or show an absolutely positioned `<video>` layer inside `#viewer`.
- Use the smallest change: create a plane mesh in front of the camera and toggle sphere/plane visibility.
- Keep camera drag disabled or low-impact in flat mode.

Expected behavior:

- Flat 2D video fills the viewer.
- 2D AOIs are screen-stable rectangles.
- 360 AOIs still project by yaw/pitch.

**Step 7: Run smoke test**

Run:

```powershell
npm run test:ui
```

Expected: PASS.

**Step 8: Commit**

```powershell
git add index.html styles.css src/app.js tests/uiSmoke.mjs
git commit -m "feat: add video projection controls"
```

---

### Task 4: Lightweight Seeded AOI Tracker

**Files:**
- Create: `src/aoiTracker.js`
- Create: `tests/aoiTracker.test.js`
- Modify: `src/app.js`

**Step 1: Write failing tracker tests**

Create `tests/aoiTracker.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  findBestTemplateMatch,
  makeSyntheticGrayFrame,
} from '../src/aoiTracker.js';

test('finds a moved template inside a local search window', () => {
  const first = makeSyntheticGrayFrame({
    width: 80,
    height: 60,
    rect: { x: 20, y: 16, width: 12, height: 10 },
  });
  const next = makeSyntheticGrayFrame({
    width: 80,
    height: 60,
    rect: { x: 26, y: 19, width: 12, height: 10 },
  });

  const match = findBestTemplateMatch({
    templateFrame: first,
    nextFrame: next,
    previousBox: { x: 20, y: 16, width: 12, height: 10 },
    searchRadius: 10,
  });

  assert.equal(match.box.x, 26);
  assert.equal(match.box.y, 19);
  assert.equal(match.confidence > 0.95, true);
});

test('marks weak matches for review', () => {
  const first = makeSyntheticGrayFrame({
    width: 80,
    height: 60,
    rect: { x: 20, y: 16, width: 12, height: 10 },
  });
  const blank = makeSyntheticGrayFrame({ width: 80, height: 60 });

  const match = findBestTemplateMatch({
    templateFrame: first,
    nextFrame: blank,
    previousBox: { x: 20, y: 16, width: 12, height: 10 },
    searchRadius: 10,
  });

  assert.equal(match.needsReview, true);
});
```

**Step 2: Run failing tracker tests**

Run:

```powershell
node --test tests/aoiTracker.test.js
```

Expected: FAIL because `src/aoiTracker.js` does not exist.

**Step 3: Implement pure tracker primitives**

Create `src/aoiTracker.js`:

```js
function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function makeSyntheticGrayFrame({ width, height, rect = null }) {
  const data = new Uint8ClampedArray(width * height);
  if (rect) {
    for (let y = rect.y; y < rect.y + rect.height; y += 1) {
      for (let x = rect.x; x < rect.x + rect.width; x += 1) {
        data[y * width + x] = 255;
      }
    }
  }
  return { width, height, data };
}

function sadScore(templateFrame, nextFrame, previousBox, x, y) {
  let diff = 0;
  let count = 0;
  for (let row = 0; row < previousBox.height; row += 1) {
    for (let column = 0; column < previousBox.width; column += 1) {
      const a = templateFrame.data[(previousBox.y + row) * templateFrame.width + previousBox.x + column];
      const b = nextFrame.data[(y + row) * nextFrame.width + x + column];
      diff += Math.abs(a - b);
      count += 1;
    }
  }

  return 1 - diff / (count * 255);
}

export function findBestTemplateMatch({
  templateFrame,
  nextFrame,
  previousBox,
  searchRadius = 24,
  reviewThreshold = 0.72,
}) {
  const minX = clamp(previousBox.x - searchRadius, 0, nextFrame.width - previousBox.width);
  const maxX = clamp(previousBox.x + searchRadius, 0, nextFrame.width - previousBox.width);
  const minY = clamp(previousBox.y - searchRadius, 0, nextFrame.height - previousBox.height);
  const maxY = clamp(previousBox.y + searchRadius, 0, nextFrame.height - previousBox.height);
  let best = { x: previousBox.x, y: previousBox.y, confidence: -Infinity };

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const confidence = sadScore(templateFrame, nextFrame, previousBox, x, y);
      if (confidence > best.confidence) {
        best = { x, y, confidence };
      }
    }
  }

  return {
    box: { ...previousBox, x: best.x, y: best.y },
    confidence: best.confidence,
    needsReview: best.confidence < reviewThreshold,
  };
}
```

**Step 4: Run tracker tests**

Run:

```powershell
node --test tests/aoiTracker.test.js
```

Expected: PASS.

**Step 5: Add browser frame extraction**

In `src/app.js`, add helpers:

```js
function captureVideoFrame(video) {
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const context = canvas.getContext('2d');
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  const data = new Uint8ClampedArray(canvas.width * canvas.height);

  for (let index = 0; index < data.length; index += 1) {
    const rgba = index * 4;
    data[index] = Math.round(
      image.data[rgba] * 0.299 +
      image.data[rgba + 1] * 0.587 +
      image.data[rgba + 2] * 0.114
    );
  }

  return { width: canvas.width, height: canvas.height, data };
}
```

Do not wire UI yet.

**Step 6: Commit**

```powershell
git add src/aoiTracker.js src/app.js tests/aoiTracker.test.js
git commit -m "feat: add lightweight AOI tracking primitives"
```

---

### Task 5: Admin AOI Generation UI

**Files:**
- Modify: `index.html`
- Modify: `styles.css`
- Modify: `src/app.js`
- Modify: `tests/uiSmoke.mjs`

**Step 1: Write failing UI assertions**

In `tests/uiSmoke.mjs`, assert generation controls:

```js
await assert.doesNotReject(
  page.locator('#aoiGeneratorPanel').waitFor({ state: 'visible', timeout: 1000 }),
  'Admin should expose AOI generation tools.',
);
await assert.doesNotReject(
  page.locator('#generateAoiButton').waitFor({ state: 'visible', timeout: 1000 }),
  'Admin should expose generated AOI action.',
);
```

Add a test-only generation helper:

```js
const generatedAoi = await page.evaluate(() => window.__aoiGenerateTestAoiFromBox?.({
  id: 'generated-logo',
  label: 'Generated logo',
  color: '#ffd166',
  t: 0,
  box: { x: 200, y: 120, width: 180, height: 100 },
}));

assert.equal(generatedAoi.id, 'generated-logo');
await page.waitForFunction(() => document.querySelector('#aoiList')?.textContent?.includes('Generated logo'));
```

**Step 2: Run failing smoke test**

Run:

```powershell
npm run test:ui
```

Expected: FAIL because generation UI and helper do not exist.

**Step 3: Add admin panel controls**

In `index.html`, add a new admin panel section after video/AOI inputs:

```html
<section id="aoiGeneratorPanel" class="panel-section">
  <p class="section-label">AOI generator</p>
  <label class="field-label">
    <span>AOI label</span>
    <input id="generatedAoiLabelInput" type="text" placeholder="Object name" />
  </label>
  <label class="field-label compact-field">
    <span>Eye</span>
    <select id="generatedAoiEyeSelect">
      <option value="left">Left / mono</option>
      <option value="right">Right</option>
      <option value="both">Both</option>
    </select>
  </label>
  <div class="recording-actions">
    <button id="drawAoiSeedButton" type="button">Draw seed</button>
    <button id="generateAoiButton" type="button" disabled>Track AOI</button>
  </div>
  <p id="aoiGeneratorStatus" class="fine-print">Pause the video and draw a box around the object.</p>
</section>
```

**Step 4: Add seed drawing state**

In `src/app.js`:

- Add DOM references for generator controls.
- Add `state.aoiGenerator = { drawing, seedBox, generated, reviewIndex }`.
- Allow `#aoiOverlay` pointer events while admin seed drawing is active.
- On pointer down/move/up, record a rectangle in viewer coordinates.
- Convert viewer coordinates to raw video pixel coordinates. For flat videos, scale by video dimensions. For 360 videos, map viewer box corners to yaw/pitch or capture from the raw frame when tracking.

Keep the first implementation simple:

- Draw seed in raw video pixel coordinates by scaling from viewer size to `sourceVideo.videoWidth/videoHeight`.
- Use `pixelBoxToAoiKeyframe` to convert output to the correct AOI space.
- For 360, this works best when the video is paused at the current camera view; document that generated AOIs are projected to panorama yaw/pitch.

**Step 5: Generate a single AOI from the seed**

In `src/app.js`, add:

```js
function createGeneratedAoiFromBox({
  id,
  label,
  color,
  t,
  box,
  confidence = 1,
  needsReview = false,
}) {
  const projection = getCurrentVideoProjection();
  const stereoLayout = getCurrentStereoLayout();
  const keyframe = pixelBoxToAoiKeyframe({
    t,
    box,
    videoWidth: sourceVideo.videoWidth,
    videoHeight: sourceVideo.videoHeight,
    projection,
    stereoLayout,
    eye: generatedAoiEyeSelect.value,
  });

  return {
    id,
    label,
    color,
    space: projection === 'flat' ? 'video' : 'panorama',
    generated: {
      method: 'seeded-template-tracker',
      confidence,
      needsReview,
      projection,
      stereoLayout,
      eye: generatedAoiEyeSelect.value,
    },
    ...keyframe,
    keyframes: [keyframe],
  };
}
```

**Step 6: Expose a test helper**

In `src/app.js`:

```js
if (window.__aoiTestMode !== false) {
  window.__aoiGenerateTestAoiFromBox = (options) => {
    const aoi = createGeneratedAoiFromBox(options);
    activeAois = [...activeAois, aoi];
    aoiSource = 'generated';
    renderAoiList();
    return aoi;
  };
}
```

**Step 7: Run smoke test**

Run:

```powershell
npm run test:ui
```

Expected: PASS.

**Step 8: Commit**

```powershell
git add index.html styles.css src/app.js tests/uiSmoke.mjs
git commit -m "feat: add admin AOI generation controls"
```

---

### Task 6: Track Seeded AOI Across the Video Timeline

**Files:**
- Modify: `src/app.js`
- Modify: `src/aoiTracker.js`
- Modify: `tests/aoiTracker.test.js`
- Modify: `tests/uiSmoke.mjs`

**Step 1: Write failing keyframe test**

Extend `tests/aoiTracker.test.js`:

```js
import { trackTemplateAcrossFrames } from '../src/aoiTracker.js';

test('tracks a template across multiple sampled frames', () => {
  const frames = [
    makeSyntheticGrayFrame({ width: 80, height: 60, rect: { x: 20, y: 16, width: 12, height: 10 } }),
    makeSyntheticGrayFrame({ width: 80, height: 60, rect: { x: 23, y: 17, width: 12, height: 10 } }),
    makeSyntheticGrayFrame({ width: 80, height: 60, rect: { x: 26, y: 19, width: 12, height: 10 } }),
  ];

  const results = trackTemplateAcrossFrames({
    frames,
    seedBox: { x: 20, y: 16, width: 12, height: 10 },
    times: [0, 1, 2],
    searchRadius: 8,
  });

  assert.deepEqual(results.map((result) => result.box.x), [20, 23, 26]);
  assert.deepEqual(results.map((result) => result.t), [0, 1, 2]);
});
```

**Step 2: Run failing tracker tests**

Run:

```powershell
node --test tests/aoiTracker.test.js
```

Expected: FAIL because `trackTemplateAcrossFrames` does not exist.

**Step 3: Implement multi-frame tracking**

In `src/aoiTracker.js`:

```js
export function trackTemplateAcrossFrames({
  frames,
  seedBox,
  times,
  searchRadius = 24,
}) {
  if (!frames.length) {
    return [];
  }

  const results = [{ t: times[0] ?? 0, box: { ...seedBox }, confidence: 1, needsReview: false }];
  let previousBox = { ...seedBox };
  let templateFrame = frames[0];

  for (let index = 1; index < frames.length; index += 1) {
    const result = findBestTemplateMatch({
      templateFrame,
      nextFrame: frames[index],
      previousBox,
      searchRadius,
    });
    results.push({ t: times[index] ?? index, ...result });
    previousBox = result.box;
    templateFrame = frames[index];
  }

  return results;
}
```

**Step 4: Run tracker tests**

Run:

```powershell
node --test tests/aoiTracker.test.js
```

Expected: PASS.

**Step 5: Wire admin Track AOI button**

In `src/app.js`, add `generateTrackedAoi()`:

- Require a local/package video file with loaded metadata.
- Require a seed box and AOI label.
- Pause video.
- Sample frames from current time to end at a configurable interval, starting with 0.5 seconds for MVP.
- For each sampled time:
  - Set `sourceVideo.currentTime`.
  - Wait for `seeked`.
  - Capture grayscale frame.
- Run `trackTemplateAcrossFrames`.
- Convert results to AOI keyframes with `pixelBoxToAoiKeyframe`.
- Add generated AOI to `activeAois`.
- Mark low-confidence keyframes with `needsReview`.
- Render AOI list and overlay.

Implementation shape:

```js
async function seekVideoTo(timeSec) {
  if (Math.abs(sourceVideo.currentTime - timeSec) < 0.05) {
    return;
  }

  await new Promise((resolve) => {
    const onSeeked = () => {
      sourceVideo.removeEventListener('seeked', onSeeked);
      resolve();
    };
    sourceVideo.addEventListener('seeked', onSeeked);
    sourceVideo.currentTime = timeSec;
  });
}
```

**Step 6: Add UI status updates**

During tracking:

- Disable `#generateAoiButton`.
- Set `#aoiGeneratorStatus` to `Tracking frame 3 of 20`.
- Re-enable button after completion.
- If any keyframe has `needsReview`, show `Generated AOI with 2 low-confidence keyframes. Review before packaging.`

**Step 7: Add smoke helper for generated keyframes**

In `tests/uiSmoke.mjs`, use the test helper to create a generated AOI with two keyframes and assert export includes them:

```js
const generatedDynamic = await page.evaluate(() => {
  const first = window.__aoiGenerateTestAoiFromBox({
    id: 'generated-moving',
    label: 'Generated moving',
    color: '#5dd7c8',
    t: 0,
    box: { x: 200, y: 120, width: 180, height: 100 },
  });
  first.keyframes.push({
    ...first.keyframes[0],
    t: 1,
  });
  return first;
});

assert.equal(generatedDynamic.keyframes.length, 2);
```

**Step 8: Run smoke test**

Run:

```powershell
npm run test:ui
```

Expected: PASS.

**Step 9: Commit**

```powershell
git add src/app.js src/aoiTracker.js tests/aoiTracker.test.js tests/uiSmoke.mjs
git commit -m "feat: track generated AOIs across video"
```

---

### Task 7: Export and Load `.aoi-study` Packages

**Files:**
- Modify: `index.html`
- Modify: `styles.css`
- Modify: `src/app.js`
- Modify: `tests/uiSmoke.mjs`

**Step 1: Write failing package UI smoke test**

In `tests/uiSmoke.mjs`, create a temporary package using browser code and load it in participant mode:

```js
await assert.doesNotReject(
  page.locator('#exportStudyPackageButton').waitFor({ state: 'visible', timeout: 1000 }),
  'Admin should expose study package export.',
);

const packageDownload = page.waitForEvent('download');
await page.locator('#exportStudyPackageButton').click();
const studyPackage = await packageDownload;
assert.match(studyPackage.suggestedFilename(), /\.aoi-study$/);

const participantPackagePage = await browser.newPage({ viewport: { width: 1366, height: 900 } });
await participantPackagePage.goto(urlWithMode('participant'), { waitUntil: 'networkidle' });
await participantPackagePage.locator('#studyPackageInput').setInputFiles(await studyPackage.path());
await participantPackagePage.waitForFunction(() => document.querySelector('#viewerNotice')?.textContent?.includes('Study package loaded'));
assert.equal(
  await participantPackagePage.locator('#participantStartButton').isEnabled(),
  false,
  'Study package loading should not bypass participant metadata requirements.',
);
await participantPackagePage.close();
```

**Step 2: Run failing smoke test**

Run:

```powershell
npm run test:ui
```

Expected: FAIL because package export/import UI does not exist.

**Step 3: Add package UI**

In `index.html`:

Admin controls:

```html
<button id="exportStudyPackageButton" type="button">Export study package</button>
```

Participant panel, before metadata fields:

```html
<label class="file-loader participant-package-loader">
  <span>Load study package</span>
  <input id="studyPackageInput" type="file" accept=".aoi-study,application/zip" />
</label>
```

**Step 4: Import package helpers**

In `src/app.js`:

```js
import {
  createStudyPackage,
  readStudyPackage,
} from './studyPackage.js?v=study-package-1';
```

**Step 5: Export study packages**

In `src/app.js`, add:

```js
async function exportStudyPackage() {
  if (!sourceVideoFile) {
    setNotice('Load a local video before exporting a participant study package.');
    return;
  }

  const packageBlob = await createStudyPackage({
    videoFile: sourceVideoFile,
    video: buildVideoPackageMetadata(),
    aois: activeAois,
    generatedBy: aoiSource === 'generated' ? 'seeded-template-tracker' : aoiSource,
  });
  const url = URL.createObjectURL(packageBlob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${sourceVideoFile.name.replace(/\.[^.]+$/, '') || 'study'}.aoi-study`;
  link.click();
  URL.revokeObjectURL(url);
}
```

**Step 6: Load study packages**

In `src/app.js`, add:

```js
async function loadStudyPackageFile(event) {
  const file = event.target.files?.[0];
  if (!file) {
    return;
  }

  try {
    const packageData = await readStudyPackage(file);
    const videoFileName = packageData.manifest.video.name || 'study-video.mp4';
    sourceVideoFile = new File([packageData.videoBlob], videoFileName, {
      type: packageData.videoBlob.type || packageData.manifest.video.type || 'video/mp4',
    });
    sourceVideo.src = URL.createObjectURL(packageData.videoBlob);
    sourceVideoInfo = {
      kind: 'study-package',
      name: videoFileName,
      path: packageData.manifest.video.file,
      type: sourceVideoFile.type,
      size: sourceVideoFile.size,
      lastModified: null,
      projection: packageData.manifest.video.projection || 'equirectangular',
      stereoLayout: packageData.manifest.video.stereoLayout || 'mono',
    };
    registerAois({
      video: packageData.manifest.video,
      aois: packageData.aois,
    }, file.name);
    sourceVideo.load();
    setNotice(`Study package loaded: ${file.name}. Enter participant details to begin.`, true);
  } catch (error) {
    setNotice(`Could not load study package: ${error.message}`);
  }
}
```

**Step 7: Wire events**

In `src/app.js`:

```js
exportStudyPackageButton.addEventListener('click', exportStudyPackage);
studyPackageInput.addEventListener('change', loadStudyPackageFile);
```

**Step 8: Run package smoke test**

Run:

```powershell
npm run test:ui
```

Expected: PASS.

**Step 9: Commit**

```powershell
git add index.html styles.css src/app.js tests/uiSmoke.mjs
git commit -m "feat: export participant-ready study packages"
```

---

### Task 8: Preserve Recording Export Compatibility

**Files:**
- Modify: `src/app.js`
- Modify: `tests/uiSmoke.mjs`
- Modify: `README.md`

**Step 1: Write failing recording export assertions**

In `tests/uiSmoke.mjs`, after existing recording export parse:

```js
assert.equal(
  exportedJson.project.includesVideoBinary,
  false,
  'Recording exports should stay lightweight and not embed the video binary.',
);
assert.equal(
  exportedJson.project.studyPackageVersion,
  1,
  'Recording exports should identify compatible study package version.',
);
assert.equal(
  typeof exportedJson.video.projection,
  'string',
  'Recording exports should keep projection metadata.',
);
```

**Step 2: Run failing smoke test**

Run:

```powershell
npm run test:ui
```

Expected: FAIL until recording export metadata is updated.

**Step 3: Update recording export package metadata**

In `src/app.js`, update `buildProjectPackage()`:

```js
function buildProjectPackage() {
  return {
    version: 1,
    studyPackageVersion: 1,
    video: buildVideoPackageMetadata(),
    aois: {
      source: aoiSource,
      count: activeAois.length,
      packaged: true,
    },
    includesVideoBinary: false,
  };
}
```

**Step 4: Add package provenance to generated AOIs**

In generated AOIs, include:

```js
generated: {
  method: 'seeded-template-tracker',
  sampledEverySec: 0.5,
  lowConfidenceKeyframes: 0,
}
```

**Step 5: Run smoke test**

Run:

```powershell
npm run test:ui
```

Expected: PASS.

**Step 6: Commit**

```powershell
git add src/app.js tests/uiSmoke.mjs README.md
git commit -m "docs: document study package recording compatibility"
```

---

### Task 9: Documentation and Manual Verification

**Files:**
- Modify: `README.md`

**Step 1: Update README with admin workflow**

Add a section:

```markdown
## Admin: Create a Participant Study Package

1. Open `http://localhost:5179/?mode=admin`.
2. Load a local video.
3. Choose projection:
   - `2D flat` for normal videos.
   - `360 equirectangular` for 360 videos.
4. Choose stereo layout:
   - `Mono` for normal videos.
   - `Side by side` or `Top bottom` for stereo 3D/VR videos.
5. Load AOI JSON or use the AOI generator.
6. For generated AOIs, pause the video, draw a seed box, then track it.
7. Review low-confidence keyframes.
8. Export `.aoi-study`.
```

**Step 2: Update README with participant workflow**

Add:

```markdown
## Participant: Load One File

Use `http://localhost:5179/?mode=participant`. Load the `.aoi-study` file from the researcher. The app restores the video, projection metadata, stereo metadata, and AOIs automatically. The participant still needs to enter metadata, consent, calibrate, check accuracy, and start recording.
```

**Step 3: Document limitations**

Add:

```markdown
The default AOI generator is a lightweight seed tracker, not a semantic AI detector. It is free and works without cloud services, but low-contrast objects, occlusion, fast motion, and large camera cuts need manual review. SAM or other model outputs can be imported later through the same AOI JSON/package format.
```

**Step 4: Run all unit tests**

Run:

```powershell
npm test
```

Expected: PASS.

**Step 5: Run UI smoke test**

Run:

```powershell
npm run test:ui
```

Expected: PASS.

**Step 6: Start dev server**

Run:

```powershell
npm run serve
```

Expected: server prints a localhost URL, normally `http://localhost:5179`.

**Step 7: Browser verification**

Open:

```text
http://localhost:5179/?mode=admin
```

Verify:

- Load a local MP4.
- Switch projection between `2D flat` and `360 equirectangular`.
- Draw a seed AOI.
- Generate at least one AOI.
- Export `.aoi-study`.

Open:

```text
http://localhost:5179/?mode=participant
```

Verify:

- Load the `.aoi-study`.
- Video appears without selecting a separate MP4.
- AOIs appear without selecting a separate JSON file.
- Participant metadata and consent still gate session start.
- No console errors from app code.

**Step 8: Commit**

```powershell
git add README.md
git commit -m "docs: add study package workflow"
```

---

## Future Optional Enhancements

- Add external detections import: accept JSON from SAM, CVAT, Roboflow, or Colab and convert masks/boxes to AOI keyframes.
- Add polygon AOIs after the box workflow is stable.
- Add keyframe review thumbnails for low-confidence generated AOIs.
- Add a smaller local ML detector only if it is proven usable on RTX 3060-class hardware.
- Add package size warnings for very large videos.
