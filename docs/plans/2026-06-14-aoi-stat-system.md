# AOI Stat System Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a defensible AOI statistics system that calculates, labels, exports, and displays per-AOI/session metrics for the requested 5-AOI research workflow, including fixation metrics, TTFF, heatmap data, and carefully labeled experimental metrics.

**Architecture:** Keep metric computation in pure `src/recording` modules so it remains testable outside the browser. Reuse the existing sample stream, AOI classifications, and `buildNamedAoiMetrics()` pipeline, but add a canonical stat registry, richer fixation/transition metrics, heatmap grid generation, CSV/report export, and a compact UI panel that reads from the same normalized report object. Treat saccade duration and overall processing efficiency as experimental unless pilot validation proves they are stable.

**Tech Stack:** Static HTML/CSS, browser ES modules, Three.js viewer, Node `node:test`, Playwright smoke tests, existing JSON export flow.

---

## Metric Scope

Implement these as first-class, named output fields:

- Per AOI: `totalDwellSec`, `likelyDwellSec`, `stableDwellSec`, `fixationCount`, `totalFixationDurationMs`, `averageFixationDurationMs`, `firstFixationDurationMs`, `timeToFirstFixationMs`, `revisitCount`, `percentageOfViewingTime`, `trustedSampleCount`, `ambiguousSampleCount`.
- Session: `totalDurationSec`, `totalFixations`, `averageFixationDurationMs`, `uniqueAoisFixated`, `averageNumberOfAoisFixated`, `aoiCoveragePercent`, `overallProcessingEfficiency`.
- Heatmap: screen-space and panorama-space heatmap bins weighted by sample duration, with trusted/likely/possible variants.
- Experimental: `averageSaccadeDurationMs`, `saccadeCount`, and AOI transition path. These should be exported only with a reliability label and caveat.

Do not present webcam-derived saccade duration as a validated research metric. It can exist as an exploratory field because this app records screen samples and detects fixations, but the UI/docs must label it as experimental.

---

### Task 1: Add Canonical Stat Definitions

**Files:**
- Create: `src/recording/statDefinitions.js`
- Create: `tests/statDefinitions.test.js`
- Modify: `README.md`

**Step 1: Write the failing test**

Create `tests/statDefinitions.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AOI_STAT_DEFINITIONS,
  getStatDefinition,
  listStatsByScope,
} from '../src/recording/statDefinitions.js';

test('stat definitions have stable ids, labels, scopes, units, and reliability', () => {
  const ids = AOI_STAT_DEFINITIONS.map((definition) => definition.id);

  assert.equal(new Set(ids).size, ids.length);
  assert.ok(getStatDefinition('totalFixationDurationMs'));
  assert.equal(getStatDefinition('averageSaccadeDurationMs').reliability, 'experimental');
  assert.equal(getStatDefinition('overallProcessingEfficiency').reliability, 'estimated');
  assert.equal(getStatDefinition('timeToFirstFixationMs').scope, 'perAoi');
});

test('groups stats by scope', () => {
  assert.ok(listStatsByScope('perAoi').some((definition) => definition.id === 'fixationCount'));
  assert.ok(listStatsByScope('session').some((definition) => definition.id === 'aoiCoveragePercent'));
  assert.ok(listStatsByScope('heatmap').some((definition) => definition.id === 'panoramaHeatmap'));
});
```

**Step 2: Run the test to verify it fails**

Run:

```powershell
npm test -- tests/statDefinitions.test.js
```

Expected: FAIL because `src/recording/statDefinitions.js` does not exist.

**Step 3: Implement the stat registry**

Create `src/recording/statDefinitions.js`:

```js
export const STAT_RELIABILITY = {
  STABLE: 'stable',
  ESTIMATED: 'estimated',
  EXPERIMENTAL: 'experimental',
};

export const AOI_STAT_DEFINITIONS = [
  {
    id: 'totalDwellSec',
    label: 'Total dwell time',
    scope: 'perAoi',
    unit: 'sec',
    reliability: STAT_RELIABILITY.STABLE,
    description: 'Estimated time with gaze inside the exact AOI hit region.',
  },
  {
    id: 'likelyDwellSec',
    label: 'Likely dwell time',
    scope: 'perAoi',
    unit: 'sec',
    reliability: STAT_RELIABILITY.STABLE,
    description: 'Estimated time in AOI when gaze uncertainty still fits the AOI.',
  },
  {
    id: 'stableDwellSec',
    label: 'Trusted stable dwell time',
    scope: 'perAoi',
    unit: 'sec',
    reliability: STAT_RELIABILITY.STABLE,
    description: 'Dwell time from temporally stable AOI hits trusted for analysis.',
  },
  {
    id: 'fixationCount',
    label: 'Fixation count',
    scope: 'perAoi',
    unit: 'count',
    reliability: STAT_RELIABILITY.ESTIMATED,
    description: 'Number of detected fixation windows mapped to this AOI.',
  },
  {
    id: 'totalFixationDurationMs',
    label: 'Total fixation duration',
    scope: 'perAoi',
    unit: 'ms',
    reliability: STAT_RELIABILITY.ESTIMATED,
    description: 'Total duration of fixation windows mapped to this AOI.',
  },
  {
    id: 'averageFixationDurationMs',
    label: 'Average fixation duration',
    scope: 'perAoi',
    unit: 'ms',
    reliability: STAT_RELIABILITY.ESTIMATED,
    description: 'Mean duration of fixation windows mapped to this AOI.',
  },
  {
    id: 'firstFixationDurationMs',
    label: 'First fixation duration',
    scope: 'perAoi',
    unit: 'ms',
    reliability: STAT_RELIABILITY.ESTIMATED,
    description: 'Duration of the first fixation mapped to this AOI.',
  },
  {
    id: 'timeToFirstFixationMs',
    label: 'Time to first fixation',
    scope: 'perAoi',
    unit: 'ms',
    reliability: STAT_RELIABILITY.ESTIMATED,
    description: 'Elapsed time from recording start to first fixation on this AOI.',
  },
  {
    id: 'revisitCount',
    label: 'Revisits',
    scope: 'perAoi',
    unit: 'count',
    reliability: STAT_RELIABILITY.ESTIMATED,
    description: 'Number of later fixation returns after leaving this AOI.',
  },
  {
    id: 'percentageOfViewingTime',
    label: 'Viewing time share',
    scope: 'perAoi',
    unit: 'percent',
    reliability: STAT_RELIABILITY.STABLE,
    description: 'Exact AOI dwell time divided by total recording duration.',
  },
  {
    id: 'averageNumberOfAoisFixated',
    label: 'Average number of AOIs fixated',
    scope: 'session',
    unit: 'count',
    reliability: STAT_RELIABILITY.ESTIMATED,
    description: 'For one recording, the number of unique AOIs with at least one fixation; across recordings, average this value.',
  },
  {
    id: 'aoiCoveragePercent',
    label: 'AOI coverage',
    scope: 'session',
    unit: 'percent',
    reliability: STAT_RELIABILITY.ESTIMATED,
    description: 'Percent of defined AOIs that received at least one fixation.',
  },
  {
    id: 'overallProcessingEfficiency',
    label: 'Overall processing efficiency',
    scope: 'session',
    unit: 'score',
    reliability: STAT_RELIABILITY.ESTIMATED,
    description: 'Transparent composite score based on AOI coverage, trusted dwell share, and fixation efficiency.',
  },
  {
    id: 'averageSaccadeDurationMs',
    label: 'Average saccade duration',
    scope: 'session',
    unit: 'ms',
    reliability: STAT_RELIABILITY.EXPERIMENTAL,
    description: 'Time between fixation windows; exploratory only for webcam data.',
  },
  {
    id: 'screenHeatmap',
    label: 'Screen heatmap',
    scope: 'heatmap',
    unit: 'weightedSamples',
    reliability: STAT_RELIABILITY.STABLE,
    description: 'Screen-space gaze density grid weighted by sample duration.',
  },
  {
    id: 'panoramaHeatmap',
    label: 'Panorama heatmap',
    scope: 'heatmap',
    unit: 'weightedSamples',
    reliability: STAT_RELIABILITY.STABLE,
    description: 'Yaw/pitch gaze density grid weighted by sample duration for 360 video.',
  },
];

export function getStatDefinition(id) {
  return AOI_STAT_DEFINITIONS.find((definition) => definition.id === id) || null;
}

export function listStatsByScope(scope) {
  return AOI_STAT_DEFINITIONS.filter((definition) => definition.scope === scope);
}
```

**Step 4: Run the test to verify it passes**

Run:

```powershell
npm test -- tests/statDefinitions.test.js
```

Expected: PASS.

**Step 5: Commit**

```powershell
git add src/recording/statDefinitions.js tests/statDefinitions.test.js README.md
git commit -m "feat: define AOI stat registry"
```

---

### Task 2: Expose Fixation Windows and Add First Fixation/Revisit Metrics

**Files:**
- Modify: `src/recording/analysisMetrics.js`
- Modify: `tests/analysisMetrics.test.js`

**Step 1: Write failing tests**

Append to `tests/analysisMetrics.test.js`:

```js
test('reports first fixation duration and revisit count per AOI', () => {
  const aois = [
    { id: 'logo', label: 'Logo' },
    { id: 'product', label: 'Product' },
  ];
  const samples = [
    { t: 0.00, screen: { x: 100, y: 100 }, hits: ['logo'], likelyHits: ['logo'], possibleHits: [], ambiguousHits: [], activeAois: aois },
    { t: 0.05, screen: { x: 102, y: 101 }, hits: ['logo'], likelyHits: ['logo'], possibleHits: [], ambiguousHits: [], activeAois: aois },
    { t: 0.10, screen: { x: 400, y: 300 }, hits: ['product'], likelyHits: ['product'], possibleHits: [], ambiguousHits: [], activeAois: aois },
    { t: 0.15, screen: { x: 402, y: 302 }, hits: ['product'], likelyHits: ['product'], possibleHits: [], ambiguousHits: [], activeAois: aois },
    { t: 0.20, screen: { x: 104, y: 100 }, hits: ['logo'], likelyHits: ['logo'], possibleHits: [], ambiguousHits: [], activeAois: aois },
    { t: 0.25, screen: { x: 103, y: 99 }, hits: ['logo'], likelyHits: ['logo'], possibleHits: [], ambiguousHits: [], activeAois: aois },
  ];

  const metrics = buildNamedAoiMetrics(samples, aois);

  assert.equal(metrics.perAoi.logo.fixationCount, 2);
  assert.equal(metrics.perAoi.logo.firstFixationDurationMs, 100);
  assert.equal(metrics.perAoi.logo.revisitCount, 1);
  assert.equal(metrics.perAoi.product.firstFixationDurationMs, 100);
  assert.equal(Array.isArray(metrics.fixations), true);
  assert.equal(metrics.fixations.length, 3);
});
```

**Step 2: Run the test to verify it fails**

Run:

```powershell
npm test -- tests/analysisMetrics.test.js
```

Expected: FAIL because `firstFixationDurationMs`, `revisitCount`, and top-level `fixations` are absent.

**Step 3: Implement minimal metric additions**

In `src/recording/analysisMetrics.js`:

- Add fields to `createAoiMetric()`:

```js
firstFixationDurationMs: null,
revisitCount: 0,
```

- While iterating `fixations`, keep ordered fixation metadata:

```js
const exportedFixations = fixations.map((fixation) => ({
  aoiId: fixation.aoiId,
  startSec: roundNumber(fixation.startSec),
  endSec: roundNumber(fixationCoverageEndSec(fixation)),
  durationMs: Math.round(fixationDurationMs(fixation)),
  sampleCount: fixation.sampleCount ?? null,
  centroid: fixation.centroid ? {
    x: roundNumber(fixation.centroid.x, 1),
    y: roundNumber(fixation.centroid.y, 1),
  } : null,
}));
```

- Update fixation loop:

```js
const previousFixatedAoiIds = new Set();

fixations.forEach((fixation) => {
  if (!perAoi[fixation.aoiId]) {
    perAoi[fixation.aoiId] = createAoiMetric({ id: fixation.aoiId, label: fixation.aoiId });
  }

  const metric = perAoi[fixation.aoiId];
  const durationMs = fixationDurationMs(fixation);

  if (previousFixatedAoiIds.has(fixation.aoiId)) {
    metric.revisitCount += 1;
  }

  metric.fixationCount += 1;
  metric.totalFixationDurationMs += durationMs;
  metric.firstFixationDurationMs = metric.firstFixationDurationMs ?? Math.round(durationMs);
  metric.timeToFirstFixationMs = metric.timeToFirstFixationMs
    ?? Math.round(fixation.startSec * 1000);
  previousFixatedAoiIds.add(fixation.aoiId);
});
```

- Return `fixations: exportedFixations` from `buildNamedAoiMetrics()`.

**Step 4: Run the test to verify it passes**

Run:

```powershell
npm test -- tests/analysisMetrics.test.js
```

Expected: PASS.

**Step 5: Commit**

```powershell
git add src/recording/analysisMetrics.js tests/analysisMetrics.test.js
git commit -m "feat: add first fixation and revisit stats"
```

---

### Task 3: Add Experimental Saccade/Transition Metrics

**Files:**
- Modify: `src/recording/analysisMetrics.js`
- Modify: `tests/analysisMetrics.test.js`
- Modify: `README.md`

**Step 1: Write failing tests**

Append to `tests/analysisMetrics.test.js`:

```js
test('reports experimental saccade durations between fixation windows', () => {
  const aois = [
    { id: 'left', label: 'Left' },
    { id: 'right', label: 'Right' },
  ];
  const samples = [
    { t: 0.00, screen: { x: 100, y: 100 }, hits: ['left'], likelyHits: ['left'], possibleHits: [], ambiguousHits: [], activeAois: aois },
    { t: 0.05, screen: { x: 102, y: 100 }, hits: ['left'], likelyHits: ['left'], possibleHits: [], ambiguousHits: [], activeAois: aois },
    { t: 0.20, screen: { x: 500, y: 300 }, hits: ['right'], likelyHits: ['right'], possibleHits: [], ambiguousHits: [], activeAois: aois },
    { t: 0.25, screen: { x: 502, y: 301 }, hits: ['right'], likelyHits: ['right'], possibleHits: [], ambiguousHits: [], activeAois: aois },
  ];

  const metrics = buildNamedAoiMetrics(samples, aois);

  assert.equal(metrics.session.saccadeCount, 1);
  assert.equal(metrics.session.averageSaccadeDurationMs, 100);
  assert.deepEqual(metrics.transitions.map((transition) => [transition.fromAoiId, transition.toAoiId]), [['left', 'right']]);
});
```

**Step 2: Run the test to verify it fails**

Run:

```powershell
npm test -- tests/analysisMetrics.test.js
```

Expected: FAIL because `saccadeCount`, `averageSaccadeDurationMs`, and `transitions` are absent.

**Step 3: Implement transition derivation**

In `src/recording/analysisMetrics.js`, add:

```js
function buildFixationTransitions(fixations) {
  return fixations.slice(1).map((fixation, index) => {
    const previous = fixations[index];
    const previousEndSec = fixationCoverageEndSec(previous);
    const durationMs = Math.max(0, Math.round((fixation.startSec - previousEndSec) * 1000));

    return {
      fromAoiId: previous.aoiId,
      toAoiId: fixation.aoiId,
      startSec: roundNumber(previousEndSec),
      endSec: roundNumber(fixation.startSec),
      durationMs,
    };
  }).filter((transition) => transition.fromAoiId !== transition.toAoiId);
}
```

In `buildNamedAoiMetrics()`:

```js
const transitions = buildFixationTransitions(fixations);
const saccadeDurationsMs = transitions.map((transition) => transition.durationMs);
```

Add session fields:

```js
saccadeCount: transitions.length,
averageSaccadeDurationMs: saccadeDurationsMs.length
  ? Math.round(saccadeDurationsMs.reduce((sum, duration) => sum + duration, 0) / saccadeDurationsMs.length)
  : null,
```

Return:

```js
transitions,
```

**Step 4: Run the test to verify it passes**

Run:

```powershell
npm test -- tests/analysisMetrics.test.js
```

Expected: PASS.

**Step 5: Update README caveat**

In `README.md`, update the `namedAoiMetrics.session` paragraph to say:

```markdown
`averageSaccadeDurationMs` and `transitions` are exploratory webcam-derived values based on gaps between detected fixation windows. Use them for scanpath debugging and pilot comparison, not as validated saccade physiology.
```

**Step 6: Commit**

```powershell
git add src/recording/analysisMetrics.js tests/analysisMetrics.test.js README.md
git commit -m "feat: add exploratory AOI transition stats"
```

---

### Task 4: Replace Opaque Processing Efficiency With a Transparent Composite

**Files:**
- Modify: `src/recording/analysisMetrics.js`
- Modify: `tests/analysisMetrics.test.js`
- Modify: `README.md`

**Step 1: Write failing tests**

Append to `tests/analysisMetrics.test.js`:

```js
test('reports transparent processing efficiency components', () => {
  const aois = [
    { id: 'a', label: 'A' },
    { id: 'b', label: 'B' },
  ];
  const samples = [
    { t: 0.0, hits: ['a'], stableHits: ['a'], likelyHits: ['a'], possibleHits: [], ambiguousHits: [], quality: { trustedForAoiAnalysis: true }, activeAois: aois },
    { t: 0.1, hits: ['a'], stableHits: ['a'], likelyHits: ['a'], possibleHits: [], ambiguousHits: [], quality: { trustedForAoiAnalysis: true }, activeAois: aois },
    { t: 0.2, hits: ['b'], stableHits: ['b'], likelyHits: ['b'], possibleHits: [], ambiguousHits: [], quality: { trustedForAoiAnalysis: true }, activeAois: aois },
    { t: 0.3, hits: [], stableHits: [], likelyHits: [], possibleHits: [], ambiguousHits: [], quality: { trustedForAoiAnalysis: false }, activeAois: aois },
  ];

  const metrics = buildNamedAoiMetrics(samples, aois, { sampleIntervalMs: 100 });

  assert.equal(typeof metrics.session.processingEfficiencyComponents, 'object');
  assert.equal(metrics.session.processingEfficiencyComponents.aoiCoveragePercent, 100);
  assert.equal(metrics.session.processingEfficiencyComponents.trustedAoiDwellPercent, 75);
  assert.equal(metrics.session.overallProcessingEfficiency >= 0, true);
  assert.equal(metrics.session.overallProcessingEfficiency <= 100, true);
});
```

**Step 2: Run the test to verify it fails**

Run:

```powershell
npm test -- tests/analysisMetrics.test.js
```

Expected: FAIL because `processingEfficiencyComponents` is absent or old OPE is only dwell share.

**Step 3: Implement transparent formula**

In `src/recording/analysisMetrics.js`, add helpers:

```js
function clampPercent(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(100, Math.max(0, value));
}

function buildProcessingEfficiency({ aoiCoveragePercent, trustedAoiDwellPercent, fixationEfficiencyPercent }) {
  const coverage = clampPercent(aoiCoveragePercent);
  const trustedDwell = clampPercent(trustedAoiDwellPercent);
  const fixationEfficiency = clampPercent(fixationEfficiencyPercent);

  return {
    score: roundNumber((coverage * 0.4) + (trustedDwell * 0.4) + (fixationEfficiency * 0.2), 2),
    components: {
      aoiCoveragePercent: roundNumber(coverage, 2),
      trustedAoiDwellPercent: roundNumber(trustedDwell, 2),
      fixationEfficiencyPercent: roundNumber(fixationEfficiency, 2),
    },
    formula: '0.4*aoiCoveragePercent + 0.4*trustedAoiDwellPercent + 0.2*fixationEfficiencyPercent',
  };
}
```

Use these inputs:

- `aoiCoveragePercent`: already computed from AOIs with fixations.
- `trustedAoiDwellPercent`: `stableDwellSec / totalDurationSec * 100` when stable hits exist; otherwise `likelyDwellSec / totalDurationSec * 100`.
- `fixationEfficiencyPercent`: `min(100, totalFixations / max(1, fixatedAoiIds.length) * 20)` as a conservative placeholder. Keep formula visible so it can be revised after pilot data.

Set session fields:

```js
overallProcessingEfficiency: processingEfficiency.score,
processingEfficiencyComponents: processingEfficiency.components,
processingEfficiencyFormula: processingEfficiency.formula,
```

**Step 4: Run the test to verify it passes**

Run:

```powershell
npm test -- tests/analysisMetrics.test.js
```

Expected: PASS.

**Step 5: Update README caveat**

Add:

```markdown
`overallProcessingEfficiency` is a transparent MVP composite, not a validated cognitive score. Report its formula and components with any result table.
```

**Step 6: Commit**

```powershell
git add src/recording/analysisMetrics.js tests/analysisMetrics.test.js README.md
git commit -m "feat: make processing efficiency transparent"
```

---

### Task 5: Add Heatmap Grid Generation

**Files:**
- Create: `src/recording/heatmapMetrics.js`
- Create: `tests/heatmapMetrics.test.js`
- Modify: `src/recording/recordingExport.js`
- Modify: `tests/recordingExport.test.js`

**Step 1: Write failing heatmap tests**

Create `tests/heatmapMetrics.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPanoramaHeatmap,
  buildScreenHeatmap,
} from '../src/recording/heatmapMetrics.js';

test('builds screen heatmap bins weighted by sample duration', () => {
  const heatmap = buildScreenHeatmap([
    { t: 0.0, screen: { x: 10, y: 10 }, quality: { trustedForAoiAnalysis: true } },
    { t: 0.1, screen: { x: 11, y: 10 }, quality: { trustedForAoiAnalysis: true } },
    { t: 0.2, screen: { x: 90, y: 90 }, quality: { trustedForAoiAnalysis: false } },
  ], {
    width: 100,
    height: 100,
    columns: 10,
    rows: 10,
    sampleIntervalMs: 100,
    trustedOnly: true,
  });

  assert.equal(heatmap.columns, 10);
  assert.equal(heatmap.rows, 10);
  assert.equal(heatmap.totalWeightSec, 0.2);
  assert.equal(heatmap.bins.some((bin) => bin.weightSec > 0), true);
});

test('builds panorama heatmap bins from yaw and pitch', () => {
  const heatmap = buildPanoramaHeatmap([
    { t: 0.0, panorama: { yaw: 0, pitch: 0 }, quality: { trustedForAoiAnalysis: true } },
    { t: 0.1, panorama: { yaw: 10, pitch: 5 }, quality: { trustedForAoiAnalysis: true } },
  ], {
    columns: 36,
    rows: 18,
    sampleIntervalMs: 100,
  });

  assert.equal(heatmap.columns, 36);
  assert.equal(heatmap.rows, 18);
  assert.equal(heatmap.totalWeightSec, 0.2);
});
```

**Step 2: Run the test to verify it fails**

Run:

```powershell
npm test -- tests/heatmapMetrics.test.js
```

Expected: FAIL because `heatmapMetrics.js` does not exist.

**Step 3: Implement heatmap generation**

Create `src/recording/heatmapMetrics.js`:

```js
import { getSampleDurations } from './analysisMetrics.js';
import { DEFAULT_RECORDING_SAMPLE_INTERVAL_MS } from './sampleScheduler.js';

function roundNumber(value, digits = 3) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

function createBins(columns, rows) {
  return Array.from({ length: columns * rows }, (_, index) => ({
    column: index % columns,
    row: Math.floor(index / columns),
    weightSec: 0,
    sampleCount: 0,
  }));
}

function includeSample(sample, trustedOnly) {
  return !trustedOnly || sample.quality?.trustedForAoiAnalysis;
}

export function buildScreenHeatmap(samples = [], {
  width,
  height,
  columns = 48,
  rows = 27,
  sampleIntervalMs = DEFAULT_RECORDING_SAMPLE_INTERVAL_MS,
  trustedOnly = false,
} = {}) {
  const safeSamples = samples.filter((sample) => (
    Number.isFinite(sample?.t)
    && Number.isFinite(sample?.screen?.x)
    && Number.isFinite(sample?.screen?.y)
    && includeSample(sample, trustedOnly)
  ));
  const durations = getSampleDurations(safeSamples, sampleIntervalMs / 1000);
  const bins = createBins(columns, rows);
  const safeWidth = Number.isFinite(width) && width > 0 ? width : Math.max(...safeSamples.map((sample) => sample.screen.x), 1);
  const safeHeight = Number.isFinite(height) && height > 0 ? height : Math.max(...safeSamples.map((sample) => sample.screen.y), 1);

  safeSamples.forEach((sample, index) => {
    const column = Math.min(columns - 1, Math.max(0, Math.floor((sample.screen.x / safeWidth) * columns)));
    const row = Math.min(rows - 1, Math.max(0, Math.floor((sample.screen.y / safeHeight) * rows)));
    const bin = bins[(row * columns) + column];
    bin.weightSec += durations[index] || 0;
    bin.sampleCount += 1;
  });

  bins.forEach((bin) => {
    bin.weightSec = roundNumber(bin.weightSec);
  });

  return {
    type: 'screen',
    columns,
    rows,
    width: safeWidth,
    height: safeHeight,
    trustedOnly,
    totalWeightSec: roundNumber(bins.reduce((sum, bin) => sum + bin.weightSec, 0)),
    bins,
  };
}

export function buildPanoramaHeatmap(samples = [], {
  columns = 72,
  rows = 36,
  sampleIntervalMs = DEFAULT_RECORDING_SAMPLE_INTERVAL_MS,
  trustedOnly = false,
} = {}) {
  const safeSamples = samples.filter((sample) => (
    Number.isFinite(sample?.t)
    && Number.isFinite(sample?.panorama?.yaw)
    && Number.isFinite(sample?.panorama?.pitch)
    && includeSample(sample, trustedOnly)
  ));
  const durations = getSampleDurations(safeSamples, sampleIntervalMs / 1000);
  const bins = createBins(columns, rows);

  safeSamples.forEach((sample, index) => {
    const normalizedYaw = ((sample.panorama.yaw + 180) % 360 + 360) % 360;
    const normalizedPitch = Math.min(90, Math.max(-90, sample.panorama.pitch));
    const column = Math.min(columns - 1, Math.max(0, Math.floor((normalizedYaw / 360) * columns)));
    const row = Math.min(rows - 1, Math.max(0, Math.floor(((90 - normalizedPitch) / 180) * rows)));
    const bin = bins[(row * columns) + column];
    bin.weightSec += durations[index] || 0;
    bin.sampleCount += 1;
  });

  bins.forEach((bin) => {
    bin.weightSec = roundNumber(bin.weightSec);
  });

  return {
    type: 'panorama',
    columns,
    rows,
    yawRange: [-180, 180],
    pitchRange: [-90, 90],
    trustedOnly,
    totalWeightSec: roundNumber(bins.reduce((sum, bin) => sum + bin.weightSec, 0)),
    bins,
  };
}
```

**Step 4: Run heatmap tests**

Run:

```powershell
npm test -- tests/heatmapMetrics.test.js
```

Expected: PASS.

**Step 5: Add heatmap data to export summary**

In `src/recording/recordingExport.js`:

- Import heatmap builders:

```js
import { buildPanoramaHeatmap, buildScreenHeatmap } from './heatmapMetrics.js';
```

- In `buildExportSummary()`, add:

```js
heatmaps: {
  screen: buildScreenHeatmap(samples, { sampleIntervalMs: recordingSampleIntervalMs, trustedOnly: true }),
  panorama: buildPanoramaHeatmap(samples, { sampleIntervalMs: recordingSampleIntervalMs, trustedOnly: true }),
},
```

**Step 6: Write export tests**

In `tests/recordingExport.test.js`, add an assertion to an existing summary test:

```js
assert.equal(summary.heatmaps.screen.type, 'screen');
assert.equal(summary.heatmaps.panorama.type, 'panorama');
assert.equal(Array.isArray(summary.heatmaps.screen.bins), true);
```

**Step 7: Run export tests**

Run:

```powershell
npm test -- tests/recordingExport.test.js tests/heatmapMetrics.test.js
```

Expected: PASS.

**Step 8: Commit**

```powershell
git add src/recording/heatmapMetrics.js src/recording/recordingExport.js tests/heatmapMetrics.test.js tests/recordingExport.test.js
git commit -m "feat: export AOI heatmap grids"
```

---

### Task 6: Add Normalized Stats Report Builder

**Files:**
- Create: `src/recording/statReport.js`
- Create: `tests/statReport.test.js`
- Modify: `src/recording/recordingExport.js`
- Modify: `tests/recordingExport.test.js`

**Step 1: Write failing report tests**

Create `tests/statReport.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import { buildStatReport } from '../src/recording/statReport.js';

test('builds display-ready AOI stat rows with definitions and caveats', () => {
  const report = buildStatReport({
    namedAoiMetrics: {
      session: {
        totalDurationSec: 10,
        overallProcessingEfficiency: 72,
        averageSaccadeDurationMs: 40,
      },
      perAoi: {
        logo: {
          id: 'logo',
          label: 'Logo',
          totalFixationDurationMs: 500,
          averageFixationDurationMs: 250,
          timeToFirstFixationMs: 300,
          fixationCount: 2,
        },
      },
    },
  });

  assert.equal(report.perAoiRows.length, 1);
  assert.equal(report.perAoiRows[0].aoiId, 'logo');
  assert.ok(report.perAoiRows[0].stats.some((stat) => stat.id === 'totalFixationDurationMs'));
  assert.ok(report.sessionStats.some((stat) => stat.id === 'overallProcessingEfficiency'));
  assert.ok(report.caveats.some((caveat) => caveat.includes('saccade')));
});
```

**Step 2: Run the test to verify it fails**

Run:

```powershell
npm test -- tests/statReport.test.js
```

Expected: FAIL because `statReport.js` does not exist.

**Step 3: Implement report builder**

Create `src/recording/statReport.js`:

```js
import {
  getStatDefinition,
  listStatsByScope,
  STAT_RELIABILITY,
} from './statDefinitions.js';

function hasValue(value) {
  return value !== null && value !== undefined && value !== '';
}

function buildStatValue(id, value) {
  const definition = getStatDefinition(id);

  if (!definition || !hasValue(value)) {
    return null;
  }

  return {
    id,
    label: definition.label,
    value,
    unit: definition.unit,
    reliability: definition.reliability,
    description: definition.description,
  };
}

function buildStatsForScope(scope, source) {
  return listStatsByScope(scope)
    .map((definition) => buildStatValue(definition.id, source?.[definition.id]))
    .filter(Boolean);
}

function buildCaveats(sessionStats) {
  const caveats = [
    'Webcam metrics are bounded by calibration accuracy, stream quality, and AOI size.',
  ];

  if (sessionStats.some((stat) => stat.reliability === STAT_RELIABILITY.EXPERIMENTAL)) {
    caveats.push('Experimental saccade and transition metrics are derived from gaps between detected fixation windows and should not be treated as validated physiology.');
  }

  if (sessionStats.some((stat) => stat.id === 'overallProcessingEfficiency')) {
    caveats.push('Overall processing efficiency is a transparent MVP composite; report the formula and components with the score.');
  }

  return caveats;
}

export function buildStatReport({ namedAoiMetrics = {}, summary = null, exportedAt = null } = {}) {
  const sessionStats = buildStatsForScope('session', namedAoiMetrics.session || {});
  const perAoiRows = Object.values(namedAoiMetrics.perAoi || {}).map((metric) => ({
    aoiId: metric.id,
    label: metric.label,
    stats: buildStatsForScope('perAoi', metric),
  }));

  return {
    exportedAt,
    sessionStats,
    perAoiRows,
    heatmaps: summary?.heatmaps ?? null,
    caveats: buildCaveats(sessionStats),
  };
}
```

**Step 4: Run report tests**

Run:

```powershell
npm test -- tests/statReport.test.js
```

Expected: PASS.

**Step 5: Include report in export payload**

In `src/recording/recordingExport.js`:

- Import:

```js
import { buildStatReport } from './statReport.js';
```

- In `buildExportPayload()`, add:

```js
statReport: buildStatReport({
  namedAoiMetrics,
  summary,
  exportedAt,
}),
```

**Step 6: Add export assertion**

In `tests/recordingExport.test.js`, assert:

```js
assert.equal(typeof payload.statReport, 'object');
assert.equal(Array.isArray(payload.statReport.perAoiRows), true);
assert.equal(Array.isArray(payload.statReport.caveats), true);
```

**Step 7: Run tests**

Run:

```powershell
npm test -- tests/statReport.test.js tests/recordingExport.test.js
```

Expected: PASS.

**Step 8: Commit**

```powershell
git add src/recording/statReport.js src/recording/recordingExport.js tests/statReport.test.js tests/recordingExport.test.js
git commit -m "feat: add normalized AOI stat report"
```

---

### Task 7: Add CSV Export for AOI Stats

**Files:**
- Create: `src/recording/csvExport.js`
- Create: `tests/csvExport.test.js`
- Modify: `index.html`
- Modify: `src/app/dom.js`
- Modify: `src/app/appController.js`
- Modify: `tests/uiSmoke.mjs`

**Step 1: Write failing CSV unit tests**

Create `tests/csvExport.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import { buildAoiStatsCsv } from '../src/recording/csvExport.js';

test('exports AOI stats as CSV with one row per AOI', () => {
  const csv = buildAoiStatsCsv({
    namedAoiMetrics: {
      perAoi: {
        logo: {
          id: 'logo',
          label: 'Logo',
          totalDwellSec: 1.2,
          likelyDwellSec: 1.1,
          fixationCount: 3,
          totalFixationDurationMs: 900,
          averageFixationDurationMs: 300,
          timeToFirstFixationMs: 500,
          firstFixationDurationMs: 250,
          revisitCount: 1,
          percentageOfViewingTime: 12,
        },
      },
    },
  });

  assert.match(csv, /^aoiId,aoiLabel,/);
  assert.match(csv, /logo,Logo,/);
  assert.match(csv, /totalFixationDurationMs/);
});
```

**Step 2: Run the test to verify it fails**

Run:

```powershell
npm test -- tests/csvExport.test.js
```

Expected: FAIL because `csvExport.js` does not exist.

**Step 3: Implement CSV builder**

Create `src/recording/csvExport.js`:

```js
const AOI_CSV_FIELDS = [
  'totalDwellSec',
  'likelyDwellSec',
  'stableDwellSec',
  'fixationCount',
  'totalFixationDurationMs',
  'averageFixationDurationMs',
  'firstFixationDurationMs',
  'timeToFirstFixationMs',
  'revisitCount',
  'percentageOfViewingTime',
  'trustedSampleCount',
  'ambiguousSampleCount',
];

function escapeCsv(value) {
  if (value === null || value === undefined) {
    return '';
  }

  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function buildAoiStatsCsv({ namedAoiMetrics = {} } = {}) {
  const header = ['aoiId', 'aoiLabel', ...AOI_CSV_FIELDS];
  const rows = Object.values(namedAoiMetrics.perAoi || {}).map((metric) => (
    [metric.id, metric.label, ...AOI_CSV_FIELDS.map((field) => metric[field])]
  ));

  return [header, ...rows]
    .map((row) => row.map(escapeCsv).join(','))
    .join('\n');
}
```

**Step 4: Run CSV tests**

Run:

```powershell
npm test -- tests/csvExport.test.js
```

Expected: PASS.

**Step 5: Add UI button**

In `index.html`, near the existing export buttons, add:

```html
<button id="exportStatsCsvButton" type="button">Export Stats CSV</button>
```

In `src/app/dom.js`, add:

```js
exportStatsCsvButton: getRequiredElement(documentRef, '#exportStatsCsvButton'),
```

In `src/app/appController.js`:

- Import:

```js
import { buildAoiStatsCsv } from '../recording/csvExport.js?v=stats-csv-1';
```

- Destructure `exportStatsCsvButton`.
- Add:

```js
function downloadText(payload, fileName, type = 'text/plain') {
  const blob = new Blob([payload], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

function buildCurrentNamedAoiMetrics() {
  const exportAois = withEffectiveAoisAnalysisPadding(activeAois, getViewerAnalysisDimensions());
  return buildNamedAoiMetrics(state.samples, exportAois, {
    sampleIntervalMs: recordingSampleScheduler.intervalMs,
  });
}

function exportStatsCsv() {
  const namedAoiMetrics = buildCurrentNamedAoiMetrics();
  downloadText(
    buildAoiStatsCsv({ namedAoiMetrics }),
    `aoi-stats-${Date.now()}.csv`,
    'text/csv',
  );
}
```

- Refactor `exportSamples()` to call `buildCurrentNamedAoiMetrics()`.
- Register:

```js
exportStatsCsvButton.addEventListener('click', exportStatsCsv);
```

**Step 6: Add UI smoke assertion**

In `tests/uiSmoke.mjs`, assert that `#exportStatsCsvButton` exists and that clicking it triggers a download with `.csv`.

**Step 7: Run tests**

Run:

```powershell
npm test -- tests/csvExport.test.js
npm run test:ui
```

Expected: PASS.

**Step 8: Commit**

```powershell
git add src/recording/csvExport.js tests/csvExport.test.js index.html src/app/dom.js src/app/appController.js tests/uiSmoke.mjs
git commit -m "feat: export AOI stats CSV"
```

---

### Task 8: Add Admin Stats Panel and Heatmap Preview

**Files:**
- Modify: `index.html`
- Modify: `styles.css`
- Modify: `src/app/dom.js`
- Modify: `src/app/appController.js`
- Modify: `tests/uiSmoke.mjs`

**Step 1: Write failing UI smoke tests**

In `tests/uiSmoke.mjs`, after creating or loading sample recording data, add:

```js
await page.waitForSelector('#aoiStatsPanel');
assert.equal(await page.locator('#aoiStatsPanel').isVisible(), true);
assert.ok(await page.locator('#aoiStatsTable tbody tr').count() >= 1);
assert.equal(await page.locator('#heatmapCanvas').isVisible(), true);
```

**Step 2: Run UI test to verify it fails**

Run:

```powershell
npm run test:ui
```

Expected: FAIL because the stats panel and heatmap canvas do not exist.

**Step 3: Add markup**

In `index.html`, add a compact admin panel near the AOI list/export area:

```html
<section id="aoiStatsPanel" class="panel-section admin-panel-section compact-admin-section" data-step="05">
  <div class="section-header">
    <p class="section-label">AOI Stats</p>
    <button id="refreshStatsButton" type="button">Refresh</button>
  </div>
  <div class="stats-table-wrap">
    <table id="aoiStatsTable" class="stats-table">
      <thead>
        <tr>
          <th>AOI</th>
          <th>Dwell</th>
          <th>Fix.</th>
          <th>Avg Fix.</th>
          <th>TTFF</th>
          <th>View %</th>
        </tr>
      </thead>
      <tbody></tbody>
    </table>
  </div>
  <canvas id="heatmapCanvas" class="heatmap-canvas" width="360" height="180" aria-label="Gaze heatmap"></canvas>
</section>
```

**Step 4: Add DOM bindings**

In `src/app/dom.js`, add:

```js
aoiStatsPanel: getRequiredElement(documentRef, '#aoiStatsPanel'),
refreshStatsButton: getRequiredElement(documentRef, '#refreshStatsButton'),
aoiStatsTable: getRequiredElement(documentRef, '#aoiStatsTable'),
heatmapCanvas: getRequiredElement(documentRef, '#heatmapCanvas'),
```

**Step 5: Render stats panel**

In `src/app/appController.js`:

- Import:

```js
import { buildPanoramaHeatmap } from '../recording/heatmapMetrics.js?v=heatmap-1';
```

- Add:

```js
function formatStat(value, suffix = '') {
  return Number.isFinite(value) ? `${value}${suffix}` : '-';
}

function renderAoiStatsPanel() {
  const namedAoiMetrics = buildCurrentNamedAoiMetrics();
  const rows = Object.values(namedAoiMetrics.perAoi || {});
  const tbody = aoiStatsTable.querySelector('tbody');

  tbody.innerHTML = rows.map((metric) => `
    <tr>
      <th scope="row">${metric.label}</th>
      <td>${formatStat(metric.likelyDwellSec, 's')}</td>
      <td>${formatStat(metric.fixationCount)}</td>
      <td>${formatStat(metric.averageFixationDurationMs, 'ms')}</td>
      <td>${formatStat(metric.timeToFirstFixationMs, 'ms')}</td>
      <td>${formatStat(metric.percentageOfViewingTime, '%')}</td>
    </tr>
  `).join('');

  renderHeatmapPreview(buildPanoramaHeatmap(state.samples, {
    sampleIntervalMs: recordingSampleScheduler.intervalMs,
    trustedOnly: true,
    columns: 72,
    rows: 36,
  }));
}

function renderHeatmapPreview(heatmap) {
  const context = heatmapCanvas.getContext('2d');
  const cellWidth = heatmapCanvas.width / heatmap.columns;
  const cellHeight = heatmapCanvas.height / heatmap.rows;
  const maxWeight = Math.max(...heatmap.bins.map((bin) => bin.weightSec), 0);

  context.clearRect(0, 0, heatmapCanvas.width, heatmapCanvas.height);
  heatmap.bins.forEach((bin) => {
    if (!bin.weightSec || !maxWeight) {
      return;
    }
    const alpha = Math.min(0.85, bin.weightSec / maxWeight);
    context.fillStyle = `rgba(252, 119, 83, ${alpha})`;
    context.fillRect(bin.column * cellWidth, bin.row * cellHeight, cellWidth, cellHeight);
  });
}
```

- Call `renderAoiStatsPanel()` after recording stops, after loading a recording, and after export.
- Register:

```js
refreshStatsButton.addEventListener('click', renderAoiStatsPanel);
```

**Step 6: Add CSS**

In `styles.css`, add:

```css
.stats-table-wrap {
  overflow-x: auto;
}

.stats-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.78rem;
}

.stats-table th,
.stats-table td {
  padding: 0.35rem 0.4rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.12);
  text-align: right;
  white-space: nowrap;
}

.stats-table th:first-child,
.stats-table td:first-child {
  text-align: left;
}

.heatmap-canvas {
  width: 100%;
  aspect-ratio: 2 / 1;
  margin-top: 0.75rem;
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: rgba(0, 0, 0, 0.24);
}
```

**Step 7: Run UI test**

Run:

```powershell
npm run test:ui
```

Expected: PASS.

**Step 8: Commit**

```powershell
git add index.html styles.css src/app/dom.js src/app/appController.js tests/uiSmoke.mjs
git commit -m "feat: show AOI stats and heatmap preview"
```

---

### Task 9: Add Participant/Researcher Result Copy and Documentation

**Files:**
- Modify: `README.md`
- Modify: `docs/eye-tracking-benchmark-protocol.md`
- Create: `docs/aoi-stat-definitions.md`

**Step 1: Add stat definitions doc**

Create `docs/aoi-stat-definitions.md`:

```markdown
# AOI Stat Definitions

This app reports AOI metrics from webcam or mouse gaze samples. Webcam-derived metrics depend on calibration accuracy, AOI size, stream quality, and participant stability.

## Recommended Primary Metrics

- `likelyDwellSec`: preferred dwell metric for webcam recordings.
- `stableDwellSec`: stricter dwell metric when AOI stability is available.
- `totalFixationDurationMs`: total fixation duration mapped to each AOI.
- `averageFixationDurationMs`: average fixation duration mapped to each AOI.
- `timeToFirstFixationMs`: milliseconds from recording start to first fixation on each AOI.
- `percentageOfViewingTime`: AOI dwell share of total recording duration.
- `panoramaHeatmap` / `screenHeatmap`: duration-weighted gaze density.

## Secondary Metrics

- `fixationCount`: useful for comparing repeated attention, but noisier than dwell time.
- `revisitCount`: useful for scanpath interpretation.
- `averageNumberOfAoisFixated`: for one recording this is the unique AOI count; average it across participants for study-level reporting.
- `aoiCoveragePercent`: percent of AOIs fixated at least once.

## Experimental Metrics

- `averageSaccadeDurationMs`: derived from gaps between fixation windows. Use for debugging and pilot comparison only.
- `overallProcessingEfficiency`: transparent MVP composite. Always report the formula and components.
```

**Step 2: Update README export section**

In `README.md`, add:

```markdown
The recommended stakeholder output is `statReport.perAoiRows` for table display, `namedAoiMetrics` for raw machine-readable metrics, `summary.heatmaps` for heatmap rendering, and the AOI stats CSV for spreadsheet analysis.
```

**Step 3: Update benchmark protocol**

In `docs/eye-tracking-benchmark-protocol.md`, add a section:

```markdown
## Recommended Reporting Table

For each AOI, report label, likely dwell seconds, total fixation duration, average fixation duration, fixation count, time to first fixation, revisit count, viewing time percent, and ambiguity/trust counts. Include the heatmap image or grid metadata. Keep saccade duration and processing efficiency in an exploratory appendix unless the study protocol validates them.
```

**Step 4: Run documentation-adjacent tests**

Run:

```powershell
npm test
```

Expected: PASS.

**Step 5: Commit**

```powershell
git add README.md docs/eye-tracking-benchmark-protocol.md docs/aoi-stat-definitions.md
git commit -m "docs: define AOI stat reporting"
```

---

### Task 10: Full Verification

**Files:**
- No direct code changes unless verification finds defects.

**Step 1: Run unit tests**

Run:

```powershell
npm test
```

Expected: PASS.

**Step 2: Run browser smoke tests**

Run:

```powershell
npm run test:ui
```

Expected: PASS.

**Step 3: Run local app**

Run:

```powershell
npm run serve
```

Expected: dev server starts at `http://localhost:5179`.

**Step 4: Manual browser checks**

Open:

```text
http://localhost:5179/?mode=admin
http://localhost:5179/?mode=participant
```

Check:

- Admin can record/load sample data and see AOI stats rows.
- Heatmap canvas is nonblank after samples exist.
- JSON export includes `namedAoiMetrics`, `statReport`, and `summary.heatmaps`.
- CSV export downloads one row per AOI.
- Participant mode still hides researcher controls and can export JSON.
- No console errors from app code.

**Step 5: Final commit if verification fixes were needed**

```powershell
git add <changed-files>
git commit -m "test: verify AOI stat system"
```

---

## Implementation Notes

- Use @test-driven-development before editing implementation files.
- Use @frontend-design before Task 8 because it changes visible UI.
- Use @verification-before-completion before claiming the feature is complete.
- Keep existing user changes intact. This repo currently has many modified/untracked files, so review `git status --short` before staging and stage only files touched by this implementation.
- The stat system should prefer `likelyDwellSec` and `stableDwellSec` for webcam results. Exact `totalDwellSec` is best for mouse-mode validation or very accurate webcam runs.
- Do not imply that webcam-derived metrics are equivalent to hardware eye-tracker results. Put reliability labels and caveats in exports, UI, and docs.
