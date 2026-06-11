# Restructuring and Eye Tracking Improvement Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Split the static AOI prototype into maintainable domain modules, then improve webcam eye-tracking precision, sampling quality, validation, and research-grade export metadata.

**Architecture:** Phase 1 is a behavior-preserving restructure that turns `src/app.js` into a thin browser controller and moves AOI, gaze, recording, viewer, and UI responsibilities behind explicit module boundaries. Phase 2 improves tracking through measurable upgrades: higher-rate sampling, calibration profiles, stricter validation, quality telemetry, head/face stability checks, better fixation detection, and benchmark reporting. Use compatibility re-export shims during moves so each task is small and reversible.

**Tech Stack:** Static HTML/CSS/JavaScript ES modules, Three.js, WebGazer.js, optional MediaPipe/FaceMesh quality signals, Node `node:test`, Playwright smoke tests, local `http-server`.

---

## Current Context

- `src/app.js` is the main integration file and currently owns DOM lookup, app mode, AOI registration/rendering, WebGazer setup, calibration, validation, recording, replay, and export.
- Pure helpers already exist in `src/aoiMath.js`, `src/aoiGeneration.js`, `src/gazeQuality.js`, and `src/analysisMetrics.js`.
- The AOI detection work is considered done enough that AOI shape/schema decisions should be treated as the source of truth during this restructure.
- Current exports sample at `SAMPLE_INTERVAL_MS = 150`, about 6.7 Hz. Phase 2 should raise this while preserving explicit quality metadata.
- The existing smoke suite depends on the root URL, Admin mode, Participant mode, WebGazer stubs, calibration flows, validation expiry, stale gaze, and recording export shape. Keep those tests green throughout.
- The working tree may contain user AOI work in `index.html`, `src/app.js`, `styles.css`, and `tests/uiSmoke.mjs`. Do not revert unrelated changes.

## Target Structure

```text
src/
  app/
    constants.js
    dom.js
    state.js
    appController.js

  viewer/
    projection.js
    threeViewer.js
    cameraControls.js

  aois/
    aoiSchema.js
    aoiMath.js
    aoiGeneration.js
    aoiOverlay.js
    aoiImport.js

  detection/
    colabJob.js
    colabImport.js
    detectionToAois.js

  gaze/
    gazeQuality.js
    calibrationTargets.js
    calibrationSession.js
    accuracyValidation.js
    qualityMonitor.js
    sessionQuality.js
    providers/
      webgazerProvider.js
      mouseProvider.js

  recording/
    analysisMetrics.js
    sampleBuilder.js
    recordingExport.js
    replay.js
    fixations.js

  utils/
    numbers.js
    time.js
```

Keep these temporary shims until all imports are migrated:

```js
// src/aoiMath.js
export * from './aois/aoiMath.js';

// src/aoiGeneration.js
export * from './aois/aoiGeneration.js';

// src/gazeQuality.js
export * from './gaze/gazeQuality.js';

// src/analysisMetrics.js
export * from './recording/analysisMetrics.js';
```

---

# Phase 1: Behavior-Preserving Restructure

## Phase 1 Acceptance Criteria

- `src/app.js` or `src/app/appController.js` contains orchestration only, not pure geometry, validation, export-building, provider implementation, or metric algorithms.
- Existing unit tests and smoke tests pass.
- Existing public export JSON remains backward compatible.
- Admin/Participant flows, AOI import/export, Colab job export/import, calibration, validation, recording, and review still work.
- WebGazer remains the active provider, but the app talks to it through a provider adapter.
- Every moved module has unit coverage before or during extraction.

---

### Task 1: Add App Constants Module

**Files:**
- Create: `src/app/constants.js`
- Create: `tests/appConstants.test.js`
- Modify: `src/app.js`

**Step 1: Write the failing test**

Create `tests/appConstants.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_VALIDATION_MAX_AGE_MS,
  GAZE_TIMING,
  RECORDING_SAMPLE_INTERVAL_MS,
} from '../src/app/constants.js';

test('exports stable timing constants used by the app shell', () => {
  assert.equal(RECORDING_SAMPLE_INTERVAL_MS, 150);
  assert.equal(DEFAULT_VALIDATION_MAX_AGE_MS, 5 * 60 * 1000);
  assert.deepEqual(GAZE_TIMING, {
    freshGazeMaxAgeMs: 180,
    liveGazeStaleMs: 450,
    liveGazeHoldMs: 1350,
    targetSettleDelayMs: 250,
    targetSampleDelayMs: 55,
  });
});
```

**Step 2: Run test to verify it fails**

Run:

```powershell
node --test tests/appConstants.test.js
```

Expected: FAIL because `src/app/constants.js` does not exist.

**Step 3: Extract constants**

Create `src/app/constants.js`:

```js
export const RECORDING_SAMPLE_INTERVAL_MS = 150;

export const GAZE_SMOOTHING = {
  alpha: 0.16,
  fastAlpha: 0.56,
  fastDistancePx: 260,
  maxJumpPx: 900,
  boundsMarginPx: 24,
  rawBoundsMarginRatio: 0.35,
};

export const GAZE_TIMING = {
  freshGazeMaxAgeMs: 180,
  liveGazeStaleMs: 450,
  liveGazeHoldMs: 1350,
  targetSettleDelayMs: 250,
  targetSampleDelayMs: 55,
};

export const TARGET_CAPTURE = {
  maxDispersionPx: 100,
  calibrationSamplesPerPoint: 12,
  validationSamplesPerPoint: 12,
  minAcceptedRefinementTargets: 7,
  minAcceptedValidationTargets: 5,
};

export const LIVE_QUALITY = {
  maxEvents: 24,
  minEvents: 12,
  maxBadRate: 0.5,
  maxConsecutiveBad: 8,
};

export const DEFAULT_VALIDATION_MAX_AGE_MS = 5 * 60 * 1000;
export const REVIEW_GAZE_EDGE_PADDING_PX = 12;
export const REVIEW_LOOP_GRACE_SEC = 0.25;
export const SVG_NS = 'http://www.w3.org/2000/svg';
```

In `src/app.js`, import the constants and replace the local constant definitions one group at a time. Keep names local if needed:

```js
import {
  DEFAULT_VALIDATION_MAX_AGE_MS,
  GAZE_SMOOTHING,
  GAZE_TIMING,
  LIVE_QUALITY,
  RECORDING_SAMPLE_INTERVAL_MS,
  REVIEW_GAZE_EDGE_PADDING_PX,
  REVIEW_LOOP_GRACE_SEC,
  SVG_NS,
  TARGET_CAPTURE,
} from './app/constants.js';

const SAMPLE_INTERVAL_MS = RECORDING_SAMPLE_INTERVAL_MS;
const GAZE_SMOOTHING_ALPHA = GAZE_SMOOTHING.alpha;
const FRESH_GAZE_MAX_AGE_MS = GAZE_TIMING.freshGazeMaxAgeMs;
```

**Step 4: Run tests**

Run:

```powershell
node --test tests/appConstants.test.js
npm test
```

Expected: PASS.

**Step 5: Commit**

```powershell
git add src/app/constants.js tests/appConstants.test.js src/app.js
git commit -m "refactor: extract app constants"
```

---

### Task 2: Add App State Factory

**Files:**
- Create: `src/app/state.js`
- Create: `tests/appState.test.js`
- Modify: `src/app.js`

**Step 1: Write the failing test**

Create `tests/appState.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createDefaultAois,
  createInitialAppState,
  createInitialVideoInfo,
} from '../src/app/state.js';

test('creates fresh app state without shared mutable arrays', () => {
  const first = createInitialAppState();
  const second = createInitialAppState();

  first.samples.push({ t: 1 });
  first.gaze.x = 123;

  assert.equal(second.samples.length, 0);
  assert.equal(second.gaze.x, 0);
  assert.equal(second.gaze.visible, false);
});

test('creates initial video metadata for bundled equirectangular demo', () => {
  assert.deepEqual(createInitialVideoInfo(), {
    kind: 'bundled',
    name: 'test-video.mp4',
    path: 'assets/test-video.mp4',
    type: 'video/mp4',
    size: null,
    lastModified: null,
    projection: 'equirectangular',
    stereoLayout: 'mono',
  });
});

test('creates fresh default AOI definitions', () => {
  const first = createDefaultAois();
  const second = createDefaultAois();

  first[0].label = 'Changed';

  assert.notEqual(second[0].label, 'Changed');
  assert.equal(second.some((aoi) => aoi.id === 'front-center'), true);
});
```

**Step 2: Run test to verify it fails**

Run:

```powershell
node --test tests/appState.test.js
```

Expected: FAIL because `src/app/state.js` does not exist.

**Step 3: Extract state factories**

Create `src/app/state.js` by moving `DEFAULT_AOIS`, `sourceVideoInfo`, `DEFAULT_GAZE`, and the `state = { ... }` shape out of `src/app.js`.

Minimum implementation shape:

```js
const DEFAULT_GAZE = { x: 0, y: 0, visible: false, source: 'webcam' };

const DEFAULT_AOIS = [
  // Move the existing DEFAULT_AOIS array from src/app.js here unchanged.
];

export function createDefaultAois() {
  return structuredClone(DEFAULT_AOIS);
}

export function createInitialVideoInfo() {
  return {
    kind: 'bundled',
    name: 'test-video.mp4',
    path: 'assets/test-video.mp4',
    type: 'video/mp4',
    size: null,
    lastModified: null,
    projection: 'equirectangular',
    stereoLayout: 'mono',
  };
}

export function createInitialAppState() {
  return {
    cameraYaw: 0,
    cameraPitch: 0,
    mode: 'webcam',
    gaze: { ...DEFAULT_GAZE },
    rawPageGaze: null,
    rawViewerGaze: null,
    rawGazeAt: 0,
    lastAcceptedGazeAt: 0,
    isRecording: false,
    samples: [],
    reviewSamples: [],
    reviewActive: false,
    reviewIndex: -1,
    reviewSource: null,
    reviewWindow: null,
    webcamStarted: false,
    webcamStatus: 'idle',
    gazeCorrection: null,
    refinementAccuracySummary: null,
    accuracySummary: null,
    correctedAccuracySummary: null,
    localAccuracyErrorModel: null,
    validationSamples: [],
    accuracySamples: [],
    accuracyValidated: false,
    accuracyValidatedAt: null,
    accuracyInvalidationReason: null,
    liveGazeQuality: null,
    droppedGazeSamples: 0,
    gazeDropReason: null,
    latestPoint: null,
    latestHits: [],
    latestAois: [],
    latestAoiClassification: null,
    latestUncertainty: null,
    calibrationIndex: 0,
    targetMode: 'calibration',
    targetCaptureInProgress: false,
    accuracyIndex: 0,
  };
}
```

In `src/app.js`:

```js
import {
  createDefaultAois,
  createInitialAppState,
  createInitialVideoInfo,
} from './app/state.js';

let activeAois = createDefaultAois();
let sourceVideoInfo = createInitialVideoInfo();
const state = createInitialAppState();
```

**Step 4: Run tests**

Run:

```powershell
node --test tests/appState.test.js
npm test
```

Expected: PASS.

**Step 5: Commit**

```powershell
git add src/app/state.js tests/appState.test.js src/app.js
git commit -m "refactor: extract app state factory"
```

---

### Task 3: Add DOM Lookup Boundary

**Files:**
- Create: `src/app/dom.js`
- Create: `tests/appDom.test.js`
- Modify: `src/app.js`

**Step 1: Write the failing test**

Create `tests/appDom.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import { getRequiredElement, queryAppDom } from '../src/app/dom.js';

function createDocument(selectors) {
  const elements = new Map(selectors.map((selector) => [selector, { selector }]));
  return {
    querySelector(selector) {
      return elements.get(selector) || null;
    },
  };
}

test('getRequiredElement returns an existing selector', () => {
  const document = createDocument(['#viewer']);

  assert.deepEqual(getRequiredElement(document, '#viewer'), { selector: '#viewer' });
});

test('getRequiredElement throws a useful error for missing selectors', () => {
  const document = createDocument([]);

  assert.throws(
    () => getRequiredElement(document, '#viewer'),
    /Missing required DOM element: #viewer/,
  );
});

test('queryAppDom resolves core app selectors', () => {
  const document = createDocument([
    '#appShell',
    '#viewer',
    '#viewerSection',
    '#viewerNotice',
    '#aoiOverlay',
    '#gazeDot',
    '#sourceVideo',
    '#miniMap',
    '#controlPanel',
    '#participantPanel',
    '#calibrationOverlay',
    '#calibrationTarget',
  ]);

  const dom = queryAppDom(document);

  assert.equal(dom.viewer.selector, '#viewer');
  assert.equal(dom.sourceVideo.selector, '#sourceVideo');
});
```

**Step 2: Run test to verify it fails**

Run:

```powershell
node --test tests/appDom.test.js
```

Expected: FAIL because `src/app/dom.js` does not exist.

**Step 3: Extract DOM queries**

Create `src/app/dom.js`:

```js
export function getRequiredElement(documentRef, selector) {
  const element = documentRef.querySelector(selector);

  if (!element) {
    throw new Error(`Missing required DOM element: ${selector}`);
  }

  return element;
}

export function queryAppDom(documentRef = document) {
  return {
    appShell: getRequiredElement(documentRef, '#appShell'),
    viewer: getRequiredElement(documentRef, '#viewer'),
    viewerSection: getRequiredElement(documentRef, '#viewerSection'),
    viewerNotice: getRequiredElement(documentRef, '#viewerNotice'),
    aoiOverlay: getRequiredElement(documentRef, '#aoiOverlay'),
    gazeDot: getRequiredElement(documentRef, '#gazeDot'),
    sourceVideo: getRequiredElement(documentRef, '#sourceVideo'),
    miniMap: getRequiredElement(documentRef, '#miniMap'),
    controlPanel: getRequiredElement(documentRef, '#controlPanel'),
    participantPanel: getRequiredElement(documentRef, '#participantPanel'),
    calibrationOverlay: getRequiredElement(documentRef, '#calibrationOverlay'),
    calibrationTarget: getRequiredElement(documentRef, '#calibrationTarget'),
  };
}
```

Then expand `queryAppDom` to include all selectors currently assigned at the top of `src/app.js`. In `src/app.js`, replace top-level `document.querySelector(...)` constants with:

```js
import { queryAppDom } from './app/dom.js';

const dom = queryAppDom(document);
const {
  appShell,
  viewer,
  viewerSection,
  viewerNotice,
  aoiOverlay,
  gazeDot,
  sourceVideo,
  miniMap,
} = dom;
```

Keep destructuring verbose in this task to minimize downstream changes.

**Step 4: Run tests**

Run:

```powershell
node --test tests/appDom.test.js
npm test
```

Expected: PASS.

**Step 5: Commit**

```powershell
git add src/app/dom.js tests/appDom.test.js src/app.js
git commit -m "refactor: centralize app dom lookup"
```

---

### Task 4: Move Existing Pure Modules Into Domain Folders With Shims

**Files:**
- Create: `src/aois/aoiMath.js`
- Create: `src/aois/aoiGeneration.js`
- Create: `src/gaze/gazeQuality.js`
- Create: `src/recording/analysisMetrics.js`
- Modify: `src/aoiMath.js`
- Modify: `src/aoiGeneration.js`
- Modify: `src/gazeQuality.js`
- Modify: `src/analysisMetrics.js`
- Modify: `tests/aoiMath.test.js`
- Modify: `tests/aoiGeneration.test.js`
- Modify: `tests/gazeQuality.test.js`
- Modify: `tests/analysisMetrics.test.js`

**Step 1: Write failing import tests by changing test imports**

Update imports:

```js
// tests/aoiMath.test.js
} from '../src/aois/aoiMath.js';

// tests/aoiGeneration.test.js
} from '../src/aois/aoiGeneration.js';

// tests/gazeQuality.test.js
} from '../src/gaze/gazeQuality.js';

// tests/analysisMetrics.test.js
} from '../src/recording/analysisMetrics.js';
```

**Step 2: Run test to verify it fails**

Run:

```powershell
node --test tests/aoiMath.test.js tests/aoiGeneration.test.js tests/gazeQuality.test.js tests/analysisMetrics.test.js
```

Expected: FAIL because domain-folder modules do not exist.

**Step 3: Move module contents and add compatibility shims**

Move file contents exactly:

```powershell
New-Item -ItemType Directory -Force src\aois,src\gaze,src\recording
```

Use `apply_patch` or a safe editor to move the contents:

- Move current `src/aoiMath.js` content to `src/aois/aoiMath.js`.
- Move current `src/aoiGeneration.js` content to `src/aois/aoiGeneration.js`.
- Move current `src/gazeQuality.js` content to `src/gaze/gazeQuality.js`.
- Move current `src/analysisMetrics.js` content to `src/recording/analysisMetrics.js`.

Replace the old files with shims:

```js
export * from './aois/aoiMath.js';
```

```js
export * from './aois/aoiGeneration.js';
```

```js
export * from './gaze/gazeQuality.js';
```

```js
export * from './recording/analysisMetrics.js';
```

Update any internal relative imports after the move. For example, if `src/aois/aoiGeneration.js` imports `./aoiMath.js`, keep it relative inside the same folder.

**Step 4: Run tests**

Run:

```powershell
npm test
```

Expected: PASS.

**Step 5: Commit**

```powershell
git add src/aois src/gaze src/recording src/aoiMath.js src/aoiGeneration.js src/gazeQuality.js src/analysisMetrics.js tests
git commit -m "refactor: move pure modules into domain folders"
```

---

### Task 5: Extract AOI Schema, Validation, and Import Normalization

**Files:**
- Create: `src/aois/aoiSchema.js`
- Create: `src/aois/aoiImport.js`
- Create: `tests/aoiSchema.test.js`
- Modify: `src/app.js`

**Step 1: Write the failing tests**

Create `tests/aoiSchema.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  extractAoisFromJson,
  extractProjectMetadataFromJson,
  getAoiSpace,
  isValidAoi,
} from '../src/aois/aoiImport.js';

test('validates panorama and video box AOIs', () => {
  assert.equal(isValidAoi({
    id: 'front',
    label: 'Front',
    yawMin: -10,
    yawMax: 10,
    pitchMin: -5,
    pitchMax: 5,
  }), true);

  assert.equal(isValidAoi({
    id: 'logo',
    label: 'Logo',
    space: 'video',
    xMin: 0.1,
    xMax: 0.4,
    yMin: 0.2,
    yMax: 0.5,
  }), true);
});

test('defaults missing AOI space to panorama', () => {
  assert.equal(getAoiSpace({ id: 'legacy' }), 'panorama');
});

test('extracts AOIs from arrays and exported project JSON', () => {
  const aois = [{ id: 'front', yawMin: -5, yawMax: 5, pitchMin: -5, pitchMax: 5 }];

  assert.deepEqual(extractAoisFromJson(aois), aois);
  assert.deepEqual(extractAoisFromJson({ aois }), aois);
});

test('extracts project metadata from sidecar JSON', () => {
  assert.deepEqual(
    extractProjectMetadataFromJson({
      video: { projection: 'flat', stereoLayout: 'mono' },
      aois: [],
    }),
    { video: { projection: 'flat', stereoLayout: 'mono' } },
  );
});
```

**Step 2: Run test to verify it fails**

Run:

```powershell
node --test tests/aoiSchema.test.js
```

Expected: FAIL because modules do not exist.

**Step 3: Extract implementation**

Move these functions from `src/app.js` into `src/aois/aoiImport.js`:

- `isFiniteNumber`
- `getAoiSpace`
- `isValidVideoAoiBounds`
- `isValidPanoramaAoiBounds`
- `isValidAoiBounds`
- `isValidAoiKeyframes`
- `isValidAoi`
- `extractProjectMetadataFromJson`
- `extractAoisFromJson`

Create `src/aois/aoiSchema.js` for reusable schema constants:

```js
export const AOI_SPACES = {
  panorama: 'panorama',
  video: 'video',
};

export const AOI_SHAPES = {
  box: 'box',
  polygon: 'polygon',
};
```

Keep `registerAois(...)` in `src/app.js` for now, but call the extracted import functions.

**Step 4: Run tests**

Run:

```powershell
node --test tests/aoiSchema.test.js
npm test
```

Expected: PASS.

**Step 5: Commit**

```powershell
git add src/aois/aoiSchema.js src/aois/aoiImport.js tests/aoiSchema.test.js src/app.js
git commit -m "refactor: extract AOI import validation"
```

---

### Task 6: Extract AOI Overlay Projection Models

**Files:**
- Create: `src/aois/aoiOverlay.js`
- Create: `tests/aoiOverlay.test.js`
- Modify: `src/app.js`

**Step 1: Write the failing tests**

Create `tests/aoiOverlay.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildAoiOverlayModels,
  clipPolygonToRect,
  projectVideoAoiRange,
  splitAoiYawRanges,
} from '../src/aois/aoiOverlay.js';

test('splits panorama AOIs across the yaw wrap boundary', () => {
  assert.deepEqual(
    splitAoiYawRanges({ yawMin: 170, yawMax: -170 }),
    [
      { yawMin: 170, yawMax: 180 },
      { yawMin: -180, yawMax: -170 },
    ],
  );
});

test('clips polygons to viewer rect', () => {
  const clipped = clipPolygonToRect([
    { x: -10, y: 10 },
    { x: 50, y: 10 },
    { x: 50, y: 50 },
    { x: -10, y: 50 },
  ], 100, 100);

  assert.equal(clipped.every((point) => point.x >= 0 && point.x <= 100), true);
});

test('projects normalized video AOI boxes into viewer pixels', () => {
  assert.deepEqual(
    projectVideoAoiRange(
      { xMin: 0.25, xMax: 0.5, yMin: 0.1, yMax: 0.3 },
      { width: 800, height: 600 },
    ),
    [
      { x: 200, y: 60 },
      { x: 400, y: 60 },
      { x: 400, y: 180 },
      { x: 200, y: 180 },
    ],
  );
});

test('builds render models for video AOIs', () => {
  const models = buildAoiOverlayModels({
    aois: [{
      id: 'logo',
      label: 'Logo',
      color: '#ffd166',
      space: 'video',
      xMin: 0.25,
      xMax: 0.5,
      yMin: 0.1,
      yMax: 0.3,
    }],
    rect: { width: 800, height: 600 },
    camera: { yaw: 0, pitch: 0, fov: 75 },
  });

  assert.equal(models.length, 1);
  assert.equal(models[0].id, 'logo');
  assert.equal(models[0].points.length, 4);
});
```

**Step 2: Run test to verify it fails**

Run:

```powershell
node --test tests/aoiOverlay.test.js
```

Expected: FAIL because `src/aois/aoiOverlay.js` does not exist.

**Step 3: Extract implementation**

Move these pure or mostly pure functions from `src/app.js` into `src/aois/aoiOverlay.js`:

- `splitAoiYawRanges`
- `clampNumber`
- `interpolateScreenPoint`
- `clipPolygonAgainstBoundary`
- `clipPolygonToRect`
- `projectAoiRange`
- `projectVideoAoiRange`
- `getAoiOverlayColor`

Add a pure model builder:

```js
import { panoramaPointToScreen } from './aoiMath.js';

export function buildAoiOverlayModels({
  aois,
  rect,
  camera,
}) {
  return aois.flatMap((aoi) => {
    const color = getAoiOverlayColor(aoi);

    if (aoi.space === 'video') {
      const points = projectVideoAoiRange(aoi, rect);
      return [{ id: aoi.id, label: aoi.label, color, points, labelPoint: points[0] }];
    }

    return splitAoiYawRanges(aoi)
      .map((range) => projectAoiRange(aoi, range.yawMin, range.yawMax, rect, camera))
      .filter((points) => points.length >= 3)
      .map((points) => ({ id: aoi.id, label: aoi.label, color, points, labelPoint: points[0] }));
  });
}
```

Adjust `projectAoiRange` signature so it accepts `camera` instead of closing over app state:

```js
export function projectAoiRange(aoi, yawMin, yawMax, rect, camera) {
  const corners = [
    { yaw: yawMin, pitch: aoi.pitchMin },
    { yaw: yawMax, pitch: aoi.pitchMin },
    { yaw: yawMax, pitch: aoi.pitchMax },
    { yaw: yawMin, pitch: aoi.pitchMax },
  ].map((point) => panoramaPointToScreen({
    yaw: point.yaw,
    pitch: point.pitch,
    width: rect.width,
    height: rect.height,
    cameraYaw: camera.yaw,
    cameraPitch: camera.pitch,
    fov: camera.fov,
  }));

  if (!corners.some((point) => point.inFront)) {
    return [];
  }

  return clipPolygonToRect(corners, rect.width, rect.height);
}
```

In `src/app.js`, keep DOM creation in `drawAoiOverlay()`, but use `buildAoiOverlayModels(...)` to get shape data.

**Step 4: Run tests**

Run:

```powershell
node --test tests/aoiOverlay.test.js
npm test
```

Expected: PASS.

**Step 5: Commit**

```powershell
git add src/aois/aoiOverlay.js tests/aoiOverlay.test.js src/app.js
git commit -m "refactor: extract AOI overlay projection"
```

---

### Task 7: Extract Recording Sample and Export Builders

**Files:**
- Create: `src/recording/sampleBuilder.js`
- Create: `src/recording/recordingExport.js`
- Create: `tests/recordingExport.test.js`
- Modify: `src/app.js`

**Step 1: Write the failing tests**

Create `tests/recordingExport.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import { buildRecordingSample } from '../src/recording/sampleBuilder.js';
import {
  buildExportPayload,
  buildExportSummary,
  buildVideoPackageMetadata,
} from '../src/recording/recordingExport.js';

test('builds recording samples with raw, corrected, AOI, and quality fields', () => {
  const sample = buildRecordingSample({
    timeSec: 1.2345,
    source: 'webcam',
    gaze: { x: 100.4, y: 200.6 },
    rawGaze: { x: 95.1, y: 205.9 },
    camera: { yaw: 12.3456, pitch: -4.321, fov: 75 },
    panorama: { yaw: 10.111, pitch: -3.222 },
    hits: [{ id: 'front' }],
    activeAois: [{ id: 'front', label: 'Front', yawMin: -10, yawMax: 10, pitchMin: -5, pitchMax: 5 }],
    classification: {
      likelyHits: [{ id: 'front' }],
      possibleHits: [{ id: 'front' }],
      ambiguousHits: [],
    },
    uncertainty: { px: 50, yawRadius: 2, pitchRadius: 1 },
    quality: { trustedForAoiAnalysis: true },
  });

  assert.equal(sample.t, 1.234);
  assert.deepEqual(sample.hits, ['front']);
  assert.deepEqual(sample.likelyHits, ['front']);
  assert.equal(sample.quality.trustedForAoiAnalysis, true);
});

test('builds summary counts and duration from samples', () => {
  const summary = buildExportSummary([
    { t: 0, source: 'mouse', hits: ['logo'], likelyHits: ['logo'], possibleHits: [], ambiguousHits: [], quality: { trustedForAoiAnalysis: true } },
    { t: 0.15, source: 'mouse', hits: ['logo'], likelyHits: [], possibleHits: ['logo'], ambiguousHits: ['logo'], quality: { trustedForAoiAnalysis: true } },
  ], {
    accuracyValidated: false,
    correctedAccuracySummary: null,
  });

  assert.equal(summary.totalSamples, 2);
  assert.equal(summary.sources.mouse, 2);
  assert.equal(summary.aoiHitCounts.logo, 2);
  assert.equal(summary.trustedSampleCount, 2);
});

test('builds video package metadata from source info and video element', () => {
  const metadata = buildVideoPackageMetadata({
    sourceVideoInfo: { name: 'demo.mp4', projection: 'flat', stereoLayout: 'mono' },
    sourceVideo: { duration: 12.345, videoWidth: 1280, videoHeight: 720 },
  });

  assert.equal(metadata.name, 'demo.mp4');
  assert.equal(metadata.durationSec, 12.345);
  assert.equal(metadata.projection, 'flat');
  assert.equal(metadata.width, 1280);
});
```

**Step 2: Run test to verify it fails**

Run:

```powershell
node --test tests/recordingExport.test.js
```

Expected: FAIL because modules do not exist.

**Step 3: Extract sample and export code**

Move or adapt from `src/app.js`:

- `countValues`
- `getSampleDurations`
- `sumDwellSeconds`
- `buildExportSummary`
- `buildVideoPackageMetadata`
- `buildProjectPackage`
- most of `exportSamples` payload construction

Create `src/recording/sampleBuilder.js`:

```js
function roundNullable(value, digits) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

function serializeAoiSnapshot(aoi) {
  return {
    id: aoi.id,
    label: aoi.label,
    color: aoi.color,
    space: aoi.space || 'panorama',
    shape: aoi.shape || 'box',
    yawMin: roundNullable(aoi.yawMin, 3),
    yawMax: roundNullable(aoi.yawMax, 3),
    pitchMin: roundNullable(aoi.pitchMin, 3),
    pitchMax: roundNullable(aoi.pitchMax, 3),
    xMin: roundNullable(aoi.xMin, 6),
    xMax: roundNullable(aoi.xMax, 6),
    yMin: roundNullable(aoi.yMin, 6),
    yMax: roundNullable(aoi.yMax, 6),
    points: Array.isArray(aoi.points) ? aoi.points : null,
  };
}

export function buildRecordingSample(input) {
  return {
    t: Number(input.timeSec.toFixed(3)),
    source: input.source,
    quality: input.quality,
    screen: {
      x: Math.round(input.gaze.x),
      y: Math.round(input.gaze.y),
    },
    rawScreen: input.rawGaze ? {
      x: Math.round(input.rawGaze.x),
      y: Math.round(input.rawGaze.y),
    } : null,
    camera: {
      yaw: Number(input.camera.yaw.toFixed(3)),
      pitch: Number(input.camera.pitch.toFixed(3)),
      fov: input.camera.fov,
    },
    panorama: {
      yaw: Number(input.panorama.yaw.toFixed(3)),
      pitch: Number(input.panorama.pitch.toFixed(3)),
    },
    hits: input.hits.map((hit) => hit.id),
    activeAois: input.activeAois.map(serializeAoiSnapshot),
    likelyHits: input.classification?.likelyHits.map((hit) => hit.id) || [],
    possibleHits: input.classification?.possibleHits.map((hit) => hit.id) || [],
    ambiguousHits: input.classification?.ambiguousHits.map((hit) => hit.id) || [],
    gazeUncertainty: input.uncertainty || { px: 0, yawRadius: 0, pitchRadius: 0 },
  };
}
```

Then update `maybeSample(...)` in `src/app.js` to call `buildRecordingSample(...)`.

**Step 4: Run tests**

Run:

```powershell
node --test tests/recordingExport.test.js
npm test
```

Expected: PASS.

**Step 5: Commit**

```powershell
git add src/recording/sampleBuilder.js src/recording/recordingExport.js tests/recordingExport.test.js src/app.js
git commit -m "refactor: extract recording export builders"
```

---

### Task 8: Extract Review and Replay Helpers

**Files:**
- Create: `src/recording/replay.js`
- Create: `tests/replay.test.js`
- Modify: `src/app.js`

**Step 1: Write the failing tests**

Create `tests/replay.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  extractRecordingSamplesFromJson,
  findReviewSampleIndex,
  getReviewTimeWindow,
  isValidReviewSample,
} from '../src/recording/replay.js';

test('validates replay samples with time and panorama point', () => {
  assert.equal(isValidReviewSample({ t: 0, panorama: { yaw: 1, pitch: 2 } }), true);
  assert.equal(isValidReviewSample({ t: 0, screen: { x: 1, y: 2 } }), false);
});

test('extracts samples from exported recording JSON', () => {
  const samples = [{ t: 0, panorama: { yaw: 1, pitch: 2 } }];

  assert.deepEqual(extractRecordingSamplesFromJson({ samples }), samples);
});

test('finds nearest replay sample by time', () => {
  const samples = [
    { t: 0, panorama: { yaw: 0, pitch: 0 } },
    { t: 1, panorama: { yaw: 1, pitch: 0 } },
    { t: 2, panorama: { yaw: 2, pitch: 0 } },
  ];

  assert.equal(findReviewSampleIndex(samples, 1.2), 1);
  assert.equal(findReviewSampleIndex(samples, 1.8), 2);
});

test('computes review window from sorted samples', () => {
  assert.deepEqual(
    getReviewTimeWindow([{ t: 2 }, { t: 0.5 }, { t: 1 }]),
    { start: 0.5, end: 2 },
  );
});
```

**Step 2: Run test to verify it fails**

Run:

```powershell
node --test tests/replay.test.js
```

Expected: FAIL because `src/recording/replay.js` does not exist.

**Step 3: Extract implementation**

Move from `src/app.js`:

- `isValidReviewSample`
- `extractRecordingSamplesFromJson`
- `registerRecording` pure filtering/sorting portion
- `findReviewSampleIndex`
- `getReviewTimeWindow`

Keep DOM/UI state mutation in `src/app.js`, but call pure helpers.

Implementation shape:

```js
export function isValidReviewSample(sample) {
  return (
    Number.isFinite(sample?.t) &&
    Number.isFinite(sample?.panorama?.yaw) &&
    Number.isFinite(sample?.panorama?.pitch)
  );
}

export function extractRecordingSamplesFromJson(json) {
  if (Array.isArray(json?.samples)) {
    return json.samples;
  }

  throw new Error('Recording JSON must be an exported object with a samples array.');
}

export function findReviewSampleIndex(samples, timeSec) {
  if (!samples.length) {
    return -1;
  }

  if (!Number.isFinite(timeSec) || timeSec <= samples[0].t) {
    return 0;
  }

  if (timeSec >= samples[samples.length - 1].t) {
    return samples.length - 1;
  }

  let bestIndex = 0;
  let bestDistance = Infinity;

  samples.forEach((sample, index) => {
    const distance = Math.abs(sample.t - timeSec);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  });

  return bestIndex;
}
```

**Step 4: Run tests**

Run:

```powershell
node --test tests/replay.test.js
npm test
```

Expected: PASS.

**Step 5: Commit**

```powershell
git add src/recording/replay.js tests/replay.test.js src/app.js
git commit -m "refactor: extract recording replay helpers"
```

---

### Task 9: Extract Gaze Provider Adapters

**Files:**
- Create: `src/gaze/providers/webgazerProvider.js`
- Create: `src/gaze/providers/mouseProvider.js`
- Create: `tests/gazeProviders.test.js`
- Modify: `src/app.js`

**Step 1: Write the failing tests**

Create `tests/gazeProviders.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import { createMouseProvider } from '../src/gaze/providers/mouseProvider.js';
import { createWebGazerProvider } from '../src/gaze/providers/webgazerProvider.js';

test('mouse provider emits viewer-relative gaze points', () => {
  const emitted = [];
  const viewer = {
    getBoundingClientRect: () => ({ left: 10, top: 20, width: 300, height: 200 }),
    addEventListener(type, listener) {
      this.listener = listener;
    },
    removeEventListener() {},
  };
  const provider = createMouseProvider({ viewer, onGaze: (gaze) => emitted.push(gaze) });

  provider.start();
  viewer.listener({ clientX: 110, clientY: 70 });

  assert.deepEqual(emitted[0], {
    x: 100,
    y: 50,
    visible: true,
    source: 'mouse',
  });
});

test('webgazer provider configures controlled calibration and forwards gaze', async () => {
  const calls = [];
  let listener = null;
  const webgazer = {
    saveDataAcrossSessions(value) { calls.push(['saveDataAcrossSessions', value]); return this; },
    setRegression(value) { calls.push(['setRegression', value]); return this; },
    setTracker(value) { calls.push(['setTracker', value]); return this; },
    applyKalmanFilter(value) { calls.push(['applyKalmanFilter', value]); return this; },
    showFaceOverlay(value) { calls.push(['showFaceOverlay', value]); return this; },
    showFaceFeedbackBox(value) { calls.push(['showFaceFeedbackBox', value]); return this; },
    showVideoPreview(value) { calls.push(['showVideoPreview', value]); return this; },
    removeMouseEventListeners() { calls.push(['removeMouseEventListeners']); return this; },
    setGazeListener(callback) { listener = callback; return this; },
    async begin() { calls.push(['begin']); },
    recordScreenPosition(x, y, eventType) { calls.push(['recordScreenPosition', x, y, eventType]); },
    async clearData() { calls.push(['clearData']); },
  };
  const emitted = [];
  const provider = createWebGazerProvider({
    webgazer,
    onGaze: (gaze) => emitted.push(gaze),
  });

  await provider.start();
  listener({ x: 11, y: 22 });
  provider.recordCalibrationPoint({ x: 33, y: 44 });
  await provider.resetCalibration();

  assert.deepEqual(calls.slice(0, 4), [
    ['saveDataAcrossSessions', false],
    ['setRegression', 'ridge'],
    ['setTracker', 'TFFacemesh'],
    ['applyKalmanFilter', false],
  ]);
  assert.deepEqual(emitted[0], { x: 11, y: 22, visible: true, source: 'webcam' });
  assert.equal(calls.some((call) => call[0] === 'recordScreenPosition'), true);
  assert.equal(calls.some((call) => call[0] === 'clearData'), true);
});
```

**Step 2: Run test to verify it fails**

Run:

```powershell
node --test tests/gazeProviders.test.js
```

Expected: FAIL because providers do not exist.

**Step 3: Implement providers**

Create `src/gaze/providers/mouseProvider.js`:

```js
export function createMouseProvider({ viewer, onGaze }) {
  let active = false;

  function handleMouseMove(event) {
    if (!active) {
      return;
    }

    const rect = viewer.getBoundingClientRect();
    onGaze({
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
      visible: true,
      source: 'mouse',
    });
  }

  return {
    start() {
      active = true;
      viewer.addEventListener('mousemove', handleMouseMove);
    },
    stop() {
      active = false;
      viewer.removeEventListener('mousemove', handleMouseMove);
    },
  };
}
```

Create `src/gaze/providers/webgazerProvider.js`:

```js
export function createWebGazerProvider({ webgazer, onGaze }) {
  function configure() {
    webgazer.saveDataAcrossSessions?.(false);
    webgazer.setRegression?.('ridge');
    webgazer.setTracker?.('TFFacemesh');
    webgazer.applyKalmanFilter?.(false);
    webgazer.showFaceOverlay?.(true);
    webgazer.showFaceFeedbackBox?.(true);
  }

  return {
    async start() {
      if (!webgazer) {
        throw new Error('WebGazer did not load.');
      }

      configure();
      webgazer.showVideoPreview?.(true);
      webgazer.setGazeListener((data) => {
        if (!data) {
          return;
        }

        onGaze({
          x: data.x,
          y: data.y,
          visible: true,
          source: 'webcam',
        });
      });
      await webgazer.begin();
      webgazer.removeMouseEventListeners?.();
    },
    async resetCalibration() {
      await webgazer.clearData?.();
    },
    recordCalibrationPoint({ x, y }) {
      webgazer.recordScreenPosition?.(x, y, 'click');
    },
    stop() {
      webgazer.setGazeListener?.(null);
    },
  };
}
```

Update `src/app.js`:

- Replace direct WebGazer configuration helpers with the provider.
- `ensureWebcamGaze()` creates/starts `webcamProvider`.
- `captureCalibrationPoint()` calls `webcamProvider.recordCalibrationPoint({ x, y })`.
- `resetWebcamCalibrationData()` calls `webcamProvider.resetCalibration()`.
- Mouse mode uses `createMouseProvider(...)` instead of direct `mousemove` logic.

**Step 4: Run tests**

Run:

```powershell
node --test tests/gazeProviders.test.js
npm test
```

Expected: PASS.

**Step 5: Commit**

```powershell
git add src/gaze/providers tests/gazeProviders.test.js src/app.js
git commit -m "refactor: add gaze provider adapters"
```

---

### Task 10: Extract Calibration Targets and Accuracy Validation Orchestration

**Files:**
- Create: `src/gaze/calibrationTargets.js`
- Create: `src/gaze/accuracyValidation.js`
- Create: `tests/accuracyValidation.test.js`
- Modify: `src/app.js`

**Step 1: Write the failing tests**

Create `tests/accuracyValidation.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ACCURACY_REFINEMENT_POINTS,
  ACCURACY_VALIDATION_POINTS,
  CALIBRATION_POINTS,
  getTargetPointsForMode,
} from '../src/gaze/calibrationTargets.js';
import { evaluateAccuracyCheck } from '../src/gaze/accuracyValidation.js';

test('keeps calibration and validation point sets explicit', () => {
  assert.equal(CALIBRATION_POINTS.length >= 14, true);
  assert.equal(ACCURACY_REFINEMENT_POINTS.length, 9);
  assert.equal(ACCURACY_VALIDATION_POINTS.length, 8);
  assert.equal(getTargetPointsForMode('accuracy').length, 17);
});

test('evaluates a passing accuracy check with separate holdout validation', () => {
  const viewport = { width: 1000, height: 700 };
  const refinementSamples = ACCURACY_REFINEMENT_POINTS.map((point) => ({
    target: { x: point.x * 10, y: point.y * 7 },
    gaze: { x: point.x * 10 + 2, y: point.y * 7 - 2 },
    dispersionPx: 5,
    viewport,
  }));
  const validationSamples = ACCURACY_VALIDATION_POINTS.map((point) => ({
    target: { x: point.x * 10, y: point.y * 7 },
    gaze: { x: point.x * 10 + 2, y: point.y * 7 - 2 },
    dispersionPx: 5,
    viewport,
  }));

  const result = evaluateAccuracyCheck({
    refinementSamples,
    validationSamples,
    minAcceptedRefinementTargets: 7,
    minAcceptedValidationTargets: 5,
  });

  assert.equal(result.validationPassed, true);
  assert.equal(result.correctedValidationSummary.quality, 'good');
  assert.ok(result.liveCalibration);
});
```

**Step 2: Run test to verify it fails**

Run:

```powershell
node --test tests/accuracyValidation.test.js
```

Expected: FAIL because modules do not exist.

**Step 3: Extract implementation**

Move target arrays from `src/app.js` to `src/gaze/calibrationTargets.js`.

Create `src/gaze/accuracyValidation.js` from the bottom half of `captureAccuracyPoint()`:

```js
import {
  applyViewportCalibration,
  buildAccuracyCorrection,
  buildLocalAccuracyErrorModel,
  hasSufficientSpatialCoverage,
  isAccuracyValidationUsable,
  normalizeAccuracySample,
  summarizeAccuracy,
} from './gazeQuality.js';

export function evaluateAccuracyCheck({
  refinementSamples,
  validationSamples,
  minAcceptedRefinementTargets,
  minAcceptedValidationTargets,
}) {
  if (
    refinementSamples.length < minAcceptedRefinementTargets ||
    validationSamples.length < minAcceptedValidationTargets
  ) {
    return {
      validationPassed: false,
      reason: 'too-few-targets',
      accuracySummary: summarizeAccuracy([]),
    };
  }

  const normalizedRefinementSamples = refinementSamples.map((sample) => (
    normalizeAccuracySample(sample, sample.viewport)
  ));
  const normalizedValidationSamples = validationSamples.map((sample) => (
    normalizeAccuracySample(sample, sample.viewport)
  ));

  if (
    !hasSufficientSpatialCoverage(normalizedRefinementSamples, { minXRange: 0.45, minYRange: 0.45 }) ||
    !hasSufficientSpatialCoverage(normalizedValidationSamples, { minXRange: 0.22, minYRange: 0.22 })
  ) {
    return {
      validationPassed: false,
      reason: 'insufficient-coverage',
      accuracySummary: summarizeAccuracy([]),
    };
  }

  const refinement = buildAccuracyCorrection(normalizedRefinementSamples, {
    maxCorrectedMeanPx: 0.2,
  });
  const correctedValidationSamples = validationSamples.map((sample) => ({
    ...sample,
    gaze: applyViewportCalibration(sample.gaze, refinement.calibration, sample.viewport),
  }));
  const validationSummary = summarizeAccuracy(validationSamples);
  const correctedValidationSummary = summarizeAccuracy(correctedValidationSamples);
  const validationPassed = isAccuracyValidationUsable(correctedValidationSummary, {
    minSamples: minAcceptedValidationTargets,
  });
  const finalCorrection = validationPassed
    ? buildAccuracyCorrection([...normalizedRefinementSamples, ...normalizedValidationSamples], {
      maxCorrectedMeanPx: 0.2,
    })
    : null;
  const liveCalibration = finalCorrection?.accepted
    ? finalCorrection.calibration
    : refinement.calibration;

  return {
    validationPassed,
    reason: validationPassed ? null : 'failed-validation-thresholds',
    refinement,
    validationSummary,
    correctedValidationSummary,
    correctedValidationSamples,
    liveCalibration,
    localAccuracyErrorModel: validationPassed
      ? buildLocalAccuracyErrorModel(correctedValidationSamples)
      : null,
  };
}
```

Update `captureAccuracyPoint()` to collect samples, then call `evaluateAccuracyCheck(...)`.

**Step 4: Run tests**

Run:

```powershell
node --test tests/accuracyValidation.test.js
npm test
```

Expected: PASS.

**Step 5: Commit**

```powershell
git add src/gaze/calibrationTargets.js src/gaze/accuracyValidation.js tests/accuracyValidation.test.js src/app.js
git commit -m "refactor: extract accuracy validation flow"
```

---

### Task 11: Extract Viewer Projection and Camera Controls

**Files:**
- Create: `src/viewer/projection.js`
- Create: `src/viewer/cameraControls.js`
- Create: `tests/viewerProjection.test.js`
- Modify: `src/app.js`

**Step 1: Write the failing tests**

Create `tests/viewerProjection.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  clampCameraPitch,
  getNextCameraFromDrag,
  shouldAllowCameraDrag,
} from '../src/viewer/cameraControls.js';
import {
  getCurrentProjection,
  getCurrentStereoLayout,
  normalizeVideoProjection,
  normalizeStereoLayout,
} from '../src/viewer/projection.js';

test('normalizes video projection metadata', () => {
  assert.equal(normalizeVideoProjection('flat'), 'flat');
  assert.equal(normalizeVideoProjection('weird'), 'equirectangular');
});

test('normalizes stereo layout metadata', () => {
  assert.equal(normalizeStereoLayout('top-bottom'), 'top-bottom');
  assert.equal(normalizeStereoLayout('broken'), 'mono');
});

test('resolves projection from controls before metadata fallback', () => {
  assert.equal(
    getCurrentProjection({ controlValue: 'flat', metadataProjection: 'equirectangular' }),
    'flat',
  );
  assert.equal(
    getCurrentStereoLayout({ controlValue: '', metadataStereoLayout: 'top-bottom' }),
    'top-bottom',
  );
});

test('updates camera yaw and clamps pitch from pointer drag', () => {
  assert.deepEqual(
    getNextCameraFromDrag({
      cameraYaw: 0,
      cameraPitch: 0,
      dx: 100,
      dy: -100,
      sensitivity: 0.12,
    }),
    { cameraYaw: -12, cameraPitch: 12 },
  );
  assert.equal(clampCameraPitch(100), 85);
});

test('allows drag for equirectangular viewer only', () => {
  assert.equal(shouldAllowCameraDrag('equirectangular'), true);
  assert.equal(shouldAllowCameraDrag('flat'), false);
});
```

**Step 2: Run test to verify it fails**

Run:

```powershell
node --test tests/viewerProjection.test.js
```

Expected: FAIL because viewer modules do not exist.

**Step 3: Extract implementation**

Move projection helpers from `src/app.js` into `src/viewer/projection.js`:

- `getCurrentProjection`
- `getCurrentStereoLayout`
- metadata normalization logic from `applyVideoMetadataControls`
- `syncSourceVideoMetadataFromControls` pure pieces

Move camera control math into `src/viewer/cameraControls.js`:

```js
import { normalizeYaw } from '../aois/aoiMath.js';

export function clampCameraPitch(value) {
  return Math.min(85, Math.max(-85, value));
}

export function getNextCameraFromDrag({
  cameraYaw,
  cameraPitch,
  dx,
  dy,
  sensitivity = 0.12,
}) {
  return {
    cameraYaw: normalizeYaw(cameraYaw - dx * sensitivity),
    cameraPitch: clampCameraPitch(cameraPitch - dy * sensitivity),
  };
}

export function shouldAllowCameraDrag(projection) {
  return projection !== 'flat';
}
```

In `src/app.js`, keep Three.js object setup and DOM event wiring, but call these pure helpers.

**Step 4: Run tests**

Run:

```powershell
node --test tests/viewerProjection.test.js
npm test
```

Expected: PASS.

**Step 5: Commit**

```powershell
git add src/viewer tests/viewerProjection.test.js src/app.js
git commit -m "refactor: extract viewer projection helpers"
```

---

### Task 12: Thin the Browser Controller and Document the New Boundaries

**Files:**
- Create: `src/app/appController.js`
- Modify: `src/app.js`
- Modify: `README.md`
- Create: `docs/architecture.md`
- Modify: `tests/uiSmoke.mjs`

**Step 1: Write the failing smoke assertion**

In `tests/uiSmoke.mjs`, after the Admin page loads, add a lightweight browser contract check:

```js
assert.equal(
  await page.evaluate(() => Boolean(window.__aoiAppReady)),
  true,
  'App controller should expose a test-only readiness marker after initialization.',
);
```

**Step 2: Run test to verify it fails**

Run with server already running:

```powershell
$env:AOI_PROTOTYPE_URL='http://localhost:5179'; npm run test:ui
```

Expected: FAIL because `window.__aoiAppReady` is not set.

**Step 3: Create app controller boundary**

Move top-level setup from `src/app.js` into `src/app/appController.js`:

```js
export function createAppController({
  document,
  window,
  THREE,
}) {
  // Move existing state setup, DOM lookup, event wiring, and animation setup here.
  // Keep this as orchestration only: call modules for AOI, gaze, recording, and viewer logic.

  return {
    start() {
      // existing initialization side effects
      window.__aoiAppReady = true;
    },
  };
}
```

Reduce `src/app.js` to:

```js
import * as THREE from 'three';
import { createAppController } from './app/appController.js';

createAppController({
  document,
  window,
  THREE,
}).start();
```

Do not force every function out of `appController.js` in this task. The goal is one clear browser entrypoint and enough moved pure code that future feature work has a place to go.

**Step 4: Add architecture documentation**

Create `docs/architecture.md`:

```markdown
# AOI Prototype Architecture

The app is a static browser prototype. `src/app.js` is the entrypoint and delegates to `src/app/appController.js`.

## Domains

- `src/aois`: AOI schema, geometry, projection, import, and detection output conversion.
- `src/gaze`: raw gaze providers, calibration, correction, validation, and quality monitoring.
- `src/recording`: sample construction, export payloads, replay, and analysis metrics.
- `src/viewer`: projection metadata and camera interaction helpers.
- `src/app`: browser orchestration, DOM lookup, initial state, and constants.

## Rule

Pure behavior belongs in domain modules with Node tests. Browser orchestration belongs in the controller and Playwright smoke tests.
```

**Step 5: Run full verification**

Run:

```powershell
npm test
npm run serve
```

In a second shell:

```powershell
$env:AOI_PROTOTYPE_URL='http://localhost:5179'; npm run test:ui
npm run test:webcam
npm run test:calibration-quality
npm run test:runtime-quality
npm run test:runtime-stale
npm run test:validation-age
npm run test:focus-loss
npm run test:stale-gaze
npm run test:failed-validation
```

Expected: all PASS. No browser console errors.

**Step 6: Commit**

```powershell
git add src/app.js src/app/appController.js README.md docs/architecture.md tests/uiSmoke.mjs
git commit -m "refactor: introduce app controller boundary"
```

---

# Phase 2: Eye Tracking Precision and Quality Improvements

## Phase 2 Acceptance Criteria

- Recording stores gaze at `>= 30 Hz` when provider callbacks allow it.
- Exported quality metadata includes sample rate, data integrity, gaze-on-screen percent, dropped-gaze count/rate, validation age, calibration profile, and validation policy.
- Calibration supports `standard`, `research-39`, and `research-78` profiles.
- Research validation policy can target RealEye-like quality gates: mean error near `110 px`, p90 or worst target below `175 px` where feasible, effective sample rate `>= 20 Hz`, and high data integrity.
- Head/face stability or provider quality signals can invalidate or pause recording after drift.
- Fixation metrics use an explicit fixation detector rather than only consecutive AOI dwell.
- A benchmark protocol produces repeatable JSON/Markdown reports so WebGazer limits can be measured before deciding whether to replace it.

---

### Task 13: Add Gaze Stream Telemetry

**Files:**
- Create: `src/gaze/qualityMonitor.js`
- Create: `tests/qualityMonitor.test.js`
- Modify: `src/recording/sampleBuilder.js`
- Modify: `src/recording/recordingExport.js`
- Modify: `src/app/appController.js` or `src/app.js`

**Step 1: Write the failing test**

Create `tests/qualityMonitor.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  summarizeGazeStreamQuality,
  updateGazeStreamStats,
} from '../src/gaze/qualityMonitor.js';

test('tracks sample rate, accepted rate, and dropped reasons', () => {
  let stats = null;

  stats = updateGazeStreamStats(stats, { atMs: 0, accepted: true });
  stats = updateGazeStreamStats(stats, { atMs: 20, accepted: true });
  stats = updateGazeStreamStats(stats, { atMs: 40, accepted: false, reason: 'stale' });
  stats = updateGazeStreamStats(stats, { atMs: 60, accepted: true });

  const summary = summarizeGazeStreamQuality(stats);

  assert.equal(summary.totalEvents, 4);
  assert.equal(summary.acceptedEvents, 3);
  assert.equal(summary.droppedEvents, 1);
  assert.equal(summary.droppedReasons.stale, 1);
  assert.equal(summary.effectiveHz, 50);
  assert.equal(summary.dataIntegrityPercent, 75);
});
```

**Step 2: Run test to verify it fails**

Run:

```powershell
node --test tests/qualityMonitor.test.js
```

Expected: FAIL because module does not exist.

**Step 3: Implement telemetry**

Create `src/gaze/qualityMonitor.js`:

```js
function round(value, digits = 2) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

export function updateGazeStreamStats(previous, event, { maxEvents = 600 } = {}) {
  const events = [
    ...(previous?.events || []),
    {
      atMs: event.atMs,
      accepted: Boolean(event.accepted),
      reason: event.accepted ? null : event.reason || 'rejected',
      onScreen: event.onScreen ?? null,
    },
  ].slice(-maxEvents);

  return { events };
}

export function summarizeGazeStreamQuality(stats) {
  const events = stats?.events || [];
  const acceptedEvents = events.filter((event) => event.accepted).length;
  const droppedEvents = events.length - acceptedEvents;
  const droppedReasons = {};

  events.forEach((event) => {
    if (!event.accepted) {
      droppedReasons[event.reason] = (droppedReasons[event.reason] || 0) + 1;
    }
  });

  const first = events[0]?.atMs;
  const last = events.at(-1)?.atMs;
  const durationSec = Number.isFinite(first) && Number.isFinite(last) && last > first
    ? (last - first) / 1000
    : 0;

  return {
    totalEvents: events.length,
    acceptedEvents,
    droppedEvents,
    droppedReasons,
    effectiveHz: durationSec > 0 ? round((events.length - 1) / durationSec, 2) : 0,
    acceptedHz: durationSec > 0 ? round((acceptedEvents - 1) / durationSec, 2) : 0,
    dataIntegrityPercent: events.length ? round((acceptedEvents / events.length) * 100, 2) : 0,
  };
}
```

Wire provider events and accepted/rejected processing into this telemetry. Add `gazeStreamQuality` to exported summary and per-sample quality.

**Step 4: Run tests**

Run:

```powershell
node --test tests/qualityMonitor.test.js
npm test
```

Expected: PASS.

**Step 5: Commit**

```powershell
git add src/gaze/qualityMonitor.js tests/qualityMonitor.test.js src/recording src/app
git commit -m "feat: add gaze stream quality telemetry"
```

---

### Task 14: Raise Recording Sample Rate Safely

**Files:**
- Create: `src/recording/sampleScheduler.js`
- Create: `tests/sampleScheduler.test.js`
- Modify: `src/app/constants.js`
- Modify: `src/app/appController.js` or `src/app.js`
- Modify: `tests/webcamSmoke.mjs`

**Step 1: Write the failing tests**

Create `tests/sampleScheduler.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createSampleScheduler,
  shouldRecordSample,
} from '../src/recording/sampleScheduler.js';

test('records at 30hz by default', () => {
  const scheduler = createSampleScheduler({ intervalMs: 1000 / 30 });

  assert.equal(shouldRecordSample(scheduler, 0).record, true);
  assert.equal(shouldRecordSample(scheduler, 10).record, false);
  assert.equal(shouldRecordSample(scheduler, 34).record, true);
});

test('skips held webcam gaze samples', () => {
  const scheduler = createSampleScheduler({ intervalMs: 1000 / 30 });

  assert.equal(shouldRecordSample(scheduler, 34, { held: true }).record, false);
});
```

**Step 2: Run test to verify it fails**

Run:

```powershell
node --test tests/sampleScheduler.test.js
```

Expected: FAIL because module does not exist.

**Step 3: Implement scheduler**

Create `src/recording/sampleScheduler.js`:

```js
export function createSampleScheduler({ intervalMs }) {
  return {
    intervalMs,
    lastSampleAt: -Infinity,
  };
}

export function shouldRecordSample(scheduler, now, gaze = {}) {
  if (gaze.held) {
    return { record: false, reason: 'held-gaze' };
  }

  if (now - scheduler.lastSampleAt < scheduler.intervalMs) {
    return { record: false, reason: 'too-soon' };
  }

  scheduler.lastSampleAt = now;
  return { record: true, reason: null };
}
```

Change default:

```js
export const RECORDING_SAMPLE_INTERVAL_MS = 1000 / 30;
```

Update exports to include:

```js
recordingSampleIntervalMs: RECORDING_SAMPLE_INTERVAL_MS,
```

Update `tests/webcamSmoke.mjs` to avoid assuming the old exact interval. Assert sample count is greater than zero and export summary includes the interval.

**Step 4: Run tests**

Run:

```powershell
node --test tests/sampleScheduler.test.js
npm test
npm run test:webcam
```

Expected: PASS.

**Step 5: Commit**

```powershell
git add src/recording/sampleScheduler.js tests/sampleScheduler.test.js src/app/constants.js src/app src/recording tests/webcamSmoke.mjs
git commit -m "feat: record gaze samples at 30hz"
```

---

### Task 15: Add Calibration Profiles for Standard, 39-Point, and 78-Point Modes

**Files:**
- Modify: `src/gaze/calibrationTargets.js`
- Create: `tests/calibrationProfiles.test.js`
- Modify: `index.html`
- Modify: `src/app/dom.js`
- Modify: `src/app/appController.js` or `src/app.js`
- Modify: `tests/uiSmoke.mjs`

**Step 1: Write the failing test**

Create `tests/calibrationProfiles.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildGridCalibrationPoints,
  getCalibrationProfile,
} from '../src/gaze/calibrationTargets.js';

test('builds evenly distributed grid calibration points', () => {
  const points = buildGridCalibrationPoints({
    columns: 7,
    rows: 5,
    minPercent: 10,
    maxPercent: 90,
    includeCenterRepeat: true,
  });

  assert.equal(points.length, 36);
  assert.deepEqual(points[0], { x: 10, y: 10 });
  assert.deepEqual(points.at(-1), { x: 50, y: 50 });
});

test('exposes standard and research calibration profiles', () => {
  assert.equal(getCalibrationProfile('standard').calibrationPoints.length >= 14, true);
  assert.equal(getCalibrationProfile('research-39').calibrationPoints.length, 39);
  assert.equal(getCalibrationProfile('research-78').calibrationPoints.length, 78);
});
```

**Step 2: Run test to verify it fails**

Run:

```powershell
node --test tests/calibrationProfiles.test.js
```

Expected: FAIL because profile functions do not exist.

**Step 3: Implement profiles**

Add to `src/gaze/calibrationTargets.js`:

```js
function interpolatePercent(index, count, minPercent, maxPercent) {
  return count === 1
    ? 50
    : minPercent + ((maxPercent - minPercent) * index) / (count - 1);
}

export function buildGridCalibrationPoints({
  columns,
  rows,
  minPercent = 10,
  maxPercent = 90,
  includeCenterRepeat = false,
}) {
  const points = [];

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      points.push({
        x: Number(interpolatePercent(column, columns, minPercent, maxPercent).toFixed(3)),
        y: Number(interpolatePercent(row, rows, minPercent, maxPercent).toFixed(3)),
      });
    }
  }

  if (includeCenterRepeat) {
    points.push({ x: 50, y: 50 });
  }

  return points;
}

export function getCalibrationProfile(profileId = 'standard') {
  if (profileId === 'research-39') {
    return {
      id: 'research-39',
      label: 'Research 39 point',
      calibrationPoints: buildGridCalibrationPoints({ columns: 7, rows: 5, includeCenterRepeat: true })
        .concat([{ x: 20, y: 50 }, { x: 80, y: 50 }, { x: 50, y: 20 }])
        .slice(0, 39),
    };
  }

  if (profileId === 'research-78') {
    return {
      id: 'research-78',
      label: 'Research 78 point',
      calibrationPoints: [
        ...buildGridCalibrationPoints({ columns: 7, rows: 5, minPercent: 8, maxPercent: 92 }),
        ...buildGridCalibrationPoints({ columns: 7, rows: 5, minPercent: 14, maxPercent: 86 }),
        { x: 50, y: 50 },
        { x: 50, y: 50 },
        { x: 12, y: 50 },
        { x: 88, y: 50 },
        { x: 50, y: 12 },
        { x: 50, y: 88 },
        { x: 25, y: 25 },
        { x: 75, y: 75 },
      ].slice(0, 78),
    };
  }

  return {
    id: 'standard',
    label: 'Standard',
    calibrationPoints: CALIBRATION_POINTS,
  };
}
```

Add UI:

```html
<label class="field-label compact-field">
  <span>Calibration</span>
  <select id="calibrationProfileSelect">
    <option value="standard">Standard</option>
    <option value="research-39">Research 39</option>
    <option value="research-78">Research 78</option>
  </select>
</label>
```

In app code, use `getCalibrationProfile(calibrationProfileSelect.value).calibrationPoints` for calibration mode. Export `calibrationProfile` in recording metadata.

**Step 4: Run tests**

Run:

```powershell
node --test tests/calibrationProfiles.test.js
npm test
$env:AOI_PROTOTYPE_URL='http://localhost:5179'; npm run test:ui
```

Expected: PASS.

**Step 5: Commit**

```powershell
git add src/gaze/calibrationTargets.js tests/calibrationProfiles.test.js index.html src/app src/app.js tests/uiSmoke.mjs
git commit -m "feat: add research calibration profiles"
```

---

### Task 16: Add Research Validation Policies

**Files:**
- Create: `src/gaze/validationPolicy.js`
- Create: `tests/validationPolicy.test.js`
- Modify: `src/gaze/accuracyValidation.js`
- Modify: `index.html`
- Modify: `src/app/appController.js` or `src/app.js`
- Modify: `tests/webcamSmoke.mjs`

**Step 1: Write the failing test**

Create `tests/validationPolicy.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getValidationPolicy,
  passesValidationPolicy,
} from '../src/gaze/validationPolicy.js';

test('exposes prototype and research validation policies', () => {
  assert.equal(getValidationPolicy('prototype').maxMeanPx, 180);
  assert.equal(getValidationPolicy('research').maxMeanPx, 110);
  assert.equal(getValidationPolicy('research').minEffectiveHz, 20);
});

test('checks accuracy and sample-rate gates together', () => {
  assert.equal(passesValidationPolicy({
    summary: { count: 8, meanPx: 100, p90Px: 150, maxPx: 170, p90DispersionPx: 40, maxDispersionPx: 50 },
    streamQuality: { effectiveHz: 30, dataIntegrityPercent: 95 },
    policy: getValidationPolicy('research'),
  }), true);

  assert.equal(passesValidationPolicy({
    summary: { count: 8, meanPx: 130, p90Px: 180, maxPx: 240, p90DispersionPx: 40, maxDispersionPx: 50 },
    streamQuality: { effectiveHz: 30, dataIntegrityPercent: 95 },
    policy: getValidationPolicy('research'),
  }), false);
});
```

**Step 2: Run test to verify it fails**

Run:

```powershell
node --test tests/validationPolicy.test.js
```

Expected: FAIL because module does not exist.

**Step 3: Implement validation policy**

Create `src/gaze/validationPolicy.js`:

```js
const POLICIES = {
  prototype: {
    id: 'prototype',
    maxMeanPx: 180,
    maxP90Px: 260,
    maxSinglePointPx: 360,
    maxP90DispersionPx: 80,
    maxSingleTargetDispersionPx: 100,
    minEffectiveHz: 0,
    minDataIntegrityPercent: 0,
  },
  research: {
    id: 'research',
    maxMeanPx: 110,
    maxP90Px: 175,
    maxSinglePointPx: 220,
    maxP90DispersionPx: 60,
    maxSingleTargetDispersionPx: 80,
    minEffectiveHz: 20,
    minDataIntegrityPercent: 85,
  },
};

export function getValidationPolicy(id = 'prototype') {
  return POLICIES[id] || POLICIES.prototype;
}

export function passesValidationPolicy({ summary, streamQuality, policy }) {
  return (
    Number.isFinite(summary?.meanPx) &&
    summary.meanPx <= policy.maxMeanPx &&
    summary.p90Px <= policy.maxP90Px &&
    summary.maxPx <= policy.maxSinglePointPx &&
    (
      summary.p90DispersionPx === null ||
      summary.p90DispersionPx <= policy.maxP90DispersionPx
    ) &&
    (
      summary.maxDispersionPx === null ||
      summary.maxDispersionPx <= policy.maxSingleTargetDispersionPx
    ) &&
    (streamQuality?.effectiveHz ?? 0) >= policy.minEffectiveHz &&
    (streamQuality?.dataIntegrityPercent ?? 0) >= policy.minDataIntegrityPercent
  );
}
```

Update `accuracyValidation.js` to accept `validationPolicy` and return `policyPassed`, `policyFailures`, and `validationPolicyId`. Keep prototype behavior as default.

Add UI select:

```html
<label class="field-label compact-field">
  <span>Validation policy</span>
  <select id="validationPolicySelect">
    <option value="prototype">Prototype</option>
    <option value="research">Research</option>
  </select>
</label>
```

**Step 4: Run tests**

Run:

```powershell
node --test tests/validationPolicy.test.js
npm test
npm run test:webcam
```

Expected: PASS.

**Step 5: Commit**

```powershell
git add src/gaze/validationPolicy.js tests/validationPolicy.test.js src/gaze/accuracyValidation.js index.html src/app tests/webcamSmoke.mjs
git commit -m "feat: add research validation policy"
```

---

### Task 17: Add Head and Face Stability Quality Signals

**Files:**
- Create: `src/gaze/faceQuality.js`
- Create: `tests/faceQuality.test.js`
- Modify: `src/gaze/providers/webgazerProvider.js`
- Modify: `src/gaze/qualityMonitor.js`
- Modify: `src/app/appController.js` or `src/app.js`
- Modify: `tests/runtimeQualitySmoke.mjs`

**Step 1: Write the failing test**

Create `tests/faceQuality.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  compareFacePoseToBaseline,
  summarizeFaceBox,
} from '../src/gaze/faceQuality.js';

test('summarizes face box center and scale', () => {
  assert.deepEqual(
    summarizeFaceBox({ x: 100, y: 50, width: 200, height: 160 }),
    { centerX: 200, centerY: 130, width: 200, height: 160, area: 32000 },
  );
});

test('detects face drift from calibration baseline', () => {
  const baseline = summarizeFaceBox({ x: 100, y: 50, width: 200, height: 160 });
  const current = summarizeFaceBox({ x: 180, y: 80, width: 160, height: 128 });

  const drift = compareFacePoseToBaseline(current, baseline, {
    maxCenterShiftRatio: 0.2,
    maxScaleChangeRatio: 0.18,
  });

  assert.equal(drift.accepted, false);
  assert.deepEqual(drift.reasons.sort(), ['center-shift', 'scale-change']);
});
```

**Step 2: Run test to verify it fails**

Run:

```powershell
node --test tests/faceQuality.test.js
```

Expected: FAIL because module does not exist.

**Step 3: Implement face quality helpers**

Create `src/gaze/faceQuality.js`:

```js
export function summarizeFaceBox(box) {
  if (
    !Number.isFinite(box?.x) ||
    !Number.isFinite(box?.y) ||
    !Number.isFinite(box?.width) ||
    !Number.isFinite(box?.height) ||
    box.width <= 0 ||
    box.height <= 0
  ) {
    return null;
  }

  return {
    centerX: box.x + box.width / 2,
    centerY: box.y + box.height / 2,
    width: box.width,
    height: box.height,
    area: box.width * box.height,
  };
}

export function compareFacePoseToBaseline(current, baseline, {
  maxCenterShiftRatio = 0.2,
  maxScaleChangeRatio = 0.18,
} = {}) {
  if (!current || !baseline) {
    return { accepted: false, reasons: ['missing-face'] };
  }

  const baselineSize = Math.max(baseline.width, baseline.height);
  const centerShift = Math.hypot(
    current.centerX - baseline.centerX,
    current.centerY - baseline.centerY,
  ) / baselineSize;
  const scaleChange = Math.abs(Math.sqrt(current.area / baseline.area) - 1);
  const reasons = [];

  if (centerShift > maxCenterShiftRatio) {
    reasons.push('center-shift');
  }

  if (scaleChange > maxScaleChangeRatio) {
    reasons.push('scale-change');
  }

  return {
    accepted: reasons.length === 0,
    reasons,
    centerShift,
    scaleChange,
  };
}
```

Provider integration:

- Add optional `onFaceQuality` callback to `createWebGazerProvider(...)`.
- If WebGazer exposes face feedback/face box data through a stable property, use it.
- If no stable WebGazer face API exists, implement this in two stages:
  - Stage A: provider emits `{ available: false, reason: 'provider-no-face-quality' }` and the app records that face quality was unavailable.
  - Stage B: add a direct MediaPipe FaceMesh monitor in a later task if needed.

App behavior:

- Capture baseline face summary at the end of successful accuracy validation.
- During recording, if face drift fails repeatedly, invalidate accuracy with reason `face-pose-drift`.
- Export `faceQualityAvailable`, `faceQualityBaseline`, and `faceQualityInvalidations`.

**Step 4: Run tests**

Run:

```powershell
node --test tests/faceQuality.test.js
npm test
npm run test:runtime-quality
```

Expected: PASS.

**Step 5: Commit**

```powershell
git add src/gaze/faceQuality.js tests/faceQuality.test.js src/gaze/providers/webgazerProvider.js src/gaze/qualityMonitor.js src/app tests/runtimeQualitySmoke.mjs
git commit -m "feat: add face stability quality checks"
```

---

### Task 18: Add Explicit Fixation Detection

**Files:**
- Create: `src/recording/fixations.js`
- Create: `tests/fixations.test.js`
- Modify: `src/recording/analysisMetrics.js`
- Modify: `tests/analysisMetrics.test.js`
- Modify: `README.md`

**Step 1: Write the failing test**

Create `tests/fixations.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import { detectFixationsByDispersion } from '../src/recording/fixations.js';

test('detects fixation clusters by dispersion and duration', () => {
  const samples = [
    { t: 0.00, screen: { x: 100, y: 100 } },
    { t: 0.05, screen: { x: 103, y: 98 } },
    { t: 0.10, screen: { x: 101, y: 102 } },
    { t: 0.15, screen: { x: 105, y: 99 } },
    { t: 0.20, screen: { x: 400, y: 300 } },
  ];

  const fixations = detectFixationsByDispersion(samples, {
    maxDispersionPx: 35,
    minDurationMs: 100,
  });

  assert.equal(fixations.length, 1);
  assert.equal(fixations[0].startSec, 0);
  assert.equal(fixations[0].endSec, 0.15);
  assert.equal(Math.round(fixations[0].centroid.x), 102);
});
```

**Step 2: Run test to verify it fails**

Run:

```powershell
node --test tests/fixations.test.js
```

Expected: FAIL because module does not exist.

**Step 3: Implement I-DT style fixation detection**

Create `src/recording/fixations.js`:

```js
function getPoint(sample) {
  return Number.isFinite(sample?.screen?.x) && Number.isFinite(sample?.screen?.y)
    ? sample.screen
    : null;
}

function dispersion(points) {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);

  return (Math.max(...xs) - Math.min(...xs)) + (Math.max(...ys) - Math.min(...ys));
}

function centroid(points) {
  return {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
  };
}

export function detectFixationsByDispersion(samples, {
  maxDispersionPx = 45,
  minDurationMs = 100,
} = {}) {
  const fixations = [];
  let windowStart = 0;

  while (windowStart < samples.length) {
    let windowEnd = windowStart;
    let points = [];

    while (windowEnd < samples.length) {
      const point = getPoint(samples[windowEnd]);
      if (!point) {
        break;
      }

      const nextPoints = [...points, point];
      if (nextPoints.length > 1 && dispersion(nextPoints) > maxDispersionPx) {
        break;
      }

      points = nextPoints;
      windowEnd += 1;
    }

    if (points.length >= 2) {
      const startSec = samples[windowStart].t;
      const endSec = samples[windowEnd - 1].t;
      if ((endSec - startSec) * 1000 >= minDurationMs) {
        fixations.push({
          startSec,
          endSec,
          durationMs: Math.round((endSec - startSec) * 1000),
          centroid: centroid(points),
          sampleCount: points.length,
        });
      }
    }

    windowStart = Math.max(windowStart + 1, windowEnd);
  }

  return fixations;
}
```

Update `analysisMetrics.js` to use explicit fixation detection when screen samples exist. Keep old AOI-consecutive logic as fallback for legacy exports.

**Step 4: Run tests**

Run:

```powershell
node --test tests/fixations.test.js tests/analysisMetrics.test.js
npm test
```

Expected: PASS.

**Step 5: Commit**

```powershell
git add src/recording/fixations.js tests/fixations.test.js src/recording/analysisMetrics.js tests/analysisMetrics.test.js README.md
git commit -m "feat: add explicit fixation detection"
```

---

### Task 19: Add Benchmark Protocol and Report Generator

**Files:**
- Create: `src/gaze/benchmark.js`
- Create: `tests/benchmark.test.js`
- Create: `docs/eye-tracking-benchmark-protocol.md`
- Modify: `src/recording/recordingExport.js`
- Modify: `README.md`

**Step 1: Write the failing test**

Create `tests/benchmark.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildBenchmarkReport,
  summarizeBenchmarkRuns,
} from '../src/gaze/benchmark.js';

test('summarizes benchmark runs across participants and devices', () => {
  const summary = summarizeBenchmarkRuns([
    {
      participantId: 'P1',
      device: 'laptop',
      accuracy: { meanPx: 100, p90Px: 150, maxPx: 180 },
      streamQuality: { effectiveHz: 30, dataIntegrityPercent: 95 },
    },
    {
      participantId: 'P2',
      device: 'desktop',
      accuracy: { meanPx: 140, p90Px: 210, maxPx: 260 },
      streamQuality: { effectiveHz: 24, dataIntegrityPercent: 88 },
    },
  ]);

  assert.equal(summary.runCount, 2);
  assert.equal(summary.meanAccuracyPx, 120);
  assert.equal(summary.meanEffectiveHz, 27);
});

test('builds markdown report text', () => {
  const report = buildBenchmarkReport({
    summary: { runCount: 1, meanAccuracyPx: 100, meanEffectiveHz: 30 },
    runs: [],
  });

  assert.match(report, /Eye Tracking Benchmark/);
  assert.match(report, /Run count: 1/);
});
```

**Step 2: Run test to verify it fails**

Run:

```powershell
node --test tests/benchmark.test.js
```

Expected: FAIL because benchmark module does not exist.

**Step 3: Implement benchmark helpers**

Create `src/gaze/benchmark.js`:

```js
function mean(values) {
  const finite = values.filter(Number.isFinite);
  return finite.length
    ? Number((finite.reduce((sum, value) => sum + value, 0) / finite.length).toFixed(2))
    : null;
}

export function summarizeBenchmarkRuns(runs) {
  return {
    runCount: runs.length,
    meanAccuracyPx: mean(runs.map((run) => run.accuracy?.meanPx)),
    meanP90Px: mean(runs.map((run) => run.accuracy?.p90Px)),
    meanMaxPx: mean(runs.map((run) => run.accuracy?.maxPx)),
    meanEffectiveHz: mean(runs.map((run) => run.streamQuality?.effectiveHz)),
    meanDataIntegrityPercent: mean(runs.map((run) => run.streamQuality?.dataIntegrityPercent)),
  };
}

export function buildBenchmarkReport({ summary, runs }) {
  const lines = [
    '# Eye Tracking Benchmark',
    '',
    `Run count: ${summary.runCount}`,
    `Mean accuracy: ${summary.meanAccuracyPx ?? 'n/a'} px`,
    `Mean p90: ${summary.meanP90Px ?? 'n/a'} px`,
    `Mean effective Hz: ${summary.meanEffectiveHz ?? 'n/a'}`,
    '',
    '## Runs',
    '',
    '| Participant | Device | Mean px | P90 px | Effective Hz | Integrity % |',
    '| --- | --- | ---: | ---: | ---: | ---: |',
    ...runs.map((run) => (
      `| ${run.participantId || ''} | ${run.device || ''} | ${run.accuracy?.meanPx ?? ''} | ${run.accuracy?.p90Px ?? ''} | ${run.streamQuality?.effectiveHz ?? ''} | ${run.streamQuality?.dataIntegrityPercent ?? ''} |`
    )),
  ];

  return `${lines.join('\n')}\n`;
}
```

Create `docs/eye-tracking-benchmark-protocol.md`:

```markdown
# Eye Tracking Benchmark Protocol

Goal: measure whether the current WebGazer-based pipeline can approach research-grade webcam tracking before replacing the gaze model.

For each run:

1. Use the same browser and app version.
2. Record device, webcam resolution if known, screen size, lighting, glasses, and distance to webcam.
3. Run Standard, Research 39, and Research 78 calibration profiles when time permits.
4. Run accuracy validation immediately after calibration.
5. Record at least 30 seconds of target-following and AOI viewing.
6. Export the recording JSON.

Report:

- mean, median, p90, and max validation error
- effective sample rate
- data integrity percent
- gaze-on-screen percent
- dropped-gaze reasons
- calibration profile
- validation policy
- whether face/head stability was available
```

Add benchmark summary fields to export payload so manual reports can be built from exported JSON.

**Step 4: Run tests**

Run:

```powershell
node --test tests/benchmark.test.js
npm test
```

Expected: PASS.

**Step 5: Commit**

```powershell
git add src/gaze/benchmark.js tests/benchmark.test.js docs/eye-tracking-benchmark-protocol.md src/recording/recordingExport.js README.md
git commit -m "feat: add eye tracking benchmark reporting"
```

---

### Task 20: Add Eye Tracking Quality UI Summary

**Files:**
- Modify: `index.html`
- Modify: `styles.css`
- Modify: `src/app/dom.js`
- Modify: `src/app/appController.js` or `src/app.js`
- Modify: `tests/uiSmoke.mjs`

**Step 1: Write the failing smoke assertions**

In `tests/uiSmoke.mjs`, after Admin mode loads:

```js
await assert.doesNotReject(
  page.locator('#gazeQualityPanel').waitFor({ state: 'visible', timeout: 1000 }),
  'Admin should expose gaze quality summary.',
);
assert.match(
  await page.locator('#gazeQualityPanel').innerText(),
  /Sample rate|Integrity|Validation/,
);
```

**Step 2: Run test to verify it fails**

Run with server running:

```powershell
$env:AOI_PROTOTYPE_URL='http://localhost:5179'; npm run test:ui
```

Expected: FAIL because panel does not exist.

**Step 3: Add UI**

In `index.html`, add inside the calibration or recording panel:

```html
<section id="gazeQualityPanel" class="panel-section gaze-quality-panel">
  <p class="section-label">Gaze quality</p>
  <dl class="quality-grid">
    <div>
      <dt>Sample rate</dt>
      <dd id="gazeSampleRateReadout">--</dd>
    </div>
    <div>
      <dt>Integrity</dt>
      <dd id="gazeIntegrityReadout">--</dd>
    </div>
    <div>
      <dt>Validation</dt>
      <dd id="gazeValidationPolicyReadout">Prototype</dd>
    </div>
    <div>
      <dt>Face stability</dt>
      <dd id="faceStabilityReadout">--</dd>
    </div>
  </dl>
</section>
```

Add restrained CSS matching the current panel style. Do not add explanatory in-app text; use compact labels only.

Update `queryAppDom(...)` and app readout update:

```js
function updateGazeQualityReadout() {
  const summary = summarizeGazeStreamQuality(state.gazeStreamStats);
  gazeSampleRateReadout.textContent = summary.effectiveHz
    ? `${summary.effectiveHz.toFixed(1)} Hz`
    : '--';
  gazeIntegrityReadout.textContent = `${Math.round(summary.dataIntegrityPercent)}%`;
}
```

**Step 4: Run tests**

Run:

```powershell
$env:AOI_PROTOTYPE_URL='http://localhost:5179'; npm run test:ui
```

Expected: PASS.

**Step 5: Commit**

```powershell
git add index.html styles.css src/app/dom.js src/app tests/uiSmoke.mjs
git commit -m "feat: show gaze quality summary"
```

---

### Task 21: Add Provider Replacement Decision Gate

**Files:**
- Create: `docs/provider-replacement-gate.md`
- Create: `src/gaze/providers/providerContract.js`
- Create: `tests/providerContract.test.js`
- Modify: `README.md`

**Step 1: Write the failing test**

Create `tests/providerContract.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assertGazeProviderContract,
  REQUIRED_PROVIDER_METHODS,
} from '../src/gaze/providers/providerContract.js';

test('documents required gaze provider methods', () => {
  assert.deepEqual(REQUIRED_PROVIDER_METHODS, [
    'start',
    'stop',
    'resetCalibration',
    'recordCalibrationPoint',
  ]);
});

test('validates provider contract', () => {
  assert.doesNotThrow(() => assertGazeProviderContract({
    start() {},
    stop() {},
    resetCalibration() {},
    recordCalibrationPoint() {},
  }));

  assert.throws(
    () => assertGazeProviderContract({ start() {} }),
    /Missing gaze provider method/,
  );
});
```

**Step 2: Run test to verify it fails**

Run:

```powershell
node --test tests/providerContract.test.js
```

Expected: FAIL because module does not exist.

**Step 3: Implement provider contract**

Create `src/gaze/providers/providerContract.js`:

```js
export const REQUIRED_PROVIDER_METHODS = [
  'start',
  'stop',
  'resetCalibration',
  'recordCalibrationPoint',
];

export function assertGazeProviderContract(provider) {
  REQUIRED_PROVIDER_METHODS.forEach((method) => {
    if (typeof provider?.[method] !== 'function') {
      throw new Error(`Missing gaze provider method: ${method}`);
    }
  });
}
```

Update WebGazer and mouse provider tests to call `assertGazeProviderContract`.

Create `docs/provider-replacement-gate.md`:

```markdown
# Gaze Provider Replacement Gate

Do not replace WebGazer based on feel. Replace it only after benchmark data shows the surrounding pipeline is no longer the bottleneck.

Replacement is justified if, across at least 20 benchmark runs:

- Research 39 or Research 78 calibration cannot keep mean validation error near 110 px.
- P90 or worst-target error regularly exceeds 175 px under controlled conditions.
- Sample rate and data integrity are healthy, but spatial error remains poor.
- Face/head stability checks pass, but gaze still drifts.

Any replacement provider must implement:

- `start({ onGaze, onQuality })`
- `stop()`
- `resetCalibration()`
- `recordCalibrationPoint({ x, y })`

The rest of the app must not import provider-specific APIs.
```

**Step 4: Run tests**

Run:

```powershell
node --test tests/providerContract.test.js tests/gazeProviders.test.js
npm test
```

Expected: PASS.

**Step 5: Commit**

```powershell
git add src/gaze/providers/providerContract.js tests/providerContract.test.js docs/provider-replacement-gate.md README.md tests/gazeProviders.test.js
git commit -m "docs: define gaze provider replacement gate"
```

---

### Task 22: Final Full Verification

**Files:**
- Modify only if verification exposes failures.

**Step 1: Run unit tests**

Run:

```powershell
npm test
```

Expected: PASS.

**Step 2: Start local server**

Run:

```powershell
npm run serve
```

Expected: server is available at `http://localhost:5179`.

**Step 3: Run browser smoke tests**

In a second shell:

```powershell
$env:AOI_PROTOTYPE_URL='http://localhost:5179'; npm run test:ui
$env:AOI_PROTOTYPE_URL='http://localhost:5179'; npm run test:webcam
$env:AOI_PROTOTYPE_URL='http://localhost:5179'; npm run test:calibration-quality
$env:AOI_PROTOTYPE_URL='http://localhost:5179'; npm run test:runtime-quality
$env:AOI_PROTOTYPE_URL='http://localhost:5179'; npm run test:runtime-stale
$env:AOI_PROTOTYPE_URL='http://localhost:5179'; npm run test:validation-age
$env:AOI_PROTOTYPE_URL='http://localhost:5179'; npm run test:focus-loss
$env:AOI_PROTOTYPE_URL='http://localhost:5179'; npm run test:stale-gaze
$env:AOI_PROTOTYPE_URL='http://localhost:5179'; npm run test:failed-validation
```

Expected: all PASS.

**Step 4: Manual Admin verification**

Open:

```text
http://localhost:5179/?mode=admin
```

Verify:

- Default video renders.
- Existing AOIs render.
- Manual and Colab/generated AOIs still load and export.
- WebGazer controls appear.
- Calibration profile selector works.
- Validation policy selector works.
- Gaze quality panel updates after simulated/real gaze.
- Mouse mode records and exports.
- Review mode replays the exported recording.

**Step 5: Manual Participant verification**

Open:

```text
http://localhost:5179/?mode=participant
```

Verify:

- Metadata and consent gate session start.
- Calibration, accuracy, and recording buttons route to the same improved gaze pipeline.
- Recording is blocked until validation passes.
- Export includes participant metadata and gaze quality fields.

**Step 6: Commit final fixes**

Only if changes were needed:

```powershell
git add <changed-files>
git commit -m "test: verify restructured eye tracking flow"
```

---

## Recommended Execution Order

1. Complete all Phase 1 tasks before starting Phase 2. Phase 2 touches the exact flows Phase 1 separates.
2. Keep compatibility shims during Phase 1. Remove them only after all imports are migrated and tests are stable.
3. In Phase 2, benchmark before replacing WebGazer. The first goal is to remove our bottlenecks: sampling, validation, quality telemetry, and drift handling.
4. If WebGazer remains the accuracy ceiling after benchmark data, use `docs/provider-replacement-gate.md` to plan a new provider without disturbing AOI, recording, or UI modules.

