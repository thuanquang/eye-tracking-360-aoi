# Merged Heatmap Viewer Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let users load a previously exported `merged-heatmaps` JSON package back into the Admin viewer and see the selected aggregate heatmap as a static overlay on the matching video.

**Architecture:** Keep recording replay and merged heatmap viewing separate. A normal recording JSON still drives samples, replay, AOI stats, and analytics; a merged heatmap JSON drives only a static heatmap overlay, group/type/variant selectors, JSON export, and PNG export. Add pure helpers for merged-package validation and heatmap-bin-to-overlay point conversion, then keep the app controller responsible for DOM state, video selection, and drawing.

**Tech Stack:** Vanilla ESM JavaScript, existing HTML/CSS admin UI, Node `node:test`, Playwright smoke tests, existing heatmap merge/render helpers.

---

## Requirements

- A user can load a final merged JSON from **Xuất JSON heatmap tổng** back into the app.
- Loading a merged JSON should populate the existing merged heatmap group/type/variant selectors.
- The viewer should show the selected merged heatmap as a static overlay.
- If the merged group has a known study-video id, switch the viewer to that study video automatically.
- If the merged group references a local/manual video that cannot be reopened from JSON alone, keep the package loaded and show a Vietnamese notice telling the user to load the matching video.
- Changing group, variant, or type while a merged heatmap is visible should redraw the overlay.
- Existing recording JSON behavior must not change:
  - `Load recording JSON` still loads one participant/session for replay/stats.
  - batch source import still accepts many recording/heatmap JSON files for merging.
- All visible batch heatmap menu/control text must use accented Vietnamese characters.
- The merged heatmap JSON remains a final research artifact; it is not converted into fake samples or fake replay data.

## Current Code Context

- Batch source import lives in `src/app/appController.js`:
  - `loadHeatmapMergeFiles()`
  - `buildMergedHeatmapExport()`
  - `syncMergedHeatmapControls()`
  - `getSelectedMergedHeatmap()`
  - `exportMergedHeatmapJson()`
  - `exportMergedHeatmapImage()`
- The batch UI lives in `index.html` around `#heatmapMergeFileInput`.
- Required DOM selectors are registered in `src/app/dom.js`.
- Heatmap merge helpers live in `src/recording/heatmapMerge.js`.
- PNG export render sizing helpers live in `src/recording/heatmapRender.js`.
- The current live/review heatmap overlay draws from samples in:
  - `drawGazeHeatmapOverlay()`
  - `redrawAnalyticsHeatmapOverlay()`
  - `clearGazeHeatmapOverlay()`
  - `updateHeatmapRuler()`
- CSS currently makes the overlay visible only in `.app-shell.is-analytics-mode`.
- `.app-shell.is-analytics-mode` hides the batch controls, so do not reuse analytics mode for merged heatmap viewing.

## Design Decision

Use a new static overlay mode:

```text
merged heatmap package JSON
  -> validate as kind: "merged-heatmaps"
  -> populate group/variant/type selectors
  -> select one heatmap
  -> convert bins to overlay points
  -> draw onto #gazeHeatmapOverlay
```

Do not use `enterAnalyticsMode()` for merged heatmap viewing. Add a separate app shell class such as `is-merged-heatmap-view` so controls stay visible while the overlay/ruler appears.

---

### Task 0: Create/Confirm Isolated Implementation Workspace

**Files:**
- No code files yet.

**Step 1: Confirm current branch and dirty state**

Run:

```bash
git status --short --branch
git log --oneline --max-count=5
```

Expected:
- Local `main` contains the batch heatmap merge commits.
- There may be unrelated dirty local edits. Do not discard them.

**Step 2: Create a feature worktree**

Run from `C:\Users\Wang\Desktop\eye-tracking-360-aoi`:

```bash
git worktree add .worktrees/merged-heatmap-viewer -b codex/merged-heatmap-viewer
```

Expected:
- New worktree exists at `C:\Users\Wang\Desktop\eye-tracking-360-aoi\.worktrees\merged-heatmap-viewer`.

**Step 3: Install/copy ignored local fixtures if tests require them**

If baseline tests complain about ignored local assets, copy the same ignored fixtures used by the existing main worktree:

```powershell
Copy-Item -LiteralPath ..\assets\replacement-videos -Destination .\assets\replacement-videos -Recurse -Force
Copy-Item -LiteralPath ..\runpod-aoi-upload\jobs -Destination .\runpod-aoi-upload\jobs -Recurse -Force
Copy-Item -LiteralPath ..\runpod-aoi-upload\videos -Destination .\runpod-aoi-upload\videos -Recurse -Force
```

Only do this if the files are missing in the new worktree.

**Step 4: Baseline focused tests**

Run:

```bash
node --test tests/heatmapMerge.test.js tests/heatmapRender.test.js tests/appControllerSource.test.js tests/appDom.test.js tests/responsiveLayout.test.js
```

Expected:
- PASS before making implementation changes.

**Step 5: Commit**

No commit for workspace setup.

---

### Task 1: Add Pure Merged Package Reader and Validator

**Files:**
- Modify: `src/recording/heatmapMerge.js`
- Test: `tests/heatmapMerge.test.js`

**Why:** The controller currently only builds merged packages from source files. It needs a safe way to load an existing `kind: "merged-heatmaps"` package without sending it through `buildMergedHeatmapExport()` again.

**Step 1: Write failing tests**

Add tests near the existing batch merge tests:

```js
test('recognizes valid merged heatmap export packages', () => {
  const mergedPackage = {
    kind: 'merged-heatmaps',
    version: 1,
    exportedAt: '2026-06-27T12:00:00.000Z',
    sourceFileCount: 2,
    groupCount: 1,
    groups: [{
      groupKey: 'clip-a',
      video: { id: 'clip-a', name: 'Clip A.mp4' },
      sourceCount: 2,
      sources: [],
      summary: { heatmaps: { screen: screenHeatmap() } },
    }],
    skipped: [],
  };

  assert.equal(isMergedHeatmapExport(mergedPackage), true);
  assert.deepEqual(normalizeMergedHeatmapExport(mergedPackage), mergedPackage);
});

test('rejects invalid merged heatmap export packages', () => {
  assert.equal(isMergedHeatmapExport({ summary: { heatmaps: {} } }), false);
  assert.throws(
    () => normalizeMergedHeatmapExport({ summary: { heatmaps: {} } }),
    /Invalid merged heatmap export/,
  );
});

test('reads one merged heatmap package file', async () => {
  const payload = {
    kind: 'merged-heatmaps',
    groups: [{
      groupKey: 'clip-a',
      video: { id: 'clip-a' },
      sourceCount: 2,
      summary: { heatmaps: { screen: screenHeatmap() } },
    }],
    skipped: [],
  };
  const file = {
    name: 'merged.json',
    text: async () => JSON.stringify(payload),
  };

  const result = await readMergedHeatmapPackageFile(file);

  assert.equal(result.fileName, 'merged.json');
  assert.equal(result.payload.kind, 'merged-heatmaps');
  assert.equal(result.payload.groupCount, 1);
});
```

Update the import list in `tests/heatmapMerge.test.js`:

```js
import {
  buildMergedHeatmapExport,
  getHeatmapCompatibilityKey,
  getHeatmapVideoKey,
  isMergedHeatmapExport,
  mergeCompatibleHeatmaps,
  normalizeMergedHeatmapExport,
  readHeatmapExportFiles,
  readMergedHeatmapPackageFile,
} from '../src/recording/heatmapMerge.js';
```

**Step 2: Run test to verify failure**

Run:

```bash
node --test tests/heatmapMerge.test.js
```

Expected:
- FAIL because `isMergedHeatmapExport`, `normalizeMergedHeatmapExport`, and `readMergedHeatmapPackageFile` are not exported.

**Step 3: Implement minimal helpers**

Add to `src/recording/heatmapMerge.js` after `readHeatmapExportFiles()`:

```js
export function isMergedHeatmapExport(payload) {
  return (
    isObject(payload) &&
    payload.kind === 'merged-heatmaps' &&
    Array.isArray(payload.groups)
  );
}

export function normalizeMergedHeatmapExport(payload) {
  if (!isMergedHeatmapExport(payload)) {
    throw new Error('Invalid merged heatmap export.');
  }

  const groups = payload.groups.filter((group) => isObject(group?.summary?.heatmaps));

  if (groups.length === 0) {
    throw new Error('Invalid merged heatmap export: no heatmap groups.');
  }

  return {
    ...payload,
    version: Number.isFinite(payload.version) ? payload.version : 1,
    sourceFileCount: Number.isFinite(payload.sourceFileCount) ? payload.sourceFileCount : 0,
    groupCount: groups.length,
    groups,
    skipped: Array.isArray(payload.skipped) ? payload.skipped : [],
  };
}

export async function readMergedHeatmapPackageFile(file) {
  const fileName = file?.name || 'merged-heatmaps.json';
  let payload;

  try {
    payload = JSON.parse(await file.text());
  } catch (error) {
    throw new Error(`Invalid JSON in ${fileName}: ${getMergeErrorMessage(error)}`);
  }

  return {
    fileName,
    payload: normalizeMergedHeatmapExport(payload),
  };
}
```

**Step 4: Run test to verify pass**

Run:

```bash
node --test tests/heatmapMerge.test.js
```

Expected:
- PASS.

**Step 5: Commit**

```bash
git add src/recording/heatmapMerge.js tests/heatmapMerge.test.js
git commit -m "feat: read merged heatmap packages"
```

---

### Task 2: Add Pure Heatmap Bin to Overlay Point Helpers

**Files:**
- Create: `src/recording/heatmapOverlay.js`
- Create: `tests/heatmapOverlay.test.js`

**Why:** The viewer overlay needs points in screen pixels. Screen heatmap bins map directly to viewer dimensions; panorama heatmap bins map to yaw/pitch centers and then project through the existing panorama camera helper.

**Step 1: Write failing tests**

Create `tests/heatmapOverlay.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildMergedHeatmapOverlayPoints,
  getHeatmapBinCenterYawPitch,
} from '../src/recording/heatmapOverlay.js';

test('maps screen heatmap bins to viewer pixel centers', () => {
  const points = buildMergedHeatmapOverlayPoints({
    heatmap: {
      type: 'screen',
      columns: 4,
      rows: 2,
      bins: [{ column: 1, row: 0, weightSec: 0.5, sampleCount: 4 }],
    },
    dimensions: { width: 800, height: 400 },
  });

  assert.deepEqual(points, [{
    x: 300,
    y: 100,
    weightMs: 500,
    intensity: 1,
    sampleCount: 4,
  }]);
});

test('maps panorama heatmap bin centers through the provided projector', () => {
  const centers = [];
  const points = buildMergedHeatmapOverlayPoints({
    heatmap: {
      type: 'panorama',
      columns: 4,
      rows: 2,
      yawRange: [-180, 180],
      pitchRange: [-90, 90],
      bins: [{ column: 2, row: 0, weightSec: 0.25, sampleCount: 3 }],
    },
    dimensions: { width: 800, height: 400 },
    projectPanoramaPoint: ({ yaw, pitch }) => {
      centers.push({ yaw, pitch });
      return { visible: true, x: 500, y: 80 };
    },
  });

  assert.deepEqual(centers, [{ yaw: 45, pitch: 45 }]);
  assert.deepEqual(points, [{
    x: 500,
    y: 80,
    weightMs: 250,
    intensity: 1,
    sampleCount: 3,
  }]);
});

test('filters invisible panorama heatmap bins', () => {
  const points = buildMergedHeatmapOverlayPoints({
    heatmap: {
      type: 'panorama',
      columns: 4,
      rows: 2,
      yawRange: [-180, 180],
      pitchRange: [-90, 90],
      bins: [{ column: 0, row: 0, weightSec: 0.1, sampleCount: 1 }],
    },
    dimensions: { width: 800, height: 400 },
    projectPanoramaPoint: () => ({ visible: false, x: 0, y: 0 }),
  });

  assert.deepEqual(points, []);
});

test('computes panorama bin center yaw and pitch', () => {
  assert.deepEqual(
    getHeatmapBinCenterYawPitch({
      heatmap: {
        columns: 4,
        rows: 2,
        yawRange: [-180, 180],
        pitchRange: [-90, 90],
      },
      bin: { column: 0, row: 1 },
    }),
    { yaw: -135, pitch: -45 },
  );
});
```

**Step 2: Run test to verify failure**

Run:

```bash
node --test tests/heatmapOverlay.test.js
```

Expected:
- FAIL because `src/recording/heatmapOverlay.js` does not exist.

**Step 3: Implement helper**

Create `src/recording/heatmapOverlay.js`:

```js
import { normalizeHeatmapBins } from './heatmapRender.js';

function isPositiveNumber(value) {
  return Number.isFinite(value) && value > 0;
}

function pointInBounds(point, width, height) {
  return (
    Number.isFinite(point?.x) &&
    Number.isFinite(point?.y) &&
    point.x >= 0 &&
    point.y >= 0 &&
    point.x <= width &&
    point.y <= height
  );
}

export function getHeatmapBinCenterYawPitch({ heatmap, bin }) {
  const columns = Number(heatmap?.columns);
  const rows = Number(heatmap?.rows);
  const column = Number(bin?.column);
  const row = Number(bin?.row);
  const yawRange = Array.isArray(heatmap?.yawRange) ? heatmap.yawRange : [-180, 180];
  const pitchRange = Array.isArray(heatmap?.pitchRange) ? heatmap.pitchRange : [-90, 90];
  const yawMin = Number(yawRange[0]);
  const yawMax = Number(yawRange[1]);
  const pitchMin = Number(pitchRange[0]);
  const pitchMax = Number(pitchRange[1]);

  if (
    !isPositiveNumber(columns) ||
    !isPositiveNumber(rows) ||
    !Number.isFinite(column) ||
    !Number.isFinite(row) ||
    !Number.isFinite(yawMin) ||
    !Number.isFinite(yawMax) ||
    !Number.isFinite(pitchMin) ||
    !Number.isFinite(pitchMax)
  ) {
    return null;
  }

  return {
    yaw: yawMin + ((column + 0.5) / columns) * (yawMax - yawMin),
    pitch: pitchMax - ((row + 0.5) / rows) * (pitchMax - pitchMin),
  };
}

function getScreenBinPoint({ heatmap, bin, dimensions }) {
  const columns = Number(heatmap?.columns);
  const rows = Number(heatmap?.rows);
  const column = Number(bin?.column);
  const row = Number(bin?.row);
  const width = Number(dimensions?.width);
  const height = Number(dimensions?.height);

  if (
    !isPositiveNumber(columns) ||
    !isPositiveNumber(rows) ||
    !Number.isFinite(column) ||
    !Number.isFinite(row) ||
    !isPositiveNumber(width) ||
    !isPositiveNumber(height)
  ) {
    return null;
  }

  return {
    x: ((column + 0.5) / columns) * width,
    y: ((row + 0.5) / rows) * height,
  };
}

export function buildMergedHeatmapOverlayPoints({
  heatmap,
  dimensions,
  projectPanoramaPoint = null,
}) {
  const width = Number(dimensions?.width);
  const height = Number(dimensions?.height);

  if (!isPositiveNumber(width) || !isPositiveNumber(height)) {
    return [];
  }

  return normalizeHeatmapBins(heatmap)
    .map((bin) => {
      const weightSec = Number(bin.weightSec);
      if (!Number.isFinite(weightSec) || weightSec <= 0) {
        return null;
      }

      let point = null;

      if (heatmap?.type === 'screen') {
        point = getScreenBinPoint({ heatmap, bin, dimensions });
      } else if (heatmap?.type === 'panorama' && typeof projectPanoramaPoint === 'function') {
        const yawPitch = getHeatmapBinCenterYawPitch({ heatmap, bin });
        const projected = yawPitch ? projectPanoramaPoint(yawPitch) : null;
        point = projected?.visible === true && pointInBounds(projected, width, height)
          ? { x: projected.x, y: projected.y }
          : null;
      }

      return point ? {
        ...point,
        weightMs: weightSec * 1000,
        intensity: Number(bin.intensity) || 0,
        sampleCount: Number.isFinite(bin.sampleCount) ? bin.sampleCount : 0,
      } : null;
    })
    .filter(Boolean);
}
```

**Step 4: Run test to verify pass**

Run:

```bash
node --test tests/heatmapOverlay.test.js
```

Expected:
- PASS.

**Step 5: Commit**

```bash
git add src/recording/heatmapOverlay.js tests/heatmapOverlay.test.js
git commit -m "feat: map merged heatmaps to overlay points"
```

---

### Task 3: Add Accented Vietnamese UI for Source Merge and Merged JSON Viewing

**Files:**
- Modify: `index.html`
- Modify: `src/app/dom.js`
- Modify: `tests/appDom.test.js`
- Modify: `tests/responsiveLayout.test.js`

**Why:** The user needs a clear place to load the final merged JSON. Existing labels are partly unaccented (`Gop`, `Tai`, `Nhom`, `Bien the`, `Loai`, `Xuat`). This task fixes the language and adds the explicit merged-package input.

**Step 1: Write failing DOM tests**

Update required selectors in `tests/appDom.test.js`:

```js
'#mergedHeatmapPackageFileInput',
'#viewMergedHeatmapButton',
'#clearMergedHeatmapViewButton',
```

Add assertions:

```js
assert.equal(dom.mergedHeatmapPackageFileInput.selector, '#mergedHeatmapPackageFileInput');
assert.equal(dom.viewMergedHeatmapButton.selector, '#viewMergedHeatmapButton');
assert.equal(dom.clearMergedHeatmapViewButton.selector, '#clearMergedHeatmapViewButton');
```

Update `tests/responsiveLayout.test.js` batch-panel test to require accented text:

```js
[
  'Gộp heatmap nhiều file',
  'Tải file nguồn để gộp',
  'Tải JSON heatmap tổng để xem lại',
  'Nhóm',
  'Biến thể',
  'Loại',
  'Tin cậy',
  'Có khả năng',
  'Có thể',
  'Toàn cảnh',
  'Màn hình',
  'Xem heatmap tổng',
  'Ẩn heatmap tổng',
  'Xuất JSON heatmap tổng',
  'Xuất ảnh heatmap',
  'Chưa tải JSON heatmap.',
].forEach((label) => {
  assert.match(html, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});
```

Also require selector order:

```js
assert.match(
  html,
  /id="heatmapMergeFileInput"[\s\S]*id="mergedHeatmapPackageFileInput"[\s\S]*id="viewMergedHeatmapButton"[\s\S]*id="clearMergedHeatmapViewButton"/,
);
```

**Step 2: Run tests to verify failure**

Run:

```bash
node --test tests/appDom.test.js tests/responsiveLayout.test.js
```

Expected:
- FAIL for missing new DOM selectors and unaccented labels.

**Step 3: Update `index.html`**

Replace the batch panel with this shape. Keep the same parent location under `#adminRecordingPanel`.

```html
<section class="batch-heatmap-panel" aria-labelledby="batchHeatmapHeading">
  <div class="batch-heatmap-heading">
    <h3 id="batchHeatmapHeading">Gộp heatmap nhiều file</h3>
  </div>
  <label class="file-loader batch-heatmap-loader">
    <span>Tải file nguồn để gộp</span>
    <input id="heatmapMergeFileInput" type="file" accept="application/json,.json" multiple />
  </label>
  <label class="file-loader batch-heatmap-loader">
    <span>Tải JSON heatmap tổng để xem lại</span>
    <input id="mergedHeatmapPackageFileInput" type="file" accept="application/json,.json" />
  </label>
  <div class="batch-heatmap-controls">
    <label class="field-label compact-field">
      <span>Nhóm</span>
      <select id="mergedHeatmapGroupSelect" disabled></select>
    </label>
    <label class="field-label compact-field">
      <span>Biến thể</span>
      <select id="mergedHeatmapVariantSelect" disabled>
        <option value="trusted">Tin cậy</option>
        <option value="likely">Có khả năng</option>
        <option value="possible">Có thể</option>
      </select>
    </label>
    <label class="field-label compact-field">
      <span>Loại</span>
      <select id="mergedHeatmapTypeSelect" disabled>
        <option value="panorama">Toàn cảnh</option>
        <option value="screen">Màn hình</option>
      </select>
    </label>
  </div>
  <div class="batch-heatmap-actions">
    <button id="viewMergedHeatmapButton" type="button" disabled>Xem heatmap tổng</button>
    <button id="clearMergedHeatmapViewButton" type="button" disabled>Ẩn heatmap tổng</button>
    <button id="exportMergedHeatmapJsonButton" type="button" disabled>Xuất JSON heatmap tổng</button>
    <button id="exportMergedHeatmapImageButton" type="button" disabled>Xuất ảnh heatmap</button>
  </div>
  <p id="heatmapMergeStatus" class="fine-print" role="status" aria-live="polite">Chưa tải JSON heatmap.</p>
</section>
```

**Step 4: Update `src/app/dom.js`**

Add:

```js
mergedHeatmapPackageFileInput: getRequiredElement(documentRef, '#mergedHeatmapPackageFileInput'),
viewMergedHeatmapButton: getRequiredElement(documentRef, '#viewMergedHeatmapButton'),
clearMergedHeatmapViewButton: getRequiredElement(documentRef, '#clearMergedHeatmapViewButton'),
```

Place them next to the existing heatmap merge selectors.

**Step 5: Run tests to verify pass**

Run:

```bash
node --test tests/appDom.test.js tests/responsiveLayout.test.js
```

Expected:
- PASS.

**Step 6: Commit**

```bash
git add index.html src/app/dom.js tests/appDom.test.js tests/responsiveLayout.test.js
git commit -m "feat: add merged heatmap viewer controls"
```

---

### Task 4: Wire Controller State for Loading Existing Merged JSON

**Files:**
- Modify: `src/app/appController.js`
- Modify: `tests/appControllerSource.test.js`

**Why:** Loading a merged package should be different from importing source files. Source files are merged; a merged package is validated and displayed.

**Step 1: Write failing source tests**

In `tests/appControllerSource.test.js`, update the merge helper import test:

```js
assert.match(
  controllerSource,
  /import\s+\{[\s\S]*readMergedHeatmapPackageFile[\s\S]*\}\s+from\s+'\.\.\/recording\/heatmapMerge\.js'/,
);
assert.match(
  controllerSource,
  /import\s+\{[\s\S]*buildMergedHeatmapOverlayPoints[\s\S]*\}\s+from\s+'\.\.\/recording\/heatmapOverlay\.js'/,
);
```

Add selector destructure expectations:

```js
'mergedHeatmapPackageFileInput',
'viewMergedHeatmapButton',
'clearMergedHeatmapViewButton',
```

Add a state test:

```js
assert.match(controllerSource, /let\s+activeMergedHeatmapView\s*=\s*null\s*;/);
assert.match(controllerSource, /let\s+mergedHeatmapPackageLoadId\s*=\s*0\s*;/);
```

Add a loader test:

```js
test('merged heatmap package file import validates and loads final packages', () => {
  const loadFunction = controllerSource.match(
    /async\s+function\s+loadMergedHeatmapPackageFile\(event\)[\s\S]*?\n  }\n\n  function resize/,
  )?.[0] || '';

  assert.notEqual(loadFunction, '');
  assert.match(loadFunction, /readMergedHeatmapPackageFile\(file\)/);
  assert.match(loadFunction, /mergedHeatmapExport\s*=\s*payload/);
  assert.match(loadFunction, /syncMergedHeatmapControls\(\)/);
  assert.match(loadFunction, /viewSelectedMergedHeatmap\(\{\s*auto:\s*true\s*\}\)/);
  assert.match(loadFunction, /event\.target\.value\s*=\s*''/);
});
```

Add event listener tests:

```js
assert.match(
  controllerSource,
  /mergedHeatmapPackageFileInput\.addEventListener\('change',\s*loadMergedHeatmapPackageFile\)/,
);
assert.match(
  controllerSource,
  /viewMergedHeatmapButton\.addEventListener\('click',\s*\(\)\s*=>\s*viewSelectedMergedHeatmap\(\)\)/,
);
assert.match(
  controllerSource,
  /clearMergedHeatmapViewButton\.addEventListener\('click',\s*clearMergedHeatmapView\)/,
);
```

**Step 2: Run test to verify failure**

Run:

```bash
node --test tests/appControllerSource.test.js
```

Expected:
- FAIL for missing imports, state, function, and event listeners.

**Step 3: Update imports and DOM destructuring**

In `src/app/appController.js`, update imports:

```js
import {
  buildMergedHeatmapExport,
  readHeatmapExportFiles,
  readMergedHeatmapPackageFile,
} from '../recording/heatmapMerge.js';
import { buildMergedHeatmapOverlayPoints } from '../recording/heatmapOverlay.js';
```

Add state near `mergedHeatmapExport`:

```js
let activeMergedHeatmapView = null;
let mergedHeatmapPackageLoadId = 0;
```

Destructure new DOM nodes:

```js
mergedHeatmapPackageFileInput,
viewMergedHeatmapButton,
clearMergedHeatmapViewButton,
```

**Step 4: Implement `loadMergedHeatmapPackageFile()`**

Place after `loadHeatmapMergeFiles()`:

```js
async function loadMergedHeatmapPackageFile(event) {
  const file = event.target.files?.[0];
  const loadId = ++mergedHeatmapPackageLoadId;

  try {
    if (!file) {
      return;
    }

    const { payload } = await readMergedHeatmapPackageFile(file);

    if (loadId !== mergedHeatmapPackageLoadId) {
      return;
    }

    mergedHeatmapExport = payload;
    syncMergedHeatmapControls();
    setNotice(`Đã tải JSON heatmap tổng: ${payload.groupCount} nhóm.`, true);
    viewSelectedMergedHeatmap({ auto: true });
  } catch (error) {
    if (loadId !== mergedHeatmapPackageLoadId) {
      return;
    }

    clearMergedHeatmapView();
    mergedHeatmapExport = null;
    syncMergedHeatmapControls();
    setNotice(`Không thể tải JSON heatmap tổng: ${error.message}`, true);
  } finally {
    event.target.value = '';
  }
}
```

**Step 5: Update `syncMergedHeatmapControls()`**

Make button state depend on selected heatmap:

```js
const selectedHeatmap = getSelectedMergedHeatmap();
viewMergedHeatmapButton.disabled = !selectedHeatmap;
clearMergedHeatmapViewButton.disabled = !activeMergedHeatmapView;
exportMergedHeatmapImageButton.disabled = !selectedHeatmap;
```

Keep JSON export enabled when any group exists:

```js
exportMergedHeatmapJsonButton.disabled = !hasGroups;
```

Update status strings to accented Vietnamese:

```js
heatmapMergeStatus.textContent = 'Chưa tải JSON heatmap.';
heatmapMergeStatus.textContent = `Đã tải ${mergedHeatmapExport.sourceFileCount} file, ${mergedHeatmapExport.groupCount} nhóm, bỏ qua ${mergedHeatmapExport.skipped.length}.`;
```

If a merged heatmap is currently visible, redraw after selection changes:

```js
if (activeMergedHeatmapView && selectedHeatmap) {
  activeMergedHeatmapView = createMergedHeatmapViewState();
  redrawMergedHeatmapOverlay({ force: true });
}
```

**Step 6: Add event listeners**

Near existing heatmap listeners:

```js
mergedHeatmapPackageFileInput.addEventListener('change', loadMergedHeatmapPackageFile);
viewMergedHeatmapButton.addEventListener('click', () => viewSelectedMergedHeatmap());
clearMergedHeatmapViewButton.addEventListener('click', clearMergedHeatmapView);
```

**Step 7: Run test to verify pass**

Run:

```bash
node --test tests/appControllerSource.test.js
```

Expected:
- PASS.

**Step 8: Commit**

```bash
git add src/app/appController.js tests/appControllerSource.test.js
git commit -m "feat: load merged heatmap json packages"
```

---

### Task 5: Draw Merged Heatmap Packages in the Viewer Overlay

**Files:**
- Modify: `src/app/appController.js`
- Modify: `styles.css`
- Modify: `tests/appControllerSource.test.js`
- Modify: `tests/responsiveLayout.test.js`

**Why:** The merged package should be viewable, not only exportable as PNG.

**Step 1: Write failing tests**

In `tests/appControllerSource.test.js`, add:

```js
test('merged heatmap viewer draws static heatmap overlay without analytics samples', () => {
  assert.match(
    controllerSource,
    /function\s+viewSelectedMergedHeatmap\(\s*\{\s*auto\s*=\s*false\s*\}\s*=\s*\{\}\s*\)/,
  );
  assert.match(controllerSource, /function\s+drawMergedHeatmapOverlay\(/);
  assert.match(controllerSource, /buildMergedHeatmapOverlayPoints\(/);
  assert.match(controllerSource, /appShell\.classList\.add\('is-merged-heatmap-view'\)/);
  assert.doesNotMatch(
    controllerSource.match(/function\s+viewSelectedMergedHeatmap[\s\S]*?\n  }\n/)?.[0] || '',
    /enterAnalyticsMode\(/,
    'Merged heatmap viewing should not enter recording analytics mode.',
  );
});

test('merged heatmap viewer auto-selects matching study video ids', () => {
  assert.match(
    controllerSource,
    /function\s+syncMergedHeatmapVideoContext\(group\)[\s\S]*findStudyVideoById\(group\?\.video\?\.id\)[\s\S]*setStudyVideo\(group\.video\.id,\s*\{\s*clearAois:\s*false\s*\}\)/,
  );
});
```

In `tests/responsiveLayout.test.js`, assert CSS class reveals overlay:

```js
assert.match(css, /\.app-shell\.is-merged-heatmap-view\s+\.gaze-heatmap-overlay/);
assert.match(css, /\.app-shell\.is-merged-heatmap-view\s+\.heatmap-ruler:not\(\[hidden\]\)/);
```

**Step 2: Run tests to verify failure**

Run:

```bash
node --test tests/appControllerSource.test.js tests/responsiveLayout.test.js
```

Expected:
- FAIL because merged overlay view functions and CSS do not exist.

**Step 3: Add merged overlay CSS**

In `styles.css`, extend existing analytics selectors:

```css
.app-shell.is-analytics-mode .gaze-heatmap-overlay,
.app-shell.is-merged-heatmap-view .gaze-heatmap-overlay {
  opacity: 0.78;
}

.app-shell.is-analytics-mode .heatmap-ruler:not([hidden]),
.app-shell.is-merged-heatmap-view .heatmap-ruler:not([hidden]) {
  opacity: 1;
  transform: translateY(0);
}
```

Do not hide admin controls for `is-merged-heatmap-view`.

**Step 4: Refactor overlay drawing points**

Extract the gradient drawing from `drawGazeHeatmapOverlay()` into a reusable helper:

```js
function drawHeatmapPoints(ctx, points, { width, height }) {
  if (!points.length) {
    updateHeatmapRuler();
    return;
  }

  const maxDrawnPoints = 900;
  const stride = Math.max(1, Math.ceil(points.length / maxDrawnPoints));
  const drawnPoints = points.filter((_, index) => index % stride === 0);
  const minWeightMs = Math.min(...drawnPoints.map((point) => point.weightMs));
  const maxWeightMs = Math.max(...drawnPoints.map((point) => point.weightMs), 1);
  const radiusBase = clampNumber(Math.min(width, height) * 0.095, 26, 92);
  updateHeatmapRuler({ minWeightMs, maxWeightMs, pointCount: drawnPoints.length });

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  drawnPoints.forEach((point) => {
    const intensity = clampNumber(point.weightMs / maxWeightMs, 0.18, 1);
    const radius = radiusBase * (0.72 + intensity * 0.42);
    const alpha = 0.1 + intensity * 0.22;
    const gradient = ctx.createRadialGradient(point.x, point.y, 0, point.x, point.y, radius);

    gradient.addColorStop(0, `rgba(255, 255, 255, ${(alpha * 0.96).toFixed(3)})`);
    gradient.addColorStop(0.16, `rgba(255, 24, 16, ${alpha.toFixed(3)})`);
    gradient.addColorStop(0.42, `rgba(255, 210, 28, ${(alpha * 0.76).toFixed(3)})`);
    gradient.addColorStop(0.72, `rgba(0, 220, 255, ${(alpha * 0.38).toFixed(3)})`);
    gradient.addColorStop(1, 'rgba(0, 220, 255, 0)');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.restore();
}
```

Then make `drawGazeHeatmapOverlay()` build sample points and call `drawHeatmapPoints()`.

**Step 5: Add merged view helpers**

Add:

```js
function createMergedHeatmapViewState() {
  const group = getSelectedMergedHeatmapGroup();
  const heatmap = getSelectedMergedHeatmap();

  if (!group || !heatmap) {
    return null;
  }

  return {
    groupKey: group.groupKey,
    variant: mergedHeatmapVariantSelect.value,
    type: mergedHeatmapTypeSelect.value,
    group,
    heatmap,
  };
}

function syncMergedHeatmapVideoContext(group) {
  const matchingStudyVideo = findStudyVideoById(group?.video?.id);

  if (matchingStudyVideo) {
    if (selectedStudyVideo.id !== matchingStudyVideo.id) {
      setStudyVideo(group.video.id, { clearAois: false });
    }
    return true;
  }

  if (group?.video?.projection) {
    applyVideoMetadataControls(group.video);
  }

  return false;
}

function viewSelectedMergedHeatmap({ auto = false } = {}) {
  const viewState = createMergedHeatmapViewState();

  if (!viewState) {
    if (!auto) {
      setNotice('Chọn heatmap tổng hợp lệ để xem.', true);
    }
    return;
  }

  const matchedVideo = syncMergedHeatmapVideoContext(viewState.group);
  activeMergedHeatmapView = viewState;
  appShell.classList.add('is-merged-heatmap-view');
  redrawMergedHeatmapOverlay({ force: true });
  syncMergedHeatmapControls();

  const videoNotice = matchedVideo
    ? ''
    : ' Hãy tải đúng video nền nếu heatmap tổng đến từ video cục bộ.';
  setNotice(`Đã hiển thị heatmap tổng.${videoNotice}`, true);
}

function clearMergedHeatmapView() {
  activeMergedHeatmapView = null;
  appShell.classList.remove('is-merged-heatmap-view');
  clearGazeHeatmapOverlay();
  syncMergedHeatmapControls();
}
```

**Step 6: Add draw and redraw functions**

Add:

```js
function getMergedHeatmapOverlaySignature() {
  const dimensions = getViewerScreenDimensions();

  return [
    activeMergedHeatmapView?.groupKey ?? '',
    activeMergedHeatmapView?.variant ?? '',
    activeMergedHeatmapView?.type ?? '',
    getCurrentProjection(),
    state.cameraYaw.toFixed(3),
    state.cameraPitch.toFixed(3),
    camera.fov.toFixed(3),
    Math.round(dimensions.width),
    Math.round(dimensions.height),
  ].join('|');
}

function drawMergedHeatmapOverlay() {
  const ctx = gazeHeatmapOverlay.getContext('2d');
  if (!ctx || !activeMergedHeatmapView?.heatmap) {
    clearGazeHeatmapOverlay();
    return;
  }

  const dimensions = syncGazeHeatmapOverlaySize();
  const { width, height, pixelRatio } = dimensions;
  ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const points = buildMergedHeatmapOverlayPoints({
    heatmap: activeMergedHeatmapView.heatmap,
    dimensions,
    projectPanoramaPoint: ({ yaw, pitch }) => panoramaPointToScreen({
      yaw,
      pitch,
      width,
      height,
      cameraYaw: state.cameraYaw,
      cameraPitch: state.cameraPitch,
      fov: camera.fov,
    }),
  });

  drawHeatmapPoints(ctx, points, dimensions);
}

function redrawMergedHeatmapOverlay({ force = false } = {}) {
  if (!activeMergedHeatmapView) {
    return;
  }

  const signature = getMergedHeatmapOverlaySignature();
  if (!force && signature === heatmapOverlaySignature) {
    return;
  }

  heatmapOverlaySignature = signature;
  drawMergedHeatmapOverlay();
}

function redrawHeatmapOverlay({ force = false } = {}) {
  if (activeMergedHeatmapView) {
    redrawMergedHeatmapOverlay({ force });
    return;
  }

  redrawAnalyticsHeatmapOverlay({ force });
}
```

Update callers:

```js
// resize()
redrawHeatmapOverlay();

// updateCamera()
redrawHeatmapOverlay();
```

Keep `redrawAnalyticsHeatmapOverlay()` for recording analytics mode.

**Step 7: Make clear/exit paths remove merged mode**

Update `exitAnalyticsMode()` only if needed:

```js
appShell.classList.remove('is-merged-heatmap-view');
```

Update `clearSamples()` or any main reset path so it calls `clearMergedHeatmapView()` only when the user explicitly clears analytics/recording state. Avoid clearing merged package on normal selector changes.

**Step 8: Run tests to verify pass**

Run:

```bash
node --test tests/appControllerSource.test.js tests/responsiveLayout.test.js
```

Expected:
- PASS.

**Step 9: Commit**

```bash
git add src/app/appController.js styles.css tests/appControllerSource.test.js tests/responsiveLayout.test.js
git commit -m "feat: view merged heatmaps in the player"
```

---

### Task 6: Browser Smoke for Load, View, Redraw, and Re-Load

**Files:**
- Modify: `tests/batchHeatmapMergeSmoke.mjs`
- Optional Modify: `package.json` only if a new script is needed. Prefer reusing `test:batch-heatmap-merge`.

**Why:** The browser smoke should prove the real UI can create a merged package, load that package back, and display it on the viewer canvas.

**Step 1: Write failing smoke updates**

After the current JSON export assertions in `tests/batchHeatmapMergeSmoke.mjs`, add:

```js
const mergedHeatmapJsonPath = await mergedHeatmapJsonDownload.path();

await page.locator('#mergedHeatmapPackageFileInput').setInputFiles(mergedHeatmapJsonPath);
await page.waitForFunction(() => (
  document.querySelector('#appShell')?.classList.contains('is-merged-heatmap-view')
));

await page.locator('#mergedHeatmapTypeSelect').selectOption('screen');
await page.locator('#viewMergedHeatmapButton').click();

await page.waitForFunction(() => {
  const canvas = document.querySelector('#gazeHeatmapOverlay');
  const context = canvas?.getContext('2d');
  if (!canvas || !context || canvas.width === 0 || canvas.height === 0) {
    return false;
  }

  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  for (let index = 3; index < pixels.length; index += 4) {
    if (pixels[index] > 0) {
      return true;
    }
  }
  return false;
});

assert.equal(
  await page.locator('#heatmapRuler').isVisible(),
  true,
  'Merged heatmap view should show the heatmap ruler.',
);

await page.locator('#clearMergedHeatmapViewButton').click();
await page.waitForFunction(() => !document.querySelector('#appShell')?.classList.contains('is-merged-heatmap-view'));
```

Also assert the accented labels exist:

```js
await expectText(page, 'Gộp heatmap nhiều file');
await expectText(page, 'Tải JSON heatmap tổng để xem lại');
```

If there is no helper, use direct assertions:

```js
assert.equal(await page.getByText('Gộp heatmap nhiều file').isVisible(), true);
```

**Step 2: Run smoke to verify failure**

Start the dev server:

```bash
npm run serve
```

In another terminal:

```bash
npm run test:batch-heatmap-merge
```

Expected:
- FAIL before implementation, or PASS after prior tasks.

**Step 3: Fix any timing issue**

Use condition-based waits only:

```js
await page.waitForFunction(() => ...)
```

Do not add arbitrary sleeps.

**Step 4: Run smoke to verify pass**

Run:

```bash
npm run test:batch-heatmap-merge
```

Expected:
- PASS with `batch heatmap merge smoke passed`.

**Step 5: Commit**

```bash
git add tests/batchHeatmapMergeSmoke.mjs package.json
git commit -m "test: cover merged heatmap viewer workflow"
```

---

### Task 7: Documentation and User Mental Model

**Files:**
- Modify: `README.md`
- Optional Modify: `docs/eye-tracking-benchmark-protocol.md`

**Why:** The user was confused by recording JSON vs heatmap JSON vs merged heatmap JSON. The docs should make the pipeline obvious.

**Step 1: Write docs update**

Replace the current README batch section with:

```markdown
### Batch Heatmap Merge and Viewing

Use **Recording JSON** as the main research file. It can be loaded in **Tải JSON bản ghi** to replay one participant, and it can also be selected in **Tải file nguồn để gộp** to contribute its `summary.heatmaps` to an aggregate.

Use **Heatmap JSON** only as a smaller merge-only source file. It cannot replay a participant because it does not include the full sample timeline.

Use **Merged heatmap JSON** as the aggregate output from many participants. Load it with **Tải JSON heatmap tổng để xem lại**, then choose **Nhóm**, **Biến thể**, and **Loại**, and click **Xem heatmap tổng**. Export **Xuất ảnh heatmap** for a PNG preview or **Xuất JSON heatmap tổng** for the research artifact.

Recommended workflow:

1. Export one Recording JSON per participant.
2. Select all participant Recording JSON files in **Tải file nguồn để gộp**.
3. Export **JSON heatmap tổng**.
4. Later, reload that merged JSON in **Tải JSON heatmap tổng để xem lại**.
5. Export a PNG only when you need a visual summary.
```

**Step 2: Add exact manual test note**

Add:

```markdown
Test files for local smoke:

- `outputs/batch-heatmap-merge-test/nguyen-hue-360-visible-p1.json`
- `outputs/batch-heatmap-merge-test/nguyen-hue-360-visible-p2.json`
```

Only include these if those files are intended to stay in the repo/workspace. If they are not tracked fixtures, document the smoke command instead:

```markdown
With the dev server running, `npm run test:batch-heatmap-merge` creates temporary compatible inputs and verifies merge, reload, view, JSON export, and PNG export.
```

**Step 3: Run docs-adjacent tests**

Run:

```bash
node --test tests/responsiveLayout.test.js
```

Expected:
- PASS.

**Step 4: Commit**

```bash
git add README.md docs/eye-tracking-benchmark-protocol.md tests/responsiveLayout.test.js
git commit -m "docs: explain merged heatmap viewing"
```

---

### Task 8: Final Verification and Local Package Update

**Files:**
- No source edits unless verification finds bugs.

**Step 1: Run focused tests**

Run:

```bash
node --test tests/heatmapMerge.test.js tests/heatmapOverlay.test.js tests/heatmapRender.test.js tests/appControllerSource.test.js tests/appDom.test.js tests/responsiveLayout.test.js
```

Expected:
- PASS.

**Step 2: Run full unit/source suite**

Run:

```bash
npm test
```

Expected:
- PASS.

**Step 3: Run browser smoke**

Start the server:

```bash
npm run serve
```

In another terminal:

```bash
npm run test:batch-heatmap-merge
```

Expected:
- PASS.

**Step 4: Note existing long UI smoke status**

Run only if desired:

```bash
npm run test:ui
```

Known current risk:
- Before this plan, `test:ui` failed at `tests/uiSmoke.mjs:382` with `Manual drawn polygon AOIs should export vertex points`.
- If it still fails there, report it as pre-existing and rely on the focused batch smoke for this feature.

**Step 5: Request final code review**

Use `superpowers:requesting-code-review`.

Review range:

```bash
git merge-base HEAD main
git rev-parse HEAD
```

Ask reviewer to check:
- Merged heatmap JSON validation.
- Static overlay projection correctness.
- No regression to recording JSON replay/stats.
- Accented Vietnamese UI text.
- Browser smoke coverage.

Fix Critical/Important findings before continuing.

**Step 6: Build local package after merge**

After merging back into local `main`, rebuild:

```bash
npm run build:local
```

Expected outputs:

```text
eye-tracking-360-aoi-local/
eye-tracking-360-aoi-local.zip
```

Verify package contents:

```powershell
rg -n "mergedHeatmapPackageFileInput|is-merged-heatmap-view|Gộp heatmap nhiều file" `
  "eye-tracking-360-aoi-local\app\index.html" `
  "eye-tracking-360-aoi-local\app\src\app\appController.js" `
  "eye-tracking-360-aoi-local\app\styles.css"
```

Expected:
- All patterns found.

**Step 7: Final commit if package artifacts are tracked**

Only commit package artifacts if this repo intentionally tracks them. Otherwise leave generated package updates untracked/ignored.

---

## Acceptance Criteria

- The app has two clearly distinct heatmap inputs:
  - **Tải file nguồn để gộp**: accepts many recording/heatmap source JSON files.
  - **Tải JSON heatmap tổng để xem lại**: accepts one final merged heatmap JSON.
- All batch heatmap controls use accented Vietnamese text.
- Loading a merged package shows at least one group in **Nhóm**.
- Clicking **Xem heatmap tổng** shows the selected heatmap in the viewer.
- The overlay redraws when:
  - selecting a different group,
  - selecting a different variant,
  - selecting `Toàn cảnh` vs `Màn hình`,
  - rotating the 360 camera,
  - resizing the viewer.
- Recording JSON replay still works through **Tải JSON bản ghi**.
- Batch source merging still works through **Tải file nguồn để gộp**.
- `npm run test:batch-heatmap-merge` verifies merge, export, reload merged package, viewer overlay, and PNG export.

## Non-Goals

- Do not convert merged heatmap JSON into fake recording samples.
- Do not add timeline playback for merged heatmaps.
- Do not merge AOI stats, fixation stats, or replay data.
- Do not make Heatmap JSON replace Recording JSON as the main research record.
- Do not implement multi-group comparison in one overlay; one selected group/type/variant is enough.

