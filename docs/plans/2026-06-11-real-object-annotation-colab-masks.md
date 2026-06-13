# Real Object Annotation and Colab Masks Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Upgrade AOIs from rectangular boxes to real object annotations with editable polygon edges, intuitive manual drawing/editing, and Google Colab GPU auto-detection that exports SAM mask-derived polygon AOIs.

**Architecture:** Keep the browser app static and backward-compatible with existing box AOIs. Add a shape layer that supports `shape: "box"` and `shape: "polygon"` AOIs in both normalized 2D video space and panorama yaw/pitch space. Use Google Colab for heavy detection/segmentation: Florence-2 or GroundingDINO proposes boxes, SAM 2 turns boxes into object masks, OpenCV converts masks into simplified polygon contours, and the app imports/reviews those polygon keyframes.

**Tech Stack:** Static HTML/CSS/JavaScript, ES modules, Three.js, WebGazer, SVG overlays, Node `node:test`, Playwright, Google Colab, PyTorch CUDA, Florence-2 or GroundingDINO, SAM 2, OpenCV contours.

---

## Current State

- `src/aoiMath.js` supports panorama box AOIs and normalized 2D video box AOIs.
- `src/app.js` renders boxes as SVG polygons and hit-tests box AOIs.
- `index.html` has basic manual AOI controls, but manual AOI creation only adds a centered box.
- `notebooks/google-colab-auto-aoi.ipynb` currently uses Florence-2 detections and exports bounding boxes, not masks or polygons.
- Existing sidecar/export JSON should keep working.

## Target AOI Schema

Keep old box AOIs valid:

```js
{
  id: 'screen-box',
  label: 'Screen',
  color: '#ffd166',
  space: 'video',
  shape: 'box',
  xMin: 0.2,
  xMax: 0.6,
  yMin: 0.1,
  yMax: 0.5,
}
```

Add polygon AOIs for real object edges:

```js
{
  id: 'person',
  label: 'Person',
  color: '#5dd7c8',
  space: 'video',
  shape: 'polygon',
  analysisPaddingPx: 18,
  points: [
    { x: 0.318, y: 0.112 },
    { x: 0.421, y: 0.118 },
    { x: 0.468, y: 0.381 },
    { x: 0.337, y: 0.409 }
  ],
  keyframes: [
    {
      t: 0,
      points: [
        { x: 0.318, y: 0.112 },
        { x: 0.421, y: 0.118 },
        { x: 0.468, y: 0.381 },
        { x: 0.337, y: 0.409 }
      ]
    }
  ],
  generated: {
    method: 'google-colab-florence2-sam2',
    maskAreaRatio: 0.042,
    contourPointsBeforeSimplify: 248,
    lowConfidenceFrames: 0
  }
}
```

For panorama polygons:

```js
{
  id: 'car-panorama',
  label: 'Car',
  color: '#ff8a5c',
  space: 'panorama',
  shape: 'polygon',
  points: [
    { yaw: -18.4, pitch: 8.1 },
    { yaw: -4.7, pitch: 7.9 },
    { yaw: -2.1, pitch: -6.2 },
    { yaw: -20.8, pitch: -5.9 }
  ]
}
```

---

### Task 1: Polygon AOI Geometry Module

**Files:**
- Create: `src/aoiShapes.js`
- Create: `tests/aoiShapes.test.js`
- Modify: `src/aoiMath.js`
- Modify: `tests/aoiMath.test.js`

**Step 1: Write failing polygon geometry tests**

Create `tests/aoiShapes.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  boundsFromPoints,
  distanceToPolygonEdges,
  interpolatePolygonPoints,
  isPointInPolygon,
  normalizePolygonPoints,
  pointHitsPolygonAoi,
} from '../src/aoiShapes.js';

test('detects points inside and outside a polygon', () => {
  const points = [
    { x: 0.2, y: 0.2 },
    { x: 0.6, y: 0.2 },
    { x: 0.5, y: 0.6 },
    { x: 0.25, y: 0.5 },
  ];

  assert.equal(isPointInPolygon({ x: 0.35, y: 0.35 }, points), true);
  assert.equal(isPointInPolygon({ x: 0.8, y: 0.35 }, points), false);
});

test('measures distance to polygon edges in normalized coordinates', () => {
  const points = [
    { x: 0.2, y: 0.2 },
    { x: 0.6, y: 0.2 },
    { x: 0.6, y: 0.6 },
    { x: 0.2, y: 0.6 },
  ];

  assert.equal(distanceToPolygonEdges({ x: 0.4, y: 0.2 }, points), 0);
  assert.equal(Number(distanceToPolygonEdges({ x: 0.4, y: 0.1 }, points).toFixed(3)), 0.1);
});

test('hit tests polygon AOIs with optional analysis padding', () => {
  const aoi = {
    id: 'screen',
    label: 'Screen',
    color: '#ffd166',
    space: 'video',
    shape: 'polygon',
    analysisPadding: 0.03,
    points: [
      { x: 0.2, y: 0.2 },
      { x: 0.6, y: 0.2 },
      { x: 0.6, y: 0.6 },
      { x: 0.2, y: 0.6 },
    ],
  };

  assert.equal(pointHitsPolygonAoi({ x: 0.4, y: 0.4 }, aoi), true);
  assert.equal(pointHitsPolygonAoi({ x: 0.4, y: 0.18 }, aoi), true);
  assert.equal(pointHitsPolygonAoi({ x: 0.4, y: 0.12 }, aoi), false);
});

test('interpolates matching polygon keyframes', () => {
  const points = interpolatePolygonPoints(
    [
      { x: 0.1, y: 0.1 },
      { x: 0.3, y: 0.1 },
      { x: 0.2, y: 0.3 },
    ],
    [
      { x: 0.3, y: 0.3 },
      { x: 0.5, y: 0.3 },
      { x: 0.4, y: 0.5 },
    ],
    0.5,
  );

  assert.deepEqual(points, [
    { x: 0.2, y: 0.2 },
    { x: 0.4, y: 0.2 },
    { x: 0.3, y: 0.4 },
  ]);
});

test('normalizes and bounds polygon points', () => {
  const points = normalizePolygonPoints([
    { x: -0.2, y: 0.2 },
    { x: 1.2, y: 0.3 },
    { x: 0.4, y: 1.4 },
  ]);

  assert.deepEqual(points, [
    { x: 0, y: 0.2 },
    { x: 1, y: 0.3 },
    { x: 0.4, y: 1 },
  ]);
  assert.deepEqual(boundsFromPoints(points), {
    xMin: 0,
    xMax: 1,
    yMin: 0.2,
    yMax: 1,
  });
});
```

**Step 2: Run failing test**

Run:

```powershell
node --test tests/aoiShapes.test.js
```

Expected: FAIL because `src/aoiShapes.js` does not exist.

**Step 3: Implement minimal polygon geometry**

Create `src/aoiShapes.js`:

```js
function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round(value) {
  return Number(value.toFixed(6));
}

function distanceToSegment(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSq = dx * dx + dy * dy;
  const ratio = lengthSq === 0
    ? 0
    : clamp(((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSq, 0, 1);
  const x = start.x + dx * ratio;
  const y = start.y + dy * ratio;
  return Math.hypot(point.x - x, point.y - y);
}

export function normalizePolygonPoints(points, keys = { x: 'x', y: 'y' }) {
  return (points || [])
    .filter((point) => Number.isFinite(point?.[keys.x]) && Number.isFinite(point?.[keys.y]))
    .map((point) => ({
      [keys.x]: round(clamp(point[keys.x], keys.x === 'yaw' ? -180 : 0, keys.x === 'yaw' ? 180 : 1)),
      [keys.y]: round(clamp(point[keys.y], keys.y === 'pitch' ? -90 : 0, keys.y === 'pitch' ? 90 : 1)),
    }));
}

export function boundsFromPoints(points, keys = { x: 'x', y: 'y' }) {
  const xs = points.map((point) => point[keys.x]);
  const ys = points.map((point) => point[keys.y]);
  return {
    [`${keys.x}Min`]: round(Math.min(...xs)),
    [`${keys.x}Max`]: round(Math.max(...xs)),
    [`${keys.y}Min`]: round(Math.min(...ys)),
    [`${keys.y}Max`]: round(Math.max(...ys)),
  };
}

export function isPointInPolygon(point, points) {
  let inside = false;
  for (let index = 0, previous = points.length - 1; index < points.length; previous = index, index += 1) {
    const currentPoint = points[index];
    const previousPoint = points[previous];
    const crosses = (
      currentPoint.y > point.y !== previousPoint.y > point.y &&
      point.x < ((previousPoint.x - currentPoint.x) * (point.y - currentPoint.y)) /
        (previousPoint.y - currentPoint.y || Number.EPSILON) + currentPoint.x
    );
    if (crosses) {
      inside = !inside;
    }
  }
  return inside;
}

export function distanceToPolygonEdges(point, points) {
  if (!points.length) {
    return Infinity;
  }
  return points.reduce((minDistance, start, index) => {
    const end = points[(index + 1) % points.length];
    return Math.min(minDistance, distanceToSegment(point, start, end));
  }, Infinity);
}

export function pointHitsPolygonAoi(point, aoi) {
  const points = aoi.points || [];
  if (points.length < 3) {
    return false;
  }
  if (isPointInPolygon(point, points)) {
    return true;
  }
  return distanceToPolygonEdges(point, points) <= (aoi.analysisPadding || 0);
}

export function interpolatePolygonPoints(startPoints, endPoints, ratio) {
  if (startPoints.length !== endPoints.length) {
    return ratio < 0.5 ? startPoints : endPoints;
  }
  return startPoints.map((start, index) => {
    const end = endPoints[index];
    return {
      x: round(start.x + (end.x - start.x) * ratio),
      y: round(start.y + (end.y - start.y) * ratio),
    };
  });
}
```

**Step 4: Run test**

Run:

```powershell
node --test tests/aoiShapes.test.js
```

Expected: PASS.

**Step 5: Integrate polygon hit testing and interpolation**

Modify `src/aoiMath.js`:

```js
import {
  interpolatePolygonPoints,
  pointHitsPolygonAoi,
} from './aoiShapes.js';
```

Then update `hitTestAois(point, aois)`:

```js
export function hitTestAois(point, aois) {
  return aois.filter((aoi) => {
    if (aoi.shape === 'polygon') {
      return pointHitsPolygonAoi(point, aoi);
    }

    return getAoiSpace(aoi) === 'video'
      ? hitTestVideoAoi(point, aoi)
      : hitTestPanoramaAoi(point, aoi);
  });
}
```

Update dynamic AOI resolving:

```js
if (aoi.shape === 'polygon') {
  return {
    ...aoi,
    points: interpolatePolygonPoints(start.points || [], end.points || [], ratio),
  };
}
```

**Step 6: Add integration test**

Add to `tests/aoiMath.test.js`:

```js
test('hit tests resolved polygon AOIs', () => {
  const [resolved] = resolveAoisAtTime([
    {
      id: 'object',
      label: 'Object',
      color: '#ffd166',
      space: 'video',
      shape: 'polygon',
      points: [
        { x: 0.1, y: 0.1 },
        { x: 0.3, y: 0.1 },
        { x: 0.2, y: 0.3 },
      ],
      keyframes: [
        {
          t: 0,
          points: [
            { x: 0.1, y: 0.1 },
            { x: 0.3, y: 0.1 },
            { x: 0.2, y: 0.3 },
          ],
        },
      ],
    },
  ], 0);

  assert.deepEqual(hitTestAois({ x: 0.2, y: 0.18 }, [resolved]).map((aoi) => aoi.id), ['object']);
});
```

**Step 7: Run tests**

Run:

```powershell
node --test tests/aoiShapes.test.js tests/aoiMath.test.js
```

Expected: PASS.

**Step 8: Commit**

```powershell
git add src/aoiShapes.js src/aoiMath.js tests/aoiShapes.test.js tests/aoiMath.test.js
git commit -m "Add polygon AOI geometry"
```

---

### Task 2: Polygon Rendering, Export, and Import Compatibility

**Files:**
- Modify: `src/app.js`
- Modify: `tests/uiSmoke.mjs`
- Modify: `README.md`

**Step 1: Write failing browser test for imported polygon AOIs**

In `tests/uiSmoke.mjs`, after the existing sidecar load setup, create and load a polygon sidecar:

```js
const polygonSidecarPath = join(tmpDir, 'polygon-video.aoi.json');
await writeFile(polygonSidecarPath, JSON.stringify({
  video: {
    name: 'test-video.mp4',
    projection: 'flat',
    stereoLayout: 'mono',
  },
  aois: [
    {
      id: 'polygon-object',
      label: 'Polygon object',
      color: '#ffd166',
      space: 'video',
      shape: 'polygon',
      points: [
        { x: 0.3, y: 0.2 },
        { x: 0.55, y: 0.24 },
        { x: 0.52, y: 0.5 },
        { x: 0.33, y: 0.46 }
      ],
      keyframes: [
        {
          t: 0,
          points: [
            { x: 0.3, y: 0.2 },
            { x: 0.55, y: 0.24 },
            { x: 0.52, y: 0.5 },
            { x: 0.33, y: 0.46 }
          ]
        }
      ]
    }
  ]
}, null, 2));

await page.locator('#aoiFileInput').setInputFiles(polygonSidecarPath);
await page.waitForFunction(() => document.querySelector('#aoiList')?.textContent?.includes('Polygon object'));
assert.equal(
  await page.locator('#aoiOverlay [data-aoi-id="polygon-object"]').count(),
  1,
  'Imported polygon AOIs should render as object-shaped overlay polygons.',
);
```

**Step 2: Run failing test**

Run:

```powershell
$env:AOI_PROTOTYPE_URL='http://127.0.0.1:5179'; npm run test:ui
```

Expected: FAIL because polygon AOIs are rejected by validation or rendered as boxes.

**Step 3: Accept polygon AOIs in validation**

In `src/app.js`, update validation helpers:

```js
function isValidPolygonPoints(points, space) {
  if (!Array.isArray(points) || points.length < 3) {
    return false;
  }
  return points.every((point) => (
    space === 'panorama'
      ? isFiniteNumber(point.yaw) && isFiniteNumber(point.pitch)
      : isFiniteNumber(point.x) && isFiniteNumber(point.y)
  ));
}

function isValidAoiBounds(aoi, space = getAoiSpace(aoi)) {
  if (aoi.shape === 'polygon') {
    return isValidPolygonPoints(aoi.points, space);
  }
  return space === 'video'
    ? isValidVideoAoiBounds(aoi)
    : isValidPanoramaAoiBounds(aoi);
}
```

For keyframes:

```js
function isValidAoiKeyframes(aoi) {
  if (!Array.isArray(aoi.keyframes)) {
    return true;
  }

  const space = getAoiSpace(aoi);

  return (
    aoi.keyframes.length > 0 &&
    aoi.keyframes.every((keyframe) => (
      isFiniteNumber(keyframe.t) &&
      (aoi.shape === 'polygon'
        ? isValidPolygonPoints(keyframe.points, space)
        : isValidAoiBounds(keyframe, space))
    ))
  );
}
```

**Step 4: Render flat video polygons**

In `src/app.js`, add:

```js
function projectVideoPolygon(aoi, rect) {
  return (aoi.points || []).map((point) => ({
    x: point.x * rect.width,
    y: point.y * rect.height,
  }));
}
```

In `drawAoiOverlay()`, before the video box path:

```js
if (aoi.shape === 'polygon' && aoi.space === 'video') {
  const corners = projectVideoPolygon(aoi, rect);
  appendAoiOverlayPolygon(fragment, aoi, corners, color);
  appendAoiOverlayLabel(fragment, aoi, corners[0]);
  return;
}
```

Extract the repeated SVG code into helpers:

```js
function appendAoiOverlayPolygon(fragment, aoi, points, color) {
  if (!points || points.length < 3) {
    return;
  }

  const shape = document.createElementNS(SVG_NS, 'polygon');
  shape.setAttribute('class', 'aoi-overlay-shape');
  shape.setAttribute('points', points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' '));
  shape.setAttribute('fill', color);
  shape.setAttribute('fill-opacity', '0.16');
  shape.setAttribute('stroke', color);
  shape.dataset.aoiId = aoi.id;
  fragment.appendChild(shape);
}
```

**Step 5: Render panorama polygons**

Add:

```js
function projectPanoramaPolygon(aoi, rect) {
  const points = (aoi.points || []).map((point) => panoramaPointToScreen({
    yaw: point.yaw,
    pitch: point.pitch,
    width: rect.width,
    height: rect.height,
    cameraYaw: state.cameraYaw,
    cameraPitch: state.cameraPitch,
    fov: camera.fov,
  }));

  if (!points.every((point) => point.inFront && Number.isFinite(point.x) && Number.isFinite(point.y))) {
    return null;
  }

  return clipPolygonToRect(points, rect.width, rect.height);
}
```

Then use it in `drawAoiOverlay()`:

```js
if (aoi.shape === 'polygon' && aoi.space !== 'video') {
  const corners = projectPanoramaPolygon(aoi, rect);
  if (corners?.length >= 3) {
    appendAoiOverlayPolygon(fragment, aoi, corners, color);
    appendAoiOverlayLabel(fragment, aoi, corners[0]);
  }
  return;
}
```

**Step 6: Include polygon points in recording samples**

In `maybeSample(now)`, update `activeAois` export mapping:

```js
activeAois: state.latestAois.map((aoi) => ({
  id: aoi.id,
  label: aoi.label,
  color: aoi.color,
  space: aoi.space || 'panorama',
  shape: aoi.shape || 'box',
  yawMin: Number.isFinite(aoi.yawMin) ? Number(aoi.yawMin.toFixed(3)) : null,
  yawMax: Number.isFinite(aoi.yawMax) ? Number(aoi.yawMax.toFixed(3)) : null,
  pitchMin: Number.isFinite(aoi.pitchMin) ? Number(aoi.pitchMin.toFixed(3)) : null,
  pitchMax: Number.isFinite(aoi.pitchMax) ? Number(aoi.pitchMax.toFixed(3)) : null,
  xMin: Number.isFinite(aoi.xMin) ? Number(aoi.xMin.toFixed(6)) : null,
  xMax: Number.isFinite(aoi.xMax) ? Number(aoi.xMax.toFixed(6)) : null,
  yMin: Number.isFinite(aoi.yMin) ? Number(aoi.yMin.toFixed(6)) : null,
  yMax: Number.isFinite(aoi.yMax) ? Number(aoi.yMax.toFixed(6)) : null,
  points: Array.isArray(aoi.points) ? aoi.points : null,
}))
```

**Step 7: Run UI smoke test**

Run:

```powershell
$env:AOI_PROTOTYPE_URL='http://127.0.0.1:5179'; npm run test:ui
```

Expected: PASS.

**Step 8: Commit**

```powershell
git add src/app.js tests/uiSmoke.mjs README.md
git commit -m "Render polygon AOIs"
```

---

### Task 3: Manual Polygon Annotation Mode

**Files:**
- Modify: `index.html`
- Modify: `styles.css`
- Modify: `src/app.js`
- Modify: `tests/uiSmoke.mjs`

**Step 1: Write failing browser test for click-to-draw polygons**

Add to `tests/uiSmoke.mjs` after the admin controls are visible:

```js
await page.locator('#projectionSelect').selectOption('flat');
await page.locator('#manualAoiLabelInput').fill('Drawn object');
await page.locator('#drawPolygonAoiButton').click();
const drawBox = await page.locator('#viewer').boundingBox();

await page.mouse.click(drawBox.x + drawBox.width * 0.35, drawBox.y + drawBox.height * 0.25);
await page.mouse.click(drawBox.x + drawBox.width * 0.55, drawBox.y + drawBox.height * 0.28);
await page.mouse.click(drawBox.x + drawBox.width * 0.50, drawBox.y + drawBox.height * 0.50);
await page.mouse.dblclick(drawBox.x + drawBox.width * 0.32, drawBox.y + drawBox.height * 0.45);

await page.waitForFunction(() => document.querySelector('#aoiList')?.textContent?.includes('Drawn object'));
assert.equal(
  await page.locator('#aoiOverlay [data-aoi-id="drawn-object"]').count(),
  1,
  'Drawn polygon AOIs should appear on the overlay.',
);
```

**Step 2: Run failing test**

Run:

```powershell
$env:AOI_PROTOTYPE_URL='http://127.0.0.1:5179'; npm run test:ui
```

Expected: FAIL because `#drawPolygonAoiButton` and drawing handlers do not exist.

**Step 3: Add manual polygon UI**

Modify the `#manualAoiPanel` section in `index.html`:

```html
<div class="recording-actions">
  <button id="drawPolygonAoiButton" type="button">Draw Polygon</button>
  <button id="finishPolygonAoiButton" type="button" disabled>Finish</button>
  <button id="cancelPolygonAoiButton" type="button" disabled>Cancel</button>
</div>
<p id="manualAoiStatus" class="fine-print">Click Draw Polygon, then click around the object edge. Double-click or press Finish to close.</p>
```

Keep `Add Center AOI` for quick rough AOIs.

**Step 4: Add draft state**

In `src/app.js`, extend `state`:

```js
manualAnnotation: {
  mode: 'idle',
  points: [],
  dragIndex: null,
}
```

Add DOM references:

```js
const drawPolygonAoiButton = document.querySelector('#drawPolygonAoiButton');
const finishPolygonAoiButton = document.querySelector('#finishPolygonAoiButton');
const cancelPolygonAoiButton = document.querySelector('#cancelPolygonAoiButton');
const manualAoiStatus = document.querySelector('#manualAoiStatus');
```

**Step 5: Convert screen clicks to AOI-space points**

Add:

```js
function screenToCurrentAoiPoint(screenPoint) {
  const rect = viewer.getBoundingClientRect();

  if (getCurrentProjection() === 'flat') {
    return {
      x: Number((screenPoint.x / rect.width).toFixed(6)),
      y: Number((screenPoint.y / rect.height).toFixed(6)),
    };
  }

  const panorama = screenPointToYawPitch({
    x: screenPoint.x,
    y: screenPoint.y,
    width: rect.width,
    height: rect.height,
    cameraYaw: state.cameraYaw,
    cameraPitch: state.cameraPitch,
    fov: camera.fov,
  });

  return {
    yaw: Number(panorama.yaw.toFixed(6)),
    pitch: Number(panorama.pitch.toFixed(6)),
  };
}
```

**Step 6: Implement drawing controls**

Add:

```js
function startPolygonAnnotation() {
  state.manualAnnotation = { mode: 'drawing', points: [], dragIndex: null };
  finishPolygonAoiButton.disabled = true;
  cancelPolygonAoiButton.disabled = false;
  aoiOverlay.classList.add('is-authoring');
  manualAoiStatus.textContent = 'Click around the object edge. Double-click to finish.';
}

function cancelPolygonAnnotation() {
  state.manualAnnotation = { mode: 'idle', points: [], dragIndex: null };
  finishPolygonAoiButton.disabled = true;
  cancelPolygonAoiButton.disabled = true;
  aoiOverlay.classList.remove('is-authoring');
  manualAoiStatus.textContent = 'Click Draw Polygon, then click around the object edge.';
  drawAoiOverlay();
}

function addDraftPolygonPoint(event) {
  if (state.manualAnnotation.mode !== 'drawing') {
    return;
  }
  const rect = viewer.getBoundingClientRect();
  const point = screenToCurrentAoiPoint({
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  });
  state.manualAnnotation.points.push(point);
  finishPolygonAoiButton.disabled = state.manualAnnotation.points.length < 3;
  drawAoiOverlay();
}

function finishPolygonAnnotation() {
  if (state.manualAnnotation.points.length < 3) {
    return;
  }
  const label = manualAoiLabelInput.value.trim() || 'Manual polygon AOI';
  const id = createUniqueAoiId(label);
  const space = getCurrentProjection() === 'flat' ? 'video' : 'panorama';
  const aoi = {
    id,
    label,
    color: manualAoiColorInput.value || '#ffd166',
    space,
    shape: 'polygon',
    points: state.manualAnnotation.points,
    keyframes: [
      {
        t: Number((sourceVideo.currentTime || 0).toFixed(3)),
        points: state.manualAnnotation.points,
      },
    ],
  };

  activeAois = [...activeAois, aoi];
  aoiSource = 'manual';
  cancelPolygonAnnotation();
  renderAoiList();
  drawAoiOverlay();
  setNotice(`Added polygon AOI: ${label}`, true);
}
```

**Step 7: Render draft polygon and handles**

In `drawAoiOverlay()`, after rendering active AOIs:

```js
appendDraftPolygon(fragment, rect);
```

Add:

```js
function getDraftScreenPoints(rect) {
  const points = state.manualAnnotation.points || [];

  if (getCurrentProjection() === 'flat') {
    return points.map((point) => ({ x: point.x * rect.width, y: point.y * rect.height }));
  }

  return points
    .map((point) => panoramaPointToScreen({
      yaw: point.yaw,
      pitch: point.pitch,
      width: rect.width,
      height: rect.height,
      cameraYaw: state.cameraYaw,
      cameraPitch: state.cameraPitch,
      fov: camera.fov,
    }))
    .filter((point) => point.visible);
}

function appendDraftPolygon(fragment, rect) {
  if (state.manualAnnotation.mode !== 'drawing') {
    return;
  }
  const points = getDraftScreenPoints(rect);
  appendAoiOverlayPolygon(fragment, { id: 'draft-polygon' }, points, manualAoiColorInput.value || '#ffd166');
  points.forEach((point, index) => {
    const handle = document.createElementNS(SVG_NS, 'circle');
    handle.setAttribute('class', 'aoi-vertex-handle');
    handle.setAttribute('cx', String(point.x));
    handle.setAttribute('cy', String(point.y));
    handle.setAttribute('r', '5');
    handle.dataset.vertexIndex = String(index);
    fragment.appendChild(handle);
  });
}
```

**Step 8: Add drag-to-edit existing vertices**

Implement this after the basic click-to-draw test passes.

Add a selected AOI state:

```js
state.selectedAoiId = null;
state.manualAnnotation.mode = 'editing';
```

Minimum behavior:

- Clicking an AOI in the AOI list selects it.
- Selected polygon renders vertex handles.
- Dragging a handle updates the nearest `points[index]`.
- Changes update the first/current keyframe.

Add a focused test:

```js
const firstHandle = page.locator('#aoiOverlay .aoi-vertex-handle').first();
const before = await firstHandle.boundingBox();
await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
await page.mouse.down();
await page.mouse.move(before.x + 20, before.y + 16);
await page.mouse.up();
const after = await firstHandle.boundingBox();
assert.notEqual(Math.round(after.x), Math.round(before.x));
```

**Step 9: Add CSS**

In `styles.css`:

```css
.aoi-overlay.is-authoring {
  pointer-events: auto;
  cursor: crosshair;
}

.aoi-vertex-handle {
  fill: var(--ink);
  stroke: #0a0b09;
  stroke-width: 2;
  cursor: grab;
}

.aoi-vertex-handle:active {
  cursor: grabbing;
}

.fine-print {
  margin: 8px 0 0;
  color: var(--muted);
  font-size: 0.78rem;
  line-height: 1.35;
}
```

**Step 10: Run smoke test**

Run:

```powershell
$env:AOI_PROTOTYPE_URL='http://127.0.0.1:5179'; npm run test:ui
```

Expected: PASS.

**Step 11: Commit**

```powershell
git add index.html styles.css src/app.js tests/uiSmoke.mjs
git commit -m "Add manual polygon annotation"
```

---

### Task 4: Colab Job Schema for Mask/Polygon Auto Annotation

**Files:**
- Modify: `src/aoiGeneration.js`
- Modify: `tests/aoiGeneration.test.js`
- Modify: `src/app.js`
- Modify: `index.html`

**Step 1: Write failing job schema test**

In `tests/aoiGeneration.test.js`, extend the Colab job test:

```js
assert.equal(job.aoiPolicy.outputShape, 'polygon');
assert.equal(job.aoiPolicy.detectorModel, 'microsoft/Florence-2-base');
assert.equal(job.aoiPolicy.segmenterModel, 'facebook/sam2.1-hiera-small');
assert.equal(job.aoiPolicy.maxPolygonPoints, 80);
assert.equal(job.aoiPolicy.polygonSimplificationEpsilon, 0.003);
```

**Step 2: Run failing test**

Run:

```powershell
node --test tests/aoiGeneration.test.js
```

Expected: FAIL because the job schema does not include segmentation fields.

**Step 3: Extend `buildColabAoiJob`**

In `src/aoiGeneration.js`:

```js
export function buildColabAoiJob({
  video,
  prompts = DEFAULT_AUTO_AOI_PROMPTS,
  sampleIntervalSec = 1,
  outputShape = 'polygon',
  detectorModel = 'microsoft/Florence-2-base',
  segmenterModel = 'facebook/sam2.1-hiera-small',
  maxPolygonPoints = 80,
  polygonSimplificationEpsilon = 0.003,
  analysisPaddingPx = 18,
}) {
  const promptList = parsePromptList(prompts);

  return {
    kind: COLAB_AOI_JOB_KIND,
    version: COLAB_AOI_JOB_VERSION,
    createdAt: new Date().toISOString(),
    video: {
      name: video?.name || null,
      durationSec: Number.isFinite(video?.durationSec) ? video.durationSec : null,
      projection: video?.projection || 'equirectangular',
      stereoLayout: video?.stereoLayout || 'mono',
    },
    aoiPolicy: {
      prompts: promptList.length ? promptList : DEFAULT_AUTO_AOI_PROMPTS,
      sampleIntervalSec: Number.isFinite(Number(sampleIntervalSec))
        ? Math.max(0.1, Number(sampleIntervalSec))
        : 1,
      outputShape,
      detectorModel,
      segmenterModel,
      maxPolygonPoints,
      polygonSimplificationEpsilon,
      analysisPaddingPx,
      recommendedNotebook: 'notebooks/google-colab-auto-aoi.ipynb',
    },
  };
}
```

**Step 4: Add admin controls for polygon quality**

In `index.html`, inside `#cloudAoiPanel`:

```html
<label class="field-label compact-field">
  <span>Max polygon points</span>
  <input id="cloudAoiMaxPointsInput" type="number" min="12" max="240" value="80" />
</label>
<label class="field-label compact-field">
  <span>Edge simplify</span>
  <input id="cloudAoiSimplifyInput" type="number" min="0.001" max="0.02" step="0.001" value="0.003" />
</label>
```

In `src/app.js`, read these fields and pass them to `buildColabAoiJob`.

**Step 5: Run tests**

Run:

```powershell
node --test tests/aoiGeneration.test.js
$env:AOI_PROTOTYPE_URL='http://127.0.0.1:5179'; npm run test:ui
```

Expected: PASS.

**Step 6: Commit**

```powershell
git add src/aoiGeneration.js tests/aoiGeneration.test.js index.html src/app.js tests/uiSmoke.mjs
git commit -m "Describe polygon auto-AOI jobs"
```

---

### Task 5: Mask-to-Polygon Conversion Helpers

**Files:**
- Modify: `src/aoiGeneration.js`
- Modify: `tests/aoiGeneration.test.js`
- Modify: `notebooks/google-colab-auto-aoi.ipynb`

**Step 1: Write JS tests for detection-to-polygon AOI conversion**

Add to `tests/aoiGeneration.test.js`:

```js
test('groups polygon detections into generated AOIs', () => {
  const aois = detectionsToAois({
    detections: [
      {
        label: 'Person',
        t: 0,
        shape: 'polygon',
        points: [
          { x: 0.1, y: 0.1 },
          { x: 0.2, y: 0.1 },
          { x: 0.2, y: 0.3 },
          { x: 0.1, y: 0.3 },
        ],
        confidence: 0.91,
      },
      {
        label: 'Person',
        t: 1,
        shape: 'polygon',
        points: [
          { x: 0.12, y: 0.12 },
          { x: 0.23, y: 0.12 },
          { x: 0.23, y: 0.32 },
          { x: 0.12, y: 0.32 },
        ],
        confidence: 0.88,
      },
    ],
    video: {
      width: 1000,
      height: 500,
      projection: 'flat',
      stereoLayout: 'mono',
    },
  });

  assert.equal(aois[0].shape, 'polygon');
  assert.equal(aois[0].points.length, 4);
  assert.equal(aois[0].keyframes.length, 2);
});
```

**Step 2: Run failing test**

Run:

```powershell
node --test tests/aoiGeneration.test.js
```

Expected: FAIL because `detectionsToAois` only understands boxes.

**Step 3: Update `detectionsToAois`**

In `src/aoiGeneration.js`, when `detection.shape === 'polygon'`:

```js
const keyframe = detection.shape === 'polygon'
  ? {
    t: Number.isFinite(detection.t) ? detection.t : 0,
    points: detection.points,
  }
  : pixelBoxToAoiKeyframe({ ... });
```

Set the output AOI:

```js
shape: detection.shape === 'polygon' ? 'polygon' : 'box',
```

Use the first keyframe:

```js
return {
  ...aoi,
  ...(aoi.shape === 'polygon'
    ? { points: keyframes[0].points }
    : keyframes[0]),
  keyframes,
};
```

**Step 4: Run test**

Run:

```powershell
node --test tests/aoiGeneration.test.js
```

Expected: PASS.

**Step 5: Commit**

```powershell
git add src/aoiGeneration.js tests/aoiGeneration.test.js
git commit -m "Convert polygon detections to AOIs"
```

---

### Task 6: Upgrade the Google Colab Notebook to SAM 2 Masks

**Files:**
- Modify: `notebooks/google-colab-auto-aoi.ipynb`
- Create: `notebooks/README.md`

**Step 1: Update notebook intro**

In `notebooks/google-colab-auto-aoi.ipynb`, update the first markdown cell:

```markdown
# Google Colab Auto-AOI Generator

This notebook produces object-edge polygon AOIs:

1. Florence-2 detects candidate objects/regions from prompts.
2. SAM 2 segments each detected box into an object mask.
3. OpenCV extracts the largest mask contour.
4. `approxPolyDP` simplifies the contour into an editable polygon.
5. The notebook downloads AOI JSON for the browser app.
```

**Step 2: Update dependencies**

Replace the install cell with:

```python
!pip -q install transformers accelerate opencv-python pillow supervision
!pip -q install git+https://github.com/facebookresearch/sam2.git
```

**Step 3: Add SAM 2 model loading**

Add after Florence-2 model loading:

```python
from sam2.build_sam import build_sam2
from sam2.sam2_image_predictor import SAM2ImagePredictor

SAM2_CHECKPOINT_URL = "https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_small.pt"
SAM2_CONFIG = "configs/sam2.1/sam2.1_hiera_s.yaml"
SAM2_CHECKPOINT = "sam2.1_hiera_small.pt"

if not Path(SAM2_CHECKPOINT).exists():
    !wget -q -O sam2.1_hiera_small.pt {SAM2_CHECKPOINT_URL}

sam2_model = build_sam2(SAM2_CONFIG, SAM2_CHECKPOINT, device=DEVICE)
sam_predictor = SAM2ImagePredictor(sam2_model)
```

If the official package/API changes, use the current SAM 2 README and video/image predictor examples as the source of truth.

**Step 4: Convert boxes to masks**

Add:

```python
import numpy as np

def segment_box(image, bbox):
    image_np = np.array(image)
    sam_predictor.set_image(image_np)
    box = np.array(bbox, dtype=np.float32)
    masks, scores, _ = sam_predictor.predict(
        point_coords=None,
        point_labels=None,
        box=box[None, :],
        multimask_output=True,
    )
    best = int(np.argmax(scores))
    return masks[best].astype("uint8"), float(scores[best])
```

**Step 5: Convert masks to simplified polygons**

Add:

```python
def mask_to_polygon(mask, max_points=80, epsilon_ratio=0.003):
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return []
    contour = max(contours, key=cv2.contourArea)
    perimeter = cv2.arcLength(contour, True)
    epsilon = max(1.0, perimeter * epsilon_ratio)
    simplified = cv2.approxPolyDP(contour, epsilon, True).reshape(-1, 2)

    if len(simplified) > max_points:
        stride = math.ceil(len(simplified) / max_points)
        simplified = simplified[::stride]

    return simplified.tolist()
```

**Step 6: Normalize polygon points**

Add:

```python
def normalize_polygon(points, width, height, projection):
    normalized = []
    for x, y in points:
        nx = max(0, min(1, x / width))
        ny = max(0, min(1, y / height))
        if projection == "flat":
            normalized.append({"x": round(nx, 6), "y": round(ny, 6)})
        else:
            normalized.append({
                "yaw": round(normalize_yaw(nx * 360 - 180), 6),
                "pitch": round(90 - ny * 180, 6),
            })
    return normalized
```

**Step 7: Emit polygon detections**

Replace the current `all_detections.extend(detections)` loop:

```python
for detection in detections:
    mask, mask_score = segment_box(image, detection["bbox"])
    polygon = mask_to_polygon(
        mask,
        max_points=int(policy.get("maxPolygonPoints", 80)),
        epsilon_ratio=float(policy.get("polygonSimplificationEpsilon", 0.003)),
    )
    if len(polygon) < 3:
        continue
    detection["t"] = t
    detection["shape"] = "polygon"
    detection["points"] = normalize_polygon(
        polygon,
        image.width,
        image.height,
        projection,
    )
    detection["maskScore"] = mask_score
    detection["contourPoints"] = len(polygon)
    all_detections.append(detection)
```

**Step 8: Build AOIs from polygon detections**

Replace `box_to_keyframe(...)` usage with:

```python
keyframes = [
    {
        "t": det["t"],
        "points": det["points"],
        "maskScore": round(det.get("maskScore", 0), 4),
    }
    for det in track["detections"]
]
```

And output:

```python
aois.append({
    "id": aoi_id,
    "label": track["label"],
    "color": colors[idx % len(colors)],
    "space": "video" if projection == "flat" else "panorama",
    "shape": "polygon",
    "analysisPaddingPx": int(policy.get("analysisPaddingPx", 18)),
    "generated": {
        "method": "google-colab-florence2-sam2",
        "detectorModel": policy.get("detectorModel", MODEL_ID),
        "segmenterModel": policy.get("segmenterModel", "facebook/sam2.1-hiera-small"),
        "sampleIntervalSec": sample_interval,
        "projection": projection,
        "stereoLayout": stereo_layout,
        "frameDetections": len(track["detections"]),
    },
    "points": keyframes[0]["points"],
    "keyframes": keyframes,
})
```

**Step 9: Add notebook README**

Create `notebooks/README.md`:

```markdown
# Auto-AOI Colab Notebook

Use `google-colab-auto-aoi.ipynb` with a free Colab GPU runtime.

Inputs:
- A study video.
- `colab-aoi-job-*.json` exported from Admin mode.

Outputs:
- `generated-colab-aois.json`, importable via `Import Colab AOIs`.

The notebook uses Florence-2 for object boxes and SAM 2 for object masks. It converts masks to editable polygons with OpenCV contours. Generated AOIs are proposals and should be reviewed before participant collection.
```

**Step 10: Manual notebook smoke check**

Open the notebook in Colab and run with a very short video.

Expected:

- Colab uses CUDA if available.
- Notebook downloads `generated-colab-aois.json`.
- The JSON contains AOIs with `shape: "polygon"`.
- Imported polygons render in the local app.

**Step 11: Commit**

```powershell
git add notebooks/google-colab-auto-aoi.ipynb notebooks/README.md
git commit -m "Generate polygon AOIs from Colab masks"
```

---

### Task 7: Polygon Review and Cleanup Tools

**Files:**
- Modify: `index.html`
- Modify: `styles.css`
- Modify: `src/app.js`
- Modify: `tests/uiSmoke.mjs`

**Step 1: Write failing review UI test**

In `tests/uiSmoke.mjs`, after importing a polygon AOI:

```js
await page.locator('[data-aoi-row-id="polygon-object"]').click();
await assert.doesNotReject(
  page.locator('#selectedAoiPanel').waitFor({ state: 'visible', timeout: 1000 }),
  'Selecting an AOI should expose review/edit controls.',
);
await page.locator('#selectedAoiLabelInput').fill('Reviewed object');
await page.locator('#saveSelectedAoiButton').click();
await page.waitForFunction(() => document.querySelector('#aoiList')?.textContent?.includes('Reviewed object'));
```

**Step 2: Run failing test**

Run:

```powershell
$env:AOI_PROTOTYPE_URL='http://127.0.0.1:5179'; npm run test:ui
```

Expected: FAIL because selection/review controls do not exist.

**Step 3: Add selected AOI panel**

In `index.html`, after `#manualAoiPanel`:

```html
<section id="selectedAoiPanel" class="panel-section" hidden>
  <p class="section-label">Selected AOI</p>
  <label class="field-label">
    <span>Label</span>
    <input id="selectedAoiLabelInput" type="text" />
  </label>
  <div class="metadata-grid">
    <label class="field-label compact-field">
      <span>Padding px</span>
      <input id="selectedAoiPaddingInput" type="number" min="0" max="200" value="18" />
    </label>
    <label class="field-label compact-field">
      <span>Color</span>
      <input id="selectedAoiColorInput" type="color" />
    </label>
  </div>
  <div class="recording-actions">
    <button id="saveSelectedAoiButton" type="button">Save</button>
    <button id="deleteSelectedAoiButton" type="button">Delete</button>
  </div>
</section>
```

**Step 4: Make AOI rows selectable**

In `renderAoiList()`:

```js
return `
  <li data-aoi-row-id="${aoi.id}" class="${state.selectedAoiId === aoi.id ? 'is-selected' : ''}">
    ...
  </li>
`;
```

After assigning `innerHTML`, attach listeners:

```js
aoiList.querySelectorAll('[data-aoi-row-id]').forEach((row) => {
  row.addEventListener('click', () => selectAoi(row.dataset.aoiRowId));
});
```

**Step 5: Implement selection/edit/delete**

Add:

```js
function getSelectedAoi() {
  return activeAois.find((aoi) => aoi.id === state.selectedAoiId) || null;
}

function selectAoi(id) {
  state.selectedAoiId = id;
  const aoi = getSelectedAoi();
  selectedAoiPanel.hidden = !aoi;
  if (aoi) {
    selectedAoiLabelInput.value = aoi.label;
    selectedAoiColorInput.value = aoi.color;
    selectedAoiPaddingInput.value = aoi.analysisPaddingPx || 18;
  }
  renderAoiList();
  drawAoiOverlay();
}

function saveSelectedAoi() {
  activeAois = activeAois.map((aoi) => (
    aoi.id === state.selectedAoiId
      ? {
        ...aoi,
        label: selectedAoiLabelInput.value.trim() || aoi.label,
        color: selectedAoiColorInput.value || aoi.color,
        analysisPaddingPx: Number(selectedAoiPaddingInput.value) || 0,
      }
      : aoi
  ));
  renderAoiList();
  drawAoiOverlay();
}

function deleteSelectedAoi() {
  activeAois = activeAois.filter((aoi) => aoi.id !== state.selectedAoiId);
  state.selectedAoiId = null;
  selectedAoiPanel.hidden = true;
  renderAoiList();
  drawAoiOverlay();
}
```

**Step 6: Add duplicate and simplify later**

Do not implement complex simplification in this task. The notebook controls initial simplification. Keep the in-app cleanup minimal: rename, color, padding, delete.

**Step 7: Run smoke test**

Run:

```powershell
$env:AOI_PROTOTYPE_URL='http://127.0.0.1:5179'; npm run test:ui
```

Expected: PASS.

**Step 8: Commit**

```powershell
git add index.html styles.css src/app.js tests/uiSmoke.mjs
git commit -m "Add AOI review controls"
```

---

### Task 8: Export, Metrics, and Backward Compatibility

**Files:**
- Modify: `src/analysisMetrics.js`
- Modify: `tests/analysisMetrics.test.js`
- Modify: `src/app.js`
- Modify: `tests/uiSmoke.mjs`

**Step 1: Add metrics test for polygon AOIs**

In `tests/analysisMetrics.test.js`:

```js
test('builds named metrics for polygon AOIs', () => {
  const aois = [
    {
      id: 'polygon-object',
      label: 'Polygon object',
      shape: 'polygon',
      space: 'video',
      points: [
        { x: 0.2, y: 0.2 },
        { x: 0.5, y: 0.2 },
        { x: 0.4, y: 0.5 },
      ],
    },
  ];
  const samples = [
    { t: 0, hits: ['polygon-object'], likelyHits: ['polygon-object'], possibleHits: [], ambiguousHits: [], activeAois: aois },
    { t: 0.2, hits: ['polygon-object'], likelyHits: ['polygon-object'], possibleHits: [], ambiguousHits: [], activeAois: aois },
  ];

  const metrics = buildNamedAoiMetrics(samples, aois);

  assert.equal(metrics.perAoi['polygon-object'].label, 'Polygon object');
  assert.equal(metrics.perAoi['polygon-object'].hitCount, 2);
});
```

**Step 2: Run test**

Run:

```powershell
node --test tests/analysisMetrics.test.js
```

Expected: PASS already if metrics are ID-based. If it fails, update metrics to avoid assuming box bounds.

**Step 3: Add export smoke assertion**

In `tests/uiSmoke.mjs`, after export:

```js
assert.equal(
  exportedJson.aois.some((aoi) => aoi.shape === 'polygon' && Array.isArray(aoi.points)),
  true,
  'Recording exports should preserve polygon AOI points.',
);
```

**Step 4: Run UI test**

Run:

```powershell
$env:AOI_PROTOTYPE_URL='http://127.0.0.1:5179'; npm run test:ui
```

Expected: PASS.

**Step 5: Commit**

```powershell
git add src/analysisMetrics.js tests/analysisMetrics.test.js src/app.js tests/uiSmoke.mjs
git commit -m "Preserve polygon AOIs in exports"
```

---

### Task 9: Documentation and Verification

**Files:**
- Modify: `README.md`
- Modify: `notebooks/README.md`

**Step 1: Update README**

Add:

```markdown
## Real Object AOIs

The app supports two AOI shapes:

- `box`: fast rectangular AOIs for rough regions.
- `polygon`: object-edge AOIs from manual drawing or Colab segmentation.

Manual polygon annotation:

1. Open Admin mode.
2. Choose `2D flat` or `360 equirectangular`.
3. Click `Draw Polygon`.
4. Click around the visible object edge.
5. Double-click or press `Finish`.
6. Select the AOI row to rename, recolor, adjust padding, or delete.

Google Colab auto annotation:

1. Load the video in Admin mode.
2. Enter prompts such as `person`, `screen`, `sign`, `product`.
3. Export the Colab job JSON.
4. Open `notebooks/google-colab-auto-aoi.ipynb` in Colab with GPU runtime.
5. Upload the video and job JSON.
6. Download `generated-colab-aois.json`.
7. Import it with `Import Colab AOIs`.
8. Review and edit before participant collection.

Generated polygon AOIs are proposals. They may miss objects, merge objects, or produce imperfect edges. Review them before using them for research.
```

**Step 2: Add implementation caveats**

Add:

```markdown
For webcam gaze analysis, exact object-edge polygons may be visually precise but gaze is still noisy. Use `analysisPaddingPx` to expand the effective AOI hit area while preserving the visible object edge for review.
```

**Step 3: Run full verification**

Run:

```powershell
npm test
$env:AOI_PROTOTYPE_URL='http://127.0.0.1:5179'; npm run test:ui
node -e "JSON.parse(require('fs').readFileSync('notebooks/google-colab-auto-aoi.ipynb','utf8')); console.log('notebook-json-ok')"
```

Expected:

- `npm test`: PASS.
- `npm run test:ui`: PASS.
- Notebook JSON parse prints `notebook-json-ok`.

**Step 4: Manual browser verification**

Run:

```powershell
npm run serve
```

Open:

```text
http://localhost:5179/?mode=admin
```

Verify:

- Draw a polygon AOI on a 2D flat video.
- Draw a polygon AOI on a 360 view.
- Select, rename, recolor, and delete polygon AOIs.
- Import a polygon AOI JSON.
- Export a recording JSON and confirm polygon AOIs are preserved.

**Step 5: Manual Colab verification**

In Google Colab:

- Runtime: GPU.
- Open `notebooks/google-colab-auto-aoi.ipynb`.
- Upload a short MP4 and Colab job JSON.
- Run all cells.
- Download generated JSON.
- Import into local Admin mode.
- Confirm object-edge polygons render.

**Step 6: Commit**

```powershell
git add README.md notebooks/README.md
git commit -m "Document polygon AOI workflow"
```

---

## Notes for Executor

- Use @test-driven-development for each task.
- Use @frontend-design for manual annotation UI polish.
- Use @verification-before-completion before reporting done.
- Do not remove existing box AOI support.
- Do not require Colab to run during normal app tests.
- Treat Colab output as proposals, not ground truth.
- Keep raw masks out of the app JSON unless a future task proves they are necessary. Store editable polygons, plus optional mask provenance metadata.

## Source References

- SAM 2 supports promptable image/video segmentation and tracking; use the official README/examples as the notebook API source of truth.
- Florence-2 supports prompt-driven object detection and related vision tasks.
- OpenCV provides contour extraction and polygon approximation helpers (`findContours`, `approxPolyDP`, `pointPolygonTest`).
