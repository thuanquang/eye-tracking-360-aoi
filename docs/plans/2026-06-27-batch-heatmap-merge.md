# Batch Heatmap Merge Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add an admin workflow that imports multiple per-recording heatmap JSON exports, merges compatible heatmap grids, groups incompatible videos separately, and exports a combined heatmap package plus an optional final heatmap image for one selected group.

**Architecture:** Keep the current per-participant heatmap export unchanged. Add pure merge utilities under `src/recording` so compatibility, grouping, and bin summing are testable without the browser. Wire a small admin UI into the existing recording/output panel that reads multiple JSON files, reports whether the files merged into one group or several video groups, then downloads merged JSON and a rendered PNG for the selected compatible group.

**Tech Stack:** Browser ES modules, static HTML/CSS, existing heatmap JSON schema from `summary.heatmaps`, Node `node:test`, existing source/layout smoke tests, canvas PNG download in the browser.

---

## Product Behavior

- Current participant heatmap export stays as-is: one recording exports `summary.heatmaps` JSON.
- Admin mode gets a batch heatmap merge control in `#adminRecordingPanel`.
- Researcher can select many `aoi-heatmap-*.json` files, or full `aoi-samples-*.json` files that include `summary.heatmaps`.
- The app parses all selected files and groups them by normalized video identity.
- Within a group, only compatible grids are merged:
  - same heatmap `type`
  - same `columns` and `rows`
  - screen heatmaps also need same `width` and `height`
  - panorama heatmaps also need same `yawRange` and `pitchRange`
- The merged JSON always preserves separate groups when files are from different videos or incompatible grids.
- The app can export:
  - merged JSON package containing all groups
  - PNG image for the selected group and selected heatmap type/variant
- If 60 files are the same video and grid, the result is one final combined heatmap group.
- If 60 files are different videos, the result is one JSON package with one merged heatmap group per video, and the UI explains that a single overlay image would be misleading.

## Current Integration Points

- `src/recording/heatmapMetrics.js`
  - Current source of heatmap grid shape.
  - Existing bin fields: `column`, `row`, `weightSec`, `sampleCount`.
- `src/recording/recordingExport.js`
  - Current `buildExportSummary()` writes `summary.heatmaps`.
  - Current participant heatmap export already sends the compact `summary.heatmaps` package.
- `src/app/appController.js`
  - Current file import pattern: `loadRecordingFile(event)`.
  - Current download helpers: `downloadText()` and `downloadJson()`.
  - Current participant export function: `exportParticipantHeatmap()`.
  - Current canvas overlay is sample-based and should not be reused as the merge source.
- `src/app/dom.js`
  - Add DOM lookups for merge controls.
- `index.html`
  - Admin recording/output panel already contains export and load-recording controls.
- `styles.css`
  - Reuse existing panel, button, status, and file loader styles.
- Tests:
  - `tests/heatmapMetrics.test.js`
  - `tests/recordingExport.test.js`
  - `tests/appDom.test.js`
  - `tests/responsiveLayout.test.js`
  - `tests/appControllerSource.test.js`
  - `tests/uiSmoke.mjs`

---

## Task 1: Add Pure Heatmap Grid Merge Tests

**Files:**
- Create: `tests/heatmapMerge.test.js`
- Create later: `src/recording/heatmapMerge.js`

**Step 1: Write the failing tests**

Create `tests/heatmapMerge.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getHeatmapCompatibilityKey,
  mergeCompatibleHeatmaps,
} from '../src/recording/heatmapMerge.js';

test('merges compatible screen heatmap bins by row and column', () => {
  const merged = mergeCompatibleHeatmaps([
    {
      type: 'screen',
      columns: 2,
      rows: 2,
      width: 100,
      height: 80,
      dimensionSource: 'provided',
      trustedOnly: true,
      totalWeightSec: 0.5,
      bins: [
        { column: 0, row: 0, weightSec: 0.2, sampleCount: 2 },
        { column: 1, row: 1, weightSec: 0.3, sampleCount: 3 },
      ],
    },
    {
      type: 'screen',
      columns: 2,
      rows: 2,
      width: 100,
      height: 80,
      dimensionSource: 'provided',
      trustedOnly: true,
      totalWeightSec: 0.4,
      bins: [
        { column: 0, row: 0, weightSec: 0.1, sampleCount: 1 },
        { column: 1, row: 0, weightSec: 0.3, sampleCount: 2 },
      ],
    },
  ]);

  assert.equal(merged.type, 'screen');
  assert.equal(merged.sourceHeatmapCount, 2);
  assert.equal(merged.totalWeightSec, 0.9);
  assert.deepEqual(merged.bins, [
    { column: 0, row: 0, weightSec: 0.3, sampleCount: 3 },
    { column: 1, row: 0, weightSec: 0.3, sampleCount: 2 },
    { column: 1, row: 1, weightSec: 0.3, sampleCount: 3 },
  ]);
});

test('merges compatible panorama heatmaps and preserves ranges', () => {
  const merged = mergeCompatibleHeatmaps([
    {
      type: 'panorama',
      columns: 4,
      rows: 2,
      yawRange: [-180, 180],
      pitchRange: [-90, 90],
      trustedOnly: true,
      totalWeightSec: 0.2,
      bins: [{ column: 0, row: 0, weightSec: 0.2, sampleCount: 2 }],
    },
    {
      type: 'panorama',
      columns: 4,
      rows: 2,
      yawRange: [-180, 180],
      pitchRange: [-90, 90],
      trustedOnly: true,
      totalWeightSec: 0.3,
      bins: [{ column: 3, row: 1, weightSec: 0.3, sampleCount: 1 }],
    },
  ]);

  assert.deepEqual(merged.yawRange, [-180, 180]);
  assert.deepEqual(merged.pitchRange, [-90, 90]);
  assert.equal(merged.totalWeightSec, 0.5);
  assert.deepEqual(merged.bins, [
    { column: 0, row: 0, weightSec: 0.2, sampleCount: 2 },
    { column: 3, row: 1, weightSec: 0.3, sampleCount: 1 },
  ]);
});

test('rejects incompatible heatmap grids with an actionable reason', () => {
  assert.throws(
    () => mergeCompatibleHeatmaps([
      {
        type: 'screen',
        columns: 2,
        rows: 2,
        width: 100,
        height: 80,
        bins: [],
      },
      {
        type: 'screen',
        columns: 2,
        rows: 2,
        width: 200,
        height: 80,
        bins: [],
      },
    ]),
    /Incompatible heatmap grids/,
  );
});

test('builds stable compatibility keys', () => {
  assert.equal(
    getHeatmapCompatibilityKey({
      type: 'screen',
      columns: 48,
      rows: 27,
      width: 1280,
      height: 720,
    }),
    'screen|48x27|1280x720',
  );

  assert.equal(
    getHeatmapCompatibilityKey({
      type: 'panorama',
      columns: 72,
      rows: 36,
      yawRange: [-180, 180],
      pitchRange: [-90, 90],
    }),
    'panorama|72x36|-180,180|-90,90',
  );
});
```

**Step 2: Run test to verify it fails**

Run:

```powershell
node --test tests/heatmapMerge.test.js
```

Expected: FAIL with module not found for `src/recording/heatmapMerge.js`.

---

## Task 2: Implement Pure Heatmap Grid Merge

**Files:**
- Create: `src/recording/heatmapMerge.js`
- Test: `tests/heatmapMerge.test.js`

**Step 1: Add the merge utility**

Create `src/recording/heatmapMerge.js`:

```js
function roundNumber(value, digits = 3) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  const rounded = Number(value.toFixed(digits));
  return Object.is(rounded, -0) ? 0 : rounded;
}

function finiteNumber(value) {
  return Number.isFinite(value) ? value : null;
}

function rangeKey(range) {
  return Array.isArray(range) && range.length === 2
    ? `${finiteNumber(range[0])},${finiteNumber(range[1])}`
    : 'null,null';
}

function baseGridKey(heatmap) {
  return `${heatmap?.type}|${heatmap?.columns}x${heatmap?.rows}`;
}

export function getHeatmapCompatibilityKey(heatmap) {
  if (heatmap?.type === 'screen') {
    return `${baseGridKey(heatmap)}|${heatmap.width}x${heatmap.height}`;
  }

  if (heatmap?.type === 'panorama') {
    return `${baseGridKey(heatmap)}|${rangeKey(heatmap.yawRange)}|${rangeKey(heatmap.pitchRange)}`;
  }

  return `${baseGridKey(heatmap)}|unsupported`;
}

function assertMergeable(heatmaps) {
  if (!Array.isArray(heatmaps) || heatmaps.length === 0) {
    throw new Error('No heatmaps to merge.');
  }

  const key = getHeatmapCompatibilityKey(heatmaps[0]);
  const incompatible = heatmaps.find((heatmap) => getHeatmapCompatibilityKey(heatmap) !== key);

  if (incompatible) {
    throw new Error(
      `Incompatible heatmap grids: ${key} vs ${getHeatmapCompatibilityKey(incompatible)}`,
    );
  }
}

function cloneHeatmapMetadata(heatmap) {
  const { bins, totalWeightSec, ...metadata } = heatmap;
  return {
    ...metadata,
    ...(Array.isArray(heatmap.yawRange) ? { yawRange: [...heatmap.yawRange] } : {}),
    ...(Array.isArray(heatmap.pitchRange) ? { pitchRange: [...heatmap.pitchRange] } : {}),
  };
}

export function mergeCompatibleHeatmaps(heatmaps) {
  assertMergeable(heatmaps);

  const mergedBins = new Map();
  let totalWeightSec = 0;

  heatmaps.forEach((heatmap) => {
    totalWeightSec += Number.isFinite(heatmap.totalWeightSec)
      ? heatmap.totalWeightSec
      : 0;

    (Array.isArray(heatmap.bins) ? heatmap.bins : []).forEach((bin) => {
      if (!Number.isFinite(bin?.column) || !Number.isFinite(bin?.row)) {
        return;
      }

      const key = `${bin.row}:${bin.column}`;
      const existing = mergedBins.get(key) || {
        column: bin.column,
        row: bin.row,
        weightSec: 0,
        sampleCount: 0,
      };

      existing.weightSec += Number.isFinite(bin.weightSec) ? bin.weightSec : 0;
      existing.sampleCount += Number.isFinite(bin.sampleCount) ? bin.sampleCount : 0;
      mergedBins.set(key, existing);
    });
  });

  return {
    ...cloneHeatmapMetadata(heatmaps[0]),
    sourceHeatmapCount: heatmaps.length,
    totalWeightSec: roundNumber(totalWeightSec),
    bins: [...mergedBins.values()]
      .sort((a, b) => a.row - b.row || a.column - b.column)
      .map((bin) => ({
        column: bin.column,
        row: bin.row,
        weightSec: roundNumber(bin.weightSec),
        sampleCount: bin.sampleCount,
      })),
  };
}
```

**Step 2: Run the focused tests**

Run:

```powershell
node --test tests/heatmapMerge.test.js
```

Expected: PASS.

**Step 3: Commit**

```powershell
git add src/recording/heatmapMerge.js tests/heatmapMerge.test.js
git commit -m "feat: add heatmap grid merge utilities"
```

---

## Task 3: Add Batch Payload Grouping Tests

**Files:**
- Modify: `tests/heatmapMerge.test.js`
- Modify later: `src/recording/heatmapMerge.js`

**Step 1: Write failing tests for export payload merging**

Append tests:

```js
import {
  buildMergedHeatmapExport,
  getHeatmapVideoKey,
} from '../src/recording/heatmapMerge.js';

test('groups selected heatmap exports by video and merges compatible variants', () => {
  const first = {
    exportedAt: '2026-06-27T01:00:00.000Z',
    participant: { id: 'p01' },
    video: { name: 'clip-a.mp4', src: 'assets/clips/clip-a.mp4', projection: 'flat' },
    summary: {
      heatmaps: {
        screen: {
          type: 'screen',
          columns: 2,
          rows: 2,
          width: 100,
          height: 80,
          totalWeightSec: 0.2,
          bins: [{ column: 0, row: 0, weightSec: 0.2, sampleCount: 2 }],
        },
        variants: {
          trusted: {
            screen: {
              type: 'screen',
              columns: 2,
              rows: 2,
              width: 100,
              height: 80,
              totalWeightSec: 0.2,
              bins: [{ column: 0, row: 0, weightSec: 0.2, sampleCount: 2 }],
            },
          },
        },
      },
    },
  };
  const second = {
    ...first,
    exportedAt: '2026-06-27T01:05:00.000Z',
    participant: { id: 'p02' },
    summary: {
      heatmaps: {
        screen: {
          type: 'screen',
          columns: 2,
          rows: 2,
          width: 100,
          height: 80,
          totalWeightSec: 0.3,
          bins: [{ column: 1, row: 0, weightSec: 0.3, sampleCount: 1 }],
        },
        variants: {
          trusted: {
            screen: {
              type: 'screen',
              columns: 2,
              rows: 2,
              width: 100,
              height: 80,
              totalWeightSec: 0.3,
              bins: [{ column: 1, row: 0, weightSec: 0.3, sampleCount: 1 }],
            },
          },
        },
      },
    },
  };

  const merged = buildMergedHeatmapExport([
    { fileName: 'p01.json', payload: first },
    { fileName: 'p02.json', payload: second },
  ], { exportedAt: '2026-06-27T02:00:00.000Z' });

  assert.equal(merged.kind, 'merged-heatmaps');
  assert.equal(merged.sourceFileCount, 2);
  assert.equal(merged.groupCount, 1);
  assert.equal(merged.groups[0].sourceCount, 2);
  assert.equal(merged.groups[0].summary.heatmaps.screen.totalWeightSec, 0.5);
  assert.deepEqual(merged.groups[0].summary.heatmaps.screen.bins, [
    { column: 0, row: 0, weightSec: 0.2, sampleCount: 2 },
    { column: 1, row: 0, weightSec: 0.3, sampleCount: 1 },
  ]);
  assert.equal(merged.skipped.length, 0);
});

test('keeps different videos in separate merged groups', () => {
  const makePayload = (name) => ({
    video: { name, src: `assets/${name}` },
    summary: {
      heatmaps: {
        panorama: {
          type: 'panorama',
          columns: 4,
          rows: 2,
          yawRange: [-180, 180],
          pitchRange: [-90, 90],
          totalWeightSec: 0.1,
          bins: [{ column: 0, row: 0, weightSec: 0.1, sampleCount: 1 }],
        },
      },
    },
  });

  const merged = buildMergedHeatmapExport([
    { fileName: 'a.json', payload: makePayload('a.mp4') },
    { fileName: 'b.json', payload: makePayload('b.mp4') },
  ]);

  assert.equal(merged.groupCount, 2);
  assert.deepEqual(merged.groups.map((group) => group.video.name), ['a.mp4', 'b.mp4']);
});

test('skips files with missing heatmaps and reports why', () => {
  const merged = buildMergedHeatmapExport([
    { fileName: 'bad.json', payload: { summary: {} } },
  ]);

  assert.equal(merged.groupCount, 0);
  assert.deepEqual(merged.skipped, [
    { fileName: 'bad.json', reason: 'missing-summary-heatmaps' },
  ]);
});

test('builds stable video keys from video metadata', () => {
  assert.equal(
    getHeatmapVideoKey({ video: { name: 'Clip A.mp4', src: 'assets/clips/a.mp4' } }),
    'clip-a-mp4|assets-clips-a-mp4',
  );
});
```

**Step 2: Run the focused tests**

Run:

```powershell
node --test tests/heatmapMerge.test.js
```

Expected: FAIL because payload grouping functions are not implemented yet.

---

## Task 4: Implement Batch Payload Grouping

**Files:**
- Modify: `src/recording/heatmapMerge.js`
- Test: `tests/heatmapMerge.test.js`

**Step 1: Add export payload helpers**

Add to `src/recording/heatmapMerge.js`:

```js
function slug(value, fallback = 'unknown') {
  const normalized = String(value ?? '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();

  return normalized || fallback;
}

function getHeatmaps(payload) {
  return payload?.summary?.heatmaps ?? null;
}

function participantId(payload) {
  return payload?.participant?.id
    ?? payload?.participant?.participantId
    ?? payload?.participantId
    ?? null;
}

export function getHeatmapVideoKey(payload) {
  const video = payload?.video ?? payload?.project?.video ?? {};
  return `${slug(video.name)}|${slug(video.src ?? video.id ?? video.path)}`;
}

function collectSource(entry) {
  return {
    fileName: entry.fileName ?? null,
    exportedAt: entry.payload?.exportedAt ?? null,
    participantId: participantId(entry.payload),
  };
}

function mergeNamedHeatmap(entries, getHeatmap) {
  const heatmaps = entries
    .map((entry) => getHeatmap(getHeatmaps(entry.payload)))
    .filter(Boolean);

  if (!heatmaps.length) {
    return null;
  }

  return mergeCompatibleHeatmaps(heatmaps);
}

function mergeHeatmapSet(entries) {
  const heatmaps = {};
  const topLevelNames = ['screen', 'panorama'];

  topLevelNames.forEach((name) => {
    const merged = mergeNamedHeatmap(entries, (set) => set?.[name]);
    if (merged) {
      heatmaps[name] = merged;
    }
  });

  const variantNames = ['trusted', 'likely', 'possible'];
  const variants = {};

  variantNames.forEach((variantName) => {
    const variant = {};

    topLevelNames.forEach((name) => {
      const merged = mergeNamedHeatmap(entries, (set) => set?.variants?.[variantName]?.[name]);
      if (merged) {
        variant[name] = merged;
      }
    });

    if (Object.keys(variant).length) {
      variants[variantName] = variant;
    }
  });

  if (Object.keys(variants).length) {
    heatmaps.variants = variants;
  }

  return heatmaps;
}

export function buildMergedHeatmapExport(entries, options = {}) {
  const exportedAt = options.exportedAt ?? new Date().toISOString();
  const skipped = [];
  const groupsByKey = new Map();

  (Array.isArray(entries) ? entries : []).forEach((entry) => {
    if (!getHeatmaps(entry.payload)) {
      skipped.push({
        fileName: entry.fileName ?? null,
        reason: 'missing-summary-heatmaps',
      });
      return;
    }

    const key = getHeatmapVideoKey(entry.payload);
    const group = groupsByKey.get(key) || [];
    group.push(entry);
    groupsByKey.set(key, group);
  });

  const groups = [...groupsByKey.entries()].map(([groupKey, groupEntries]) => {
    const firstPayload = groupEntries[0].payload;

    return {
      groupKey,
      video: firstPayload.video ?? firstPayload.project?.video ?? null,
      sourceCount: groupEntries.length,
      sources: groupEntries.map(collectSource),
      summary: {
        heatmaps: mergeHeatmapSet(groupEntries),
      },
    };
  });

  return {
    kind: 'merged-heatmaps',
    version: 1,
    exportedAt,
    sourceFileCount: Array.isArray(entries) ? entries.length : 0,
    groupCount: groups.length,
    groups,
    skipped,
  };
}
```

**Step 2: Run the focused tests**

Run:

```powershell
node --test tests/heatmapMerge.test.js
```

Expected: PASS.

**Step 3: Run adjacent export tests**

Run:

```powershell
node --test tests/heatmapMetrics.test.js tests/recordingExport.test.js tests/heatmapMerge.test.js
```

Expected: PASS.

**Step 4: Commit**

```powershell
git add src/recording/heatmapMerge.js tests/heatmapMerge.test.js
git commit -m "feat: merge exported heatmap payloads by video"
```

---

## Task 5: Add Admin DOM And Layout Tests

**Files:**
- Modify: `tests/appDom.test.js`
- Modify: `tests/responsiveLayout.test.js`
- Modify: `tests/appControllerSource.test.js`
- Modify later: `index.html`
- Modify later: `src/app/dom.js`
- Modify later: `src/app/appController.js`

**Step 1: Add failing DOM selector tests**

In `tests/appDom.test.js`, add selectors to the app selector list and assertions:

```js
'#heatmapMergeFileInput',
'#heatmapMergeStatus',
'#mergedHeatmapGroupSelect',
'#mergedHeatmapVariantSelect',
'#mergedHeatmapTypeSelect',
'#exportMergedHeatmapJsonButton',
'#exportMergedHeatmapImageButton',
```

Add assertions:

```js
assert.equal(dom.heatmapMergeFileInput.selector, '#heatmapMergeFileInput');
assert.equal(dom.heatmapMergeStatus.selector, '#heatmapMergeStatus');
assert.equal(dom.mergedHeatmapGroupSelect.selector, '#mergedHeatmapGroupSelect');
assert.equal(dom.mergedHeatmapVariantSelect.selector, '#mergedHeatmapVariantSelect');
assert.equal(dom.mergedHeatmapTypeSelect.selector, '#mergedHeatmapTypeSelect');
assert.equal(dom.exportMergedHeatmapJsonButton.selector, '#exportMergedHeatmapJsonButton');
assert.equal(dom.exportMergedHeatmapImageButton.selector, '#exportMergedHeatmapImageButton');
```

**Step 2: Add failing layout/source assertions**

In `tests/responsiveLayout.test.js`, add assertions that `index.html` contains the merge UI inside the admin recording panel:

```js
assert.match(
  html,
  /id="adminRecordingPanel"[\s\S]*id="heatmapMergeFileInput"[\s\S]*multiple[\s\S]*id="exportMergedHeatmapJsonButton"[\s\S]*id="exportMergedHeatmapImageButton"/,
);
```

In `tests/appControllerSource.test.js`, add source guardrails:

```js
assert.match(source, /import\s+\{[\s\S]*buildMergedHeatmapExport[\s\S]*\}\s+from\s+'..\/recording\/heatmapMerge\.js'/);
assert.match(source, /async function loadHeatmapMergeFiles\(event\)/);
assert.match(source, /function exportMergedHeatmapJson\(\)/);
assert.match(source, /function exportMergedHeatmapImage\(\)/);
assert.match(source, /heatmapMergeFileInput\.addEventListener\('change',\s*loadHeatmapMergeFiles\)/);
```

**Step 3: Run tests to verify they fail**

Run:

```powershell
node --test tests/appDom.test.js tests/responsiveLayout.test.js tests/appControllerSource.test.js
```

Expected: FAIL because UI selectors and controller functions do not exist yet.

---

## Task 6: Add Admin Merge Controls

**Files:**
- Modify: `index.html`
- Modify: `src/app/dom.js`
- Modify: `styles.css`
- Test: `tests/appDom.test.js`
- Test: `tests/responsiveLayout.test.js`

**Step 1: Add markup in `index.html`**

Place this below the existing `recordingFileInput` file loader in `#adminRecordingPanel`:

```html
<section class="batch-heatmap-panel" aria-labelledby="batchHeatmapHeading">
  <div class="panel-heading compact-heading">
    <p class="section-label">Heatmap tong hop</p>
    <h3 id="batchHeatmapHeading">Gop heatmap nhieu file</h3>
  </div>
  <label class="file-loader">
    <span>Tai nhieu heatmap JSON</span>
    <input id="heatmapMergeFileInput" type="file" accept="application/json,.json" multiple />
  </label>
  <div class="batch-heatmap-controls">
    <label class="field-label compact-field">
      <span>Nhom</span>
      <select id="mergedHeatmapGroupSelect" disabled></select>
    </label>
    <label class="field-label compact-field">
      <span>Bien the</span>
      <select id="mergedHeatmapVariantSelect" disabled>
        <option value="trusted">Trusted</option>
        <option value="likely">Likely AOI</option>
        <option value="possible">Possible AOI</option>
      </select>
    </label>
    <label class="field-label compact-field">
      <span>Loai</span>
      <select id="mergedHeatmapTypeSelect" disabled>
        <option value="panorama">360 panorama</option>
        <option value="screen">Man hinh</option>
      </select>
    </label>
  </div>
  <div class="button-pair">
    <button id="exportMergedHeatmapJsonButton" type="button" disabled>Xuat JSON heatmap tong</button>
    <button id="exportMergedHeatmapImageButton" type="button" disabled>Xuat anh heatmap</button>
  </div>
  <p id="heatmapMergeStatus" class="fine-print">Chua tai heatmap JSON.</p>
</section>
```

Use ASCII in the first pass to avoid expanding the current mojibake problem. If Vietnamese text is repaired later in the app, update this block with proper Vietnamese in the same pass.

**Step 2: Add DOM lookups in `src/app/dom.js`**

Add:

```js
heatmapMergeFileInput: getRequiredElement(documentRef, '#heatmapMergeFileInput'),
heatmapMergeStatus: getRequiredElement(documentRef, '#heatmapMergeStatus'),
mergedHeatmapGroupSelect: getRequiredElement(documentRef, '#mergedHeatmapGroupSelect'),
mergedHeatmapVariantSelect: getRequiredElement(documentRef, '#mergedHeatmapVariantSelect'),
mergedHeatmapTypeSelect: getRequiredElement(documentRef, '#mergedHeatmapTypeSelect'),
exportMergedHeatmapJsonButton: getRequiredElement(documentRef, '#exportMergedHeatmapJsonButton'),
exportMergedHeatmapImageButton: getRequiredElement(documentRef, '#exportMergedHeatmapImageButton'),
```

**Step 3: Add minimal styles**

In `styles.css`, add a compact block near existing recording/output panel styles:

```css
.batch-heatmap-panel {
  display: grid;
  gap: 0.75rem;
  border-top: 1px solid rgba(148, 163, 184, 0.24);
  padding-top: 1rem;
}

.batch-heatmap-controls {
  display: grid;
  gap: 0.75rem;
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

@media (max-width: 720px) {
  .batch-heatmap-controls {
    grid-template-columns: 1fr;
  }
}
```

**Step 4: Run DOM/layout tests**

Run:

```powershell
node --test tests/appDom.test.js tests/responsiveLayout.test.js
```

Expected: PASS.

**Step 5: Commit**

```powershell
git add index.html src/app/dom.js styles.css tests/appDom.test.js tests/responsiveLayout.test.js
git commit -m "feat: add admin batch heatmap controls"
```

---

## Task 7: Wire File Import And Merged JSON Export

**Files:**
- Modify: `src/app/appController.js`
- Test: `tests/appControllerSource.test.js`
- Test manually: browser import/export flow

**Step 1: Import the merge helper**

At the top of `src/app/appController.js`, add:

```js
import { buildMergedHeatmapExport } from '../recording/heatmapMerge.js';
```

**Step 2: Destructure the new DOM elements**

Add to the `queryAppDom()` destructuring area:

```js
heatmapMergeFileInput,
heatmapMergeStatus,
mergedHeatmapGroupSelect,
mergedHeatmapVariantSelect,
mergedHeatmapTypeSelect,
exportMergedHeatmapJsonButton,
exportMergedHeatmapImageButton,
```

**Step 3: Add state**

Near other module state in `createAppController()`:

```js
let mergedHeatmapExport = null;
```

**Step 4: Add UI state helpers**

Add:

```js
function getSelectedMergedHeatmapGroup() {
  if (!mergedHeatmapExport) {
    return null;
  }

  const index = Number(mergedHeatmapGroupSelect.value);
  return mergedHeatmapExport.groups[index] ?? null;
}

function syncMergedHeatmapControls() {
  const groups = mergedHeatmapExport?.groups ?? [];
  const hasGroups = groups.length > 0;

  mergedHeatmapGroupSelect.innerHTML = '';
  groups.forEach((group, index) => {
    const option = document.createElement('option');
    option.value = String(index);
    option.textContent = `${group.video?.name ?? group.groupKey} (${group.sourceCount})`;
    mergedHeatmapGroupSelect.append(option);
  });

  [
    mergedHeatmapGroupSelect,
    mergedHeatmapVariantSelect,
    mergedHeatmapTypeSelect,
    exportMergedHeatmapJsonButton,
    exportMergedHeatmapImageButton,
  ].forEach((element) => {
    element.disabled = !hasGroups;
  });

  if (!mergedHeatmapExport) {
    heatmapMergeStatus.textContent = 'Chua tai heatmap JSON.';
    return;
  }

  const skippedCount = mergedHeatmapExport.skipped?.length ?? 0;
  heatmapMergeStatus.textContent = [
    `Da doc ${mergedHeatmapExport.sourceFileCount} file.`,
    `Tao ${mergedHeatmapExport.groupCount} nhom heatmap.`,
    skippedCount ? `Bo qua ${skippedCount} file khong hop le.` : '',
  ].filter(Boolean).join(' ');
}
```

**Step 5: Add file import**

Add:

```js
async function loadHeatmapMergeFiles(event) {
  const files = Array.from(event.target.files ?? []);

  if (!files.length) {
    return;
  }

  try {
    const entries = await Promise.all(files.map(async (file) => ({
      fileName: file.name,
      payload: JSON.parse(await file.text()),
    })));

    mergedHeatmapExport = buildMergedHeatmapExport(entries);
    syncMergedHeatmapControls();
    setNotice('Da gop heatmap JSON. Kiem tra nhom truoc khi xuat.', true);
  } catch (error) {
    mergedHeatmapExport = null;
    syncMergedHeatmapControls();
    setNotice(`Khong the gop heatmap JSON: ${error.message}`);
  } finally {
    event.target.value = '';
  }
}
```

**Step 6: Add merged JSON export**

Add:

```js
function buildMergedHeatmapFileName(extension = 'json') {
  return `merged-heatmaps-${Date.now()}.${extension}`;
}

function exportMergedHeatmapJson() {
  if (!mergedHeatmapExport) {
    setNotice('Chua co heatmap tong de xuat.');
    return;
  }

  downloadJson(mergedHeatmapExport, buildMergedHeatmapFileName('json'));
  setNotice('Da xuat JSON heatmap tong.', true);
}
```

**Step 7: Register listeners**

In the existing listener block:

```js
heatmapMergeFileInput.addEventListener('change', loadHeatmapMergeFiles);
exportMergedHeatmapJsonButton.addEventListener('click', exportMergedHeatmapJson);
mergedHeatmapGroupSelect.addEventListener('change', syncMergedHeatmapControls);
mergedHeatmapVariantSelect.addEventListener('change', syncMergedHeatmapControls);
mergedHeatmapTypeSelect.addEventListener('change', syncMergedHeatmapControls);
```

**Step 8: Run tests**

Run:

```powershell
node --test tests/appControllerSource.test.js tests/appDom.test.js tests/responsiveLayout.test.js tests/heatmapMerge.test.js
```

Expected: PASS except `exportMergedHeatmapImage()` source guard if that was added in Task 5. If image guard is already active, complete Task 8 before expecting all source tests to pass.

**Step 9: Commit**

```powershell
git add src/app/appController.js tests/appControllerSource.test.js
git commit -m "feat: export merged heatmap json"
```

---

## Task 8: Add PNG Rendering For A Selected Merged Group

**Files:**
- Create: `src/recording/heatmapRender.js`
- Create: `tests/heatmapRender.test.js`
- Modify: `src/app/appController.js`
- Test: `tests/appControllerSource.test.js`

**Step 1: Write failing pure render helper tests**

Create `tests/heatmapRender.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getHeatmapRenderDimensions,
  normalizeHeatmapBins,
} from '../src/recording/heatmapRender.js';

test('chooses panorama render dimensions from grid aspect', () => {
  assert.deepEqual(
    getHeatmapRenderDimensions({
      type: 'panorama',
      columns: 72,
      rows: 36,
    }),
    { width: 1440, height: 720 },
  );
});

test('chooses bounded screen render dimensions from source size', () => {
  assert.deepEqual(
    getHeatmapRenderDimensions({
      type: 'screen',
      columns: 48,
      rows: 27,
      width: 1920,
      height: 1080,
    }),
    { width: 1280, height: 720 },
  );
});

test('normalizes bin intensity against max weight', () => {
  assert.deepEqual(
    normalizeHeatmapBins({
      bins: [
        { column: 0, row: 0, weightSec: 1, sampleCount: 2 },
        { column: 1, row: 0, weightSec: 4, sampleCount: 8 },
      ],
    }),
    [
      { column: 0, row: 0, weightSec: 1, sampleCount: 2, intensity: 0.25 },
      { column: 1, row: 0, weightSec: 4, sampleCount: 8, intensity: 1 },
    ],
  );
});
```

Run:

```powershell
node --test tests/heatmapRender.test.js
```

Expected: FAIL because `src/recording/heatmapRender.js` does not exist.

**Step 2: Implement pure render helpers**

Create `src/recording/heatmapRender.js`:

```js
function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function getHeatmapRenderDimensions(heatmap) {
  if (heatmap?.type === 'screen' && Number.isFinite(heatmap.width) && Number.isFinite(heatmap.height)) {
    const maxWidth = 1280;
    const scale = Math.min(1, maxWidth / heatmap.width);

    return {
      width: Math.max(1, Math.round(heatmap.width * scale)),
      height: Math.max(1, Math.round(heatmap.height * scale)),
    };
  }

  const columns = Number.isFinite(heatmap?.columns) ? heatmap.columns : 72;
  const rows = Number.isFinite(heatmap?.rows) ? heatmap.rows : 36;
  const width = 1440;

  return {
    width,
    height: Math.max(1, Math.round(width * (rows / columns))),
  };
}

export function normalizeHeatmapBins(heatmap) {
  const bins = Array.isArray(heatmap?.bins) ? heatmap.bins : [];
  const maxWeight = Math.max(...bins.map((bin) => bin.weightSec || 0), 0);

  return bins.map((bin) => ({
    ...bin,
    intensity: maxWeight > 0
      ? clamp(Number((bin.weightSec / maxWeight).toFixed(3)), 0, 1)
      : 0,
  }));
}
```

**Step 3: Add browser canvas renderer in `appController.js`**

Import:

```js
import {
  getHeatmapRenderDimensions,
  normalizeHeatmapBins,
} from '../recording/heatmapRender.js';
```

Add:

```js
function getSelectedMergedHeatmap() {
  const group = getSelectedMergedHeatmapGroup();
  const variant = mergedHeatmapVariantSelect.value;
  const type = mergedHeatmapTypeSelect.value;
  return group?.summary?.heatmaps?.variants?.[variant]?.[type]
    ?? group?.summary?.heatmaps?.[type]
    ?? null;
}

function drawMergedHeatmapToCanvas(canvas, heatmap) {
  const dimensions = getHeatmapRenderDimensions(heatmap);
  const ctx = canvas.getContext('2d');

  canvas.width = dimensions.width;
  canvas.height = dimensions.height;

  if (!ctx) {
    return false;
  }

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#101820';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const cellWidth = canvas.width / heatmap.columns;
  const cellHeight = canvas.height / heatmap.rows;
  const radius = Math.max(cellWidth, cellHeight) * 1.7;

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  normalizeHeatmapBins(heatmap).forEach((bin) => {
    if (bin.intensity <= 0) {
      return;
    }

    const x = (bin.column + 0.5) * cellWidth;
    const y = (bin.row + 0.5) * cellHeight;
    const alpha = 0.12 + bin.intensity * 0.34;
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);

    gradient.addColorStop(0, `rgba(255, 255, 255, ${Math.min(0.85, alpha + 0.22).toFixed(3)})`);
    gradient.addColorStop(0.18, `rgba(255, 24, 16, ${alpha.toFixed(3)})`);
    gradient.addColorStop(0.48, `rgba(255, 210, 28, ${(alpha * 0.75).toFixed(3)})`);
    gradient.addColorStop(0.82, `rgba(0, 220, 255, ${(alpha * 0.38).toFixed(3)})`);
    gradient.addColorStop(1, 'rgba(0, 220, 255, 0)');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.restore();

  return true;
}

function exportMergedHeatmapImage() {
  const heatmap = getSelectedMergedHeatmap();

  if (!heatmap) {
    setNotice('Nhom da chon khong co heatmap hop le de xuat anh.');
    return;
  }

  const canvas = document.createElement('canvas');
  const rendered = drawMergedHeatmapToCanvas(canvas, heatmap);

  if (!rendered) {
    setNotice('Khong the ve heatmap tong.');
    return;
  }

  const link = document.createElement('a');
  link.href = canvas.toDataURL('image/png');
  link.download = buildMergedHeatmapFileName('png');
  link.click();
  setNotice('Da xuat anh heatmap tong.', true);
}
```

**Step 4: Register the image export listener**

Add:

```js
exportMergedHeatmapImageButton.addEventListener('click', exportMergedHeatmapImage);
```

**Step 5: Run tests**

Run:

```powershell
node --test tests/heatmapRender.test.js tests/appControllerSource.test.js
```

Expected: PASS.

**Step 6: Commit**

```powershell
git add src/recording/heatmapRender.js tests/heatmapRender.test.js src/app/appController.js tests/appControllerSource.test.js
git commit -m "feat: export merged heatmap image"
```

---

## Task 9: Update UI Smoke Coverage

**Files:**
- Modify: `tests/uiSmoke.mjs`
- Optional fixture: create temp JSON files inside the smoke test using existing helper patterns

**Step 1: Add a smoke path for batch merge controls**

In `tests/uiSmoke.mjs`, add a focused section after admin mode is loaded:

```js
const heatmapOne = path.join(tempDir, 'heatmap-one.json');
const heatmapTwo = path.join(tempDir, 'heatmap-two.json');

const makeHeatmapPayload = (participantId, weightSec) => ({
  exportedAt: '2026-06-27T00:00:00.000Z',
  participant: { id: participantId },
  video: { name: 'smoke.mp4', src: 'assets/clips/smoke.mp4', projection: 'flat' },
  summary: {
    heatmaps: {
      screen: {
        type: 'screen',
        columns: 2,
        rows: 2,
        width: 100,
        height: 80,
        totalWeightSec: weightSec,
        bins: [{ column: 0, row: 0, weightSec, sampleCount: 1 }],
      },
    },
  },
});

await fs.promises.writeFile(heatmapOne, JSON.stringify(makeHeatmapPayload('p01', 0.1)));
await fs.promises.writeFile(heatmapTwo, JSON.stringify(makeHeatmapPayload('p02', 0.2)));

await page.locator('#heatmapMergeFileInput').setInputFiles([heatmapOne, heatmapTwo]);
await expect(page.locator('#heatmapMergeStatus')).toContainText('Tao 1 nhom heatmap');
await expect(page.locator('#exportMergedHeatmapJsonButton')).toBeEnabled();
await expect(page.locator('#exportMergedHeatmapImageButton')).toBeEnabled();
```

Use the repository's existing Playwright assertion style. If `expect` is not imported in this smoke file, follow the local helper pattern instead of adding a new assertion framework.

**Step 2: Run the smoke test**

Run:

```powershell
npm run test:ui
```

Expected: PASS.

**Step 3: Commit**

```powershell
git add tests/uiSmoke.mjs
git commit -m "test: cover batch heatmap merge workflow"
```

---

## Task 10: Update Documentation And Final Verification

**Files:**
- Modify: `README.md`
- Optional: `docs/eye-tracking-benchmark-protocol.md`

**Step 1: Update README heatmap/export docs**

In `README.md`, update the export section around the existing `summary.heatmaps` bullets:

```markdown
### Batch heatmap merge

Participant heatmap export writes compact JSON data, not only a screenshot. In Admin mode, use "Gop heatmap nhieu file" to import multiple heatmap JSON files. The app merges files that share the same video identity and compatible grid metadata.

If all inputs are from the same video and grid, the merged output contains one final heatmap group. If inputs come from different videos, the merged output keeps one group per video so the final package remains analytically meaningful. Use the group selector to export a PNG for a specific merged group.
```

**Step 2: Run focused tests**

Run:

```powershell
node --test tests/heatmapMerge.test.js tests/heatmapRender.test.js tests/heatmapMetrics.test.js tests/recordingExport.test.js tests/appDom.test.js tests/responsiveLayout.test.js tests/appControllerSource.test.js
```

Expected: PASS.

**Step 3: Run full test suite**

Run:

```powershell
npm test
```

Expected: PASS.

**Step 4: Run UI smoke if browser dependencies are available**

Run:

```powershell
npm run test:ui
```

Expected: PASS. If Playwright/browser setup fails for an environment reason, record the exact failure in the final handoff.

**Step 5: Manual verification**

Start the app:

```powershell
npm run serve
```

Open:

```text
http://localhost:5179/?mode=admin
```

Manual path:

1. Load two compatible heatmap JSON exports.
2. Confirm status says one heatmap group was created.
3. Export merged JSON.
4. Confirm JSON has `kind: "merged-heatmaps"`, `groupCount: 1`, and summed `totalWeightSec`.
5. Export PNG and confirm it is a non-empty heatmap image.
6. Load two files with different `video.name` values.
7. Confirm status says two groups were created.
8. Confirm the exported JSON keeps both groups instead of forcing a single overlay.

**Step 6: Final commit**

```powershell
git add README.md docs/eye-tracking-benchmark-protocol.md
git commit -m "docs: explain batch heatmap merge workflow"
```

---

## Risk Notes

- A single PNG across unrelated videos is intentionally not supported because the spatial meaning changes between videos.
- The merged JSON is the research-grade artifact; PNG is a convenience visualization for a selected group.
- Screen heatmaps are stricter than panorama heatmaps because screen dimensions can change with viewport size.
- If future exports include a stable study video id, update `getHeatmapVideoKey()` to prefer that id over name/src.
- Do not change current participant export behavior in this plan; old exported files remain compatible.

## Acceptance Criteria

- Existing per-recording heatmap export still works.
- Multiple heatmap JSON files can be selected in admin mode.
- Compatible heatmaps merge by summing `weightSec` and `sampleCount`.
- Different videos produce separate merged groups.
- Invalid files are skipped with a visible count and a reason in exported JSON.
- Merged JSON export works.
- Merged PNG export works for the selected group/type/variant.
- Focused tests and `npm test` pass.

