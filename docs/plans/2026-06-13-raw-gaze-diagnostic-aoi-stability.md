# Raw Gaze Diagnostic and AOI Stability Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a raw WebGazer diagnostic mode and an AOI stability mode so the app can distinguish unusable raw gaze from usable coarse AOI evidence, and stop pretending noisy webcam gaze is precise.

**Architecture:** Raw gaze diagnostics run as a separate target flow that collects uncorrected WebGazer samples with video/AOI distractions minimized, then reports jitter, bias, sample rate, stale rate, and dropped-rate metrics. AOI stability runs during preview/recording as a temporal evidence layer over existing AOI classifications, so exported research metrics can use stable/probable AOI dwell instead of frame-by-frame cursor hits. The tracker remains swappable: if diagnostics show WebGazer is below threshold even on a blank scene, the next phase replaces the gaze provider rather than adding more calibration.

**Tech Stack:** Plain JavaScript ES modules, Node test runner, Playwright smoke tests, existing WebGazer provider, existing AOI math/classification modules.

---

## Context and Constraints

The current symptoms are:

- Raw gaze is already noisy before Check Accuracy.
- Validation can be gamed by retrying unstable targets until a lucky sample window passes.
- Cursor smoothness is not a reliable research goal. AOI dwell and fixation-style metrics are the deliverable.

Relevant external context:

- [WebGazer](https://webgazer.cs.brown.edu/) and [jsPsych's WebGazer notes](https://www.jspsych.org/v7/overview/eye-tracking/) both describe the model as webcam feature detection plus regression from known screen locations.
- The original [WebGazer IJCAI paper](https://www.ijcai.org/Proceedings/16/Papers/540.pdf) frames this as scalable browser webcam tracking, not hardware-grade tracking.
- AOI analysis can be made more robust than point-level gaze through dwell and AOI-level aggregation; see the AOI noise-robust research overview at [PMC5101255](https://pmc.ncbi.nlm.nih.gov/articles/PMC5101255/).
- Fixation/dwell logic should use duration and dispersion ideas rather than one-frame hits; a concise I-DT description is available from [WorldViz SightLab](https://help.worldviz.com/sightlab/eye-tracking-metrics/).

Current repo constraints:

- Do **not** auto-commit. The user must test before any commit.
- Preserve existing exported fields for compatibility. Add new fields rather than replacing `hits`, `likelyHits`, or `possibleHits`.
- Do not touch unrelated AOI/video work except where this plan explicitly integrates with samples or export metadata.
- Prefer TDD. Each task below starts with a failing test.

## Success Criteria

Raw diagnostic mode:

- Runs from Admin calibration panel.
- Uses 5 fixed targets: center, top, bottom, left, right.
- Does not train WebGazer and does not apply app-side correction.
- Reports per-target and session metrics:
  - `sampleCount`
  - `effectiveHz`
  - `missingRate`
  - `medianJitterPx`
  - `p90JitterPx`
  - `biasPx`
  - `p90BiasPx`
  - `quality`: `good`, `coarse`, or `unusable`
- Export payload includes the latest diagnostic result.

AOI stability mode:

- Keeps existing point/cursor classifications.
- Adds temporal AOI evidence with hysteresis.
- Exports `stableHits`, `candidateAois`, `aoiStability`, and `trustedForAoiAnalysis`.
- Metrics prefer `stableHits` for stable dwell, while retaining legacy hit counts.

Decision rules:

- If raw diagnostic quality is `unusable`, block recording and show a clear reason.
- If raw diagnostic quality is `coarse`, allow recording only with uncertainty-heavy AOI metrics.
- If raw diagnostic quality is `good`, current validation and AOI stability can run normally.

---

### Task 1: Raw Diagnostic Math Core

**Files:**
- Create: `src/gaze/rawGazeDiagnostics.js`
- Test: `tests/rawGazeDiagnostics.test.js`

**Step 1: Write the failing test**

Create `tests/rawGazeDiagnostics.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  summarizeDiagnosticTarget,
  summarizeRawGazeDiagnostic,
} from '../src/gaze/rawGazeDiagnostics.js';

const TARGET = { x: 500, y: 300 };

test('summarizes stable raw gaze target samples', () => {
  const result = summarizeDiagnosticTarget({
    target: TARGET,
    samples: [
      { x: 498, y: 301, atMs: 0 },
      { x: 502, y: 299, atMs: 33 },
      { x: 501, y: 300, atMs: 66 },
      { x: 499, y: 300, atMs: 99 },
    ],
    durationMs: 132,
  });

  assert.equal(result.sampleCount, 4);
  assert.equal(result.quality, 'good');
  assert.ok(result.medianJitterPx < 3);
  assert.ok(result.biasPx < 3);
  assert.ok(result.effectiveHz > 20);
});

test('marks high jitter diagnostic sessions unusable', () => {
  const noisyTarget = summarizeDiagnosticTarget({
    target: TARGET,
    samples: [
      { x: 300, y: 200, atMs: 0 },
      { x: 700, y: 420, atMs: 33 },
      { x: 280, y: 450, atMs: 66 },
      { x: 720, y: 180, atMs: 99 },
    ],
    durationMs: 132,
  });

  const summary = summarizeRawGazeDiagnostic({
    targets: [noisyTarget, noisyTarget, noisyTarget],
  });

  assert.equal(summary.quality, 'unusable');
  assert.equal(summary.shouldBlockRecording, true);
  assert.match(summary.reason, /jitter/i);
});
```

**Step 2: Run test to verify it fails**

Run:

```bash
node --test tests/rawGazeDiagnostics.test.js
```

Expected: FAIL with module not found.

**Step 3: Write minimal implementation**

Create `src/gaze/rawGazeDiagnostics.js`:

```js
function finitePoint(point) {
  return Number.isFinite(point?.x) && Number.isFinite(point?.y);
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function percentile(values, ratio) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const index = (sorted.length - 1) * Math.min(1, Math.max(0, ratio));
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

function meanPoint(points) {
  const total = points.reduce((sum, point) => ({
    x: sum.x + point.x,
    y: sum.y + point.y,
  }), { x: 0, y: 0 });

  return {
    x: total.x / points.length,
    y: total.y / points.length,
  };
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function qualityForTarget({ medianJitterPx, p90JitterPx, biasPx, effectiveHz, missingRate }) {
  if (
    effectiveHz < 15 ||
    missingRate > 0.35 ||
    medianJitterPx > 70 ||
    p90JitterPx > 140 ||
    biasPx > 220
  ) {
    return 'unusable';
  }

  if (
    effectiveHz < 22 ||
    missingRate > 0.2 ||
    medianJitterPx > 35 ||
    p90JitterPx > 80 ||
    biasPx > 140
  ) {
    return 'coarse';
  }

  return 'good';
}

export function summarizeDiagnosticTarget({
  target,
  samples = [],
  durationMs = 0,
  expectedSampleCount = null,
} = {}) {
  const finiteSamples = samples.filter(finitePoint);
  const center = finiteSamples.length ? meanPoint(finiteSamples) : null;
  const jitter = center ? finiteSamples.map((sample) => distance(sample, center)) : [];
  const sampleCount = finiteSamples.length;
  const effectiveHz = durationMs > 0 ? (sampleCount / durationMs) * 1000 : 0;
  const expected = Number.isFinite(expectedSampleCount) && expectedSampleCount > 0
    ? expectedSampleCount
    : sampleCount;
  const missingRate = expected > 0 ? Math.max(0, 1 - sampleCount / expected) : 1;
  const medianJitterPx = median(jitter) ?? Infinity;
  const p90JitterPx = percentile(jitter, 0.9) ?? Infinity;
  const biasPx = center && finitePoint(target) ? distance(center, target) : Infinity;

  return {
    target,
    sampleCount,
    durationMs,
    effectiveHz,
    missingRate,
    center,
    medianJitterPx,
    p90JitterPx,
    biasPx,
    quality: qualityForTarget({
      medianJitterPx,
      p90JitterPx,
      biasPx,
      effectiveHz,
      missingRate,
    }),
  };
}

function worstQuality(qualities) {
  if (qualities.includes('unusable')) return 'unusable';
  if (qualities.includes('coarse')) return 'coarse';
  return 'good';
}

export function summarizeRawGazeDiagnostic({ targets = [] } = {}) {
  const medianJitterPx = median(targets.map((target) => target.medianJitterPx)) ?? Infinity;
  const p90JitterPx = percentile(targets.map((target) => target.p90JitterPx), 0.9) ?? Infinity;
  const p90BiasPx = percentile(targets.map((target) => target.biasPx), 0.9) ?? Infinity;
  const effectiveHz = median(targets.map((target) => target.effectiveHz)) ?? 0;
  const missingRate = median(targets.map((target) => target.missingRate)) ?? 1;
  const quality = worstQuality(targets.map((target) => target.quality));
  const shouldBlockRecording = quality === 'unusable';
  const reason = shouldBlockRecording
    ? `Raw gaze jitter ${Math.round(p90JitterPx)}px is too high for recording.`
    : quality === 'coarse'
      ? `Raw gaze is coarse: p90 jitter ${Math.round(p90JitterPx)}px.`
      : 'Raw gaze diagnostic passed.';

  return {
    targetCount: targets.length,
    quality,
    shouldBlockRecording,
    reason,
    medianJitterPx,
    p90JitterPx,
    p90BiasPx,
    effectiveHz,
    missingRate,
    targets,
  };
}
```

**Step 4: Run test to verify it passes**

Run:

```bash
node --test tests/rawGazeDiagnostics.test.js
```

Expected: PASS.

**Step 5: Checkpoint**

Do not commit unless the user explicitly asks. Note modified files.

---

### Task 2: Raw Diagnostic State and Constants

**Files:**
- Modify: `src/app/constants.js`
- Modify: `src/app/state.js`
- Test: `tests/appConstants.test.js`
- Test: `tests/appState.test.js`

**Step 1: Write the failing tests**

Update `tests/appConstants.test.js`:

```js
import {
  RAW_GAZE_DIAGNOSTIC,
} from '../src/app/constants.js';

test('exports raw gaze diagnostic thresholds', () => {
  assert.deepEqual(RAW_GAZE_DIAGNOSTIC.targets.map((target) => target.id), [
    'center',
    'top',
    'bottom',
    'left',
    'right',
  ]);
  assert.equal(RAW_GAZE_DIAGNOSTIC.samplesPerTarget, 45);
  assert.equal(RAW_GAZE_DIAGNOSTIC.sampleDelayMs, 33);
});
```

Update `tests/appState.test.js` inside `creates fresh app state without shared mutable arrays`:

```js
first.rawGazeDiagnostic.targets.push({ id: 'x' });
assert.deepEqual(second.rawGazeDiagnostic.targets, []);
assert.equal(second.rawGazeDiagnostic.latestSummary, null);
```

**Step 2: Run test to verify it fails**

Run:

```bash
node --test tests/appConstants.test.js tests/appState.test.js
```

Expected: FAIL because `RAW_GAZE_DIAGNOSTIC` and `rawGazeDiagnostic` do not exist.

**Step 3: Write minimal implementation**

In `src/app/constants.js` add:

```js
export const RAW_GAZE_DIAGNOSTIC = {
  samplesPerTarget: 45,
  sampleDelayMs: 33,
  settleDelayMs: 300,
  targets: [
    { id: 'center', label: 'Center', x: 50, y: 50 },
    { id: 'top', label: 'Top', x: 50, y: 20 },
    { id: 'bottom', label: 'Bottom', x: 50, y: 80 },
    { id: 'left', label: 'Left', x: 20, y: 50 },
    { id: 'right', label: 'Right', x: 80, y: 50 },
  ],
};
```

In `src/app/state.js` add:

```js
rawGazeDiagnostic: {
  active: false,
  index: 0,
  targets: [],
  latestSummary: null,
},
```

Place it near other gaze/validation state.

**Step 4: Run test to verify it passes**

Run:

```bash
node --test tests/appConstants.test.js tests/appState.test.js
```

Expected: PASS.

**Step 5: Checkpoint**

Do not commit unless explicitly asked.

---

### Task 3: Raw Diagnostic UI Controls

**Files:**
- Modify: `index.html`
- Modify: `src/app/dom.js`
- Modify: `styles.css`
- Test: `tests/appDom.test.js`
- Test: `tests/uiSmoke.mjs`

**Step 1: Write the failing DOM test**

Update `tests/appDom.test.js` selector list:

```js
'#rawGazeDiagnosticButton',
'#rawGazeDiagnosticStatus',
```

Add assertions:

```js
assert.equal(dom.rawGazeDiagnosticButton.selector, '#rawGazeDiagnosticButton');
assert.equal(dom.rawGazeDiagnosticStatus.selector, '#rawGazeDiagnosticStatus');
```

**Step 2: Run test to verify it fails**

Run:

```bash
node --test tests/appDom.test.js
```

Expected: FAIL because selectors are missing.

**Step 3: Add UI**

In `index.html`, inside `#adminCalibrationPanel`, below Check Accuracy:

```html
<div class="button-pair">
  <button id="rawGazeDiagnosticButton" class="wide-action" type="button">Diagnose Raw Gaze</button>
</div>
<p id="rawGazeDiagnosticStatus" class="fine-print">Raw gaze diagnostic not run.</p>
```

In `src/app/dom.js`, add:

```js
rawGazeDiagnosticButton: getRequiredElement(documentRef, '#rawGazeDiagnosticButton'),
rawGazeDiagnosticStatus: getRequiredElement(documentRef, '#rawGazeDiagnosticStatus'),
```

In `styles.css`, reuse existing `.fine-print`; only add styling if layout breaks:

```css
#rawGazeDiagnosticStatus {
  min-height: 2.4em;
}
```

**Step 4: Run DOM and UI smoke**

Run:

```bash
node --test tests/appDom.test.js
npm run test:ui
```

Expected: PASS.

**Step 5: Checkpoint**

Do not commit unless explicitly asked.

---

### Task 4: Raw Diagnostic App Flow

**Files:**
- Modify: `src/app/appController.js`
- Test: `tests/rawGazeDiagnosticSmoke.mjs`
- Modify: `package.json`

**Step 1: Write failing smoke test**

Create `tests/rawGazeDiagnosticSmoke.mjs`:

```js
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

import { startCalibrationOrKnownFakeCameraBoundary } from './webcamSmokeHelpers.mjs';

const TARGET_URL = process.env.AOI_PROTOTYPE_URL || 'http://127.0.0.1:5179';

function urlWithMode(mode) {
  const url = new URL(TARGET_URL);
  url.searchParams.set('mode', mode);
  return url.toString();
}

const browser = await chromium.launch({
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
});
const context = await browser.newContext({
  permissions: ['camera'],
  viewport: { width: 1366, height: 900 },
});
const page = await context.newPage();

try {
  await page.goto(urlWithMode('admin'), { waitUntil: 'networkidle' });
  await page.waitForFunction(() => Boolean(window.webgazer?.setGazeListener));
  await page.evaluate(() => {
    window.webgazer.setGazeListener = (callback) => {
      window.__aoiGazeListener = callback;
      return window.webgazer;
    };

    window.__aoiEmitGazeForCurrentTarget = (durationMs = 2200) => new Promise((resolve) => {
      const target = document.querySelector('#calibrationTarget').getBoundingClientRect();
      const gaze = {
        x: target.left + target.width / 2,
        y: target.top + target.height / 2,
      };
      const startedAt = performance.now();
      const emit = () => window.__aoiGazeListener?.(gaze, performance.now() - startedAt);
      emit();
      const interval = window.setInterval(emit, 20);
      window.setTimeout(() => {
        window.clearInterval(interval);
        resolve();
      }, durationMs);
    });
  });

  if (await startCalibrationOrKnownFakeCameraBoundary(page, {
    skipMessage: 'Known fake-camera WebGazer startup boundary.',
  })) {
    process.exit(0);
  }

  await page.locator('#cancelCalibrationButton').click();
  await page.locator('#rawGazeDiagnosticButton').click();
  await page.waitForSelector('#calibrationOverlay:not([hidden])', { timeout: 45000 });

  for (let index = 0; index < 5; index += 1) {
    await Promise.all([
      page.evaluate(() => window.__aoiEmitGazeForCurrentTarget()),
      page.locator('#calibrationTarget').click(),
    ]);
    if (index < 4) {
      await page.waitForFunction(
        (targetIndex) => document.querySelector('#calibrationProgress')?.textContent?.startsWith(`Raw gaze ${targetIndex + 2}`),
        index,
        { timeout: 30000 },
      );
    }
  }

  await page.waitForFunction(() => document.querySelector('#calibrationOverlay')?.hidden === true);
  const metadata = await page.evaluate(() => window.__aoiGetRuntimeQualityMetadata?.());
  assert.equal(metadata.rawGazeDiagnostic.latestSummary.quality, 'good');
  assert.match(await page.locator('#rawGazeDiagnosticStatus').innerText(), /good/i);
} finally {
  await browser.close();
}
```

Update `package.json`:

```json
"test:raw-diagnostic": "node tests/rawGazeDiagnosticSmoke.mjs"
```

**Step 2: Run smoke to verify it fails**

Run:

```bash
npm run test:raw-diagnostic
```

Expected: FAIL because UI button flow is not wired.

**Step 3: Implement app flow**

In `src/app/appController.js`, import:

```js
import { summarizeDiagnosticTarget, summarizeRawGazeDiagnostic } from '../gaze/rawGazeDiagnostics.js';
```

Import constants:

```js
RAW_GAZE_DIAGNOSTIC,
```

Destructure DOM:

```js
rawGazeDiagnosticButton,
rawGazeDiagnosticStatus,
```

Add helpers near calibration/accuracy target helpers:

```js
function getRawDiagnosticTargetPoint() {
  return RAW_GAZE_DIAGNOSTIC.targets[state.rawGazeDiagnostic.index];
}

function setRawDiagnosticStatus(summary = null) {
  if (!summary) {
    rawGazeDiagnosticStatus.textContent = 'Raw gaze diagnostic not run.';
    return;
  }

  rawGazeDiagnosticStatus.textContent = `${summary.quality}: p90 jitter ${Math.round(summary.p90JitterPx)}px, p90 bias ${Math.round(summary.p90BiasPx)}px, Hz ${Math.round(summary.effectiveHz)}.`;
}

function positionRawDiagnosticTarget() {
  const point = getRawDiagnosticTargetPoint();
  calibrationTarget.style.setProperty('--target-x', `${point.x}%`);
  calibrationTarget.style.setProperty('--target-y', `${point.y}%`);
  calibrationProgress.textContent = `Raw gaze ${state.rawGazeDiagnostic.index + 1} of ${RAW_GAZE_DIAGNOSTIC.targets.length}`;
  calibrationDescription.textContent = 'Look at the target, then click it. This measures raw WebGazer noise without training.';
}
```

Add start function:

```js
async function startRawGazeDiagnostic() {
  stopActiveRecordingForTargetMode();
  await setWebcamMode();
  if (!state.webcamStarted) return;

  state.targetMode = 'raw-diagnostic';
  state.rawGazeDiagnostic = {
    active: true,
    index: 0,
    targets: [],
    latestSummary: null,
  };
  pauseVideoForTargetMode();
  setCalibrationProfileSelectLocked(true);
  setValidationPolicySelectLocked(true);
  calibrationOverlay.hidden = false;
  setWebcamStatus('diagnosing');
  setRawDiagnosticStatus(null);
  positionRawDiagnosticTarget();
}
```

Add capture function:

```js
async function captureRawDiagnosticPoint() {
  if (state.targetCaptureInProgress) return;

  setTargetCapturing(true, 'Measuring raw gaze noise. Keep looking at the target.');
  const rect = calibrationTarget.getBoundingClientRect();
  const viewerRect = viewer.getBoundingClientRect();
  const target = {
    x: rect.left + rect.width / 2 - viewerRect.left,
    y: rect.top + rect.height / 2 - viewerRect.top,
  };
  const samples = [];
  const startedAt = performance.now();

  await delay(RAW_GAZE_DIAGNOSTIC.settleDelayMs);

  for (let index = 0; index < RAW_GAZE_DIAGNOSTIC.samplesPerTarget; index += 1) {
    if (Number.isFinite(state.rawViewerGaze?.x) && Number.isFinite(state.rawViewerGaze?.y)) {
      samples.push({
        x: state.rawViewerGaze.x,
        y: state.rawViewerGaze.y,
        atMs: performance.now() - startedAt,
      });
    }
    await delay(RAW_GAZE_DIAGNOSTIC.sampleDelayMs);
  }

  const durationMs = performance.now() - startedAt;
  state.rawGazeDiagnostic.targets.push(summarizeDiagnosticTarget({
    target,
    samples,
    durationMs,
    expectedSampleCount: RAW_GAZE_DIAGNOSTIC.samplesPerTarget,
  }));
  state.rawGazeDiagnostic.index += 1;
  setTargetCapturing(false);

  if (state.rawGazeDiagnostic.index >= RAW_GAZE_DIAGNOSTIC.targets.length) {
    const summary = summarizeRawGazeDiagnostic({
      targets: state.rawGazeDiagnostic.targets,
    });
    state.rawGazeDiagnostic.latestSummary = summary;
    state.rawGazeDiagnostic.active = false;
    calibrationOverlay.hidden = true;
    setCalibrationProfileSelectLocked(false);
    setValidationPolicySelectLocked(false);
    setWebcamStatus('calibrated');
    setRawDiagnosticStatus(summary);
    setNotice(summary.reason, summary.quality !== 'good');
    await restoreVideoAfterTargetMode();
    return;
  }

  positionRawDiagnosticTarget();
}
```

Update `handleTargetClick`:

```js
if (state.targetMode === 'raw-diagnostic') {
  await captureRawDiagnosticPoint();
  return;
}
```

Update runtime metadata:

```js
window.__aoiGetRuntimeQualityMetadata = () => ({
  faceQuality: getFaceQualityRuntimeMetadata(),
  rawGazeDiagnostic: state.rawGazeDiagnostic,
});
```

Add event listener in `init()`:

```js
rawGazeDiagnosticButton.addEventListener('click', startRawGazeDiagnostic);
```

**Step 4: Run tests**

Run:

```bash
node --test tests/rawGazeDiagnostics.test.js tests/appDom.test.js
npm run test:raw-diagnostic
```

Expected: PASS.

**Step 5: Checkpoint**

Do not commit unless explicitly asked.

---

### Task 5: Recording Gate Based on Diagnostic Quality

**Files:**
- Modify: `src/app/appController.js`
- Test: `tests/rawGazeDiagnostics.test.js`
- Test: `tests/rawGazeDiagnosticSmoke.mjs`

**Step 1: Write failing unit test**

Add to `tests/rawGazeDiagnostics.test.js`:

```js
test('allows coarse diagnostics with uncertainty warning but blocks unusable diagnostics', () => {
  const coarse = summarizeRawGazeDiagnostic({
    targets: [{
      quality: 'coarse',
      medianJitterPx: 45,
      p90JitterPx: 90,
      biasPx: 120,
      effectiveHz: 20,
      missingRate: 0.1,
    }],
  });
  const unusable = summarizeRawGazeDiagnostic({
    targets: [{
      quality: 'unusable',
      medianJitterPx: 90,
      p90JitterPx: 180,
      biasPx: 260,
      effectiveHz: 10,
      missingRate: 0.5,
    }],
  });

  assert.equal(coarse.shouldBlockRecording, false);
  assert.equal(unusable.shouldBlockRecording, true);
});
```

**Step 2: Run to verify behavior**

Run:

```bash
node --test tests/rawGazeDiagnostics.test.js
```

Expected: PASS if Task 1 already models this. If it passes immediately, it is a characterization test for integration.

**Step 3: Block recording when diagnostic is unusable**

In `src/app/appController.js`, inside `toggleRecording()` before recording starts:

```js
const rawDiagnostic = state.rawGazeDiagnostic.latestSummary;
if (state.mode === 'webcam' && rawDiagnostic?.shouldBlockRecording) {
  setNotice(`${rawDiagnostic.reason} Recording blocked.`, true);
  return;
}
```

For `coarse`, do not block, but set sample quality later.

**Step 4: Extend smoke**

Add a second helper in `tests/rawGazeDiagnosticSmoke.mjs` that emits alternating far-apart samples and verifies:

```js
assert.match(await page.locator('#viewerNotice').innerText(), /blocked|jitter/i);
```

**Step 5: Run**

Run:

```bash
npm run test:raw-diagnostic
```

Expected: PASS.

---

### Task 6: AOI Stability Core

**Files:**
- Create: `src/aois/aoiStability.js`
- Test: `tests/aoiStability.test.js`

**Step 1: Write failing tests**

Create `tests/aoiStability.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createAoiStabilityState,
  updateAoiStability,
} from '../src/aois/aoiStability.js';

test('promotes an AOI after repeated likely evidence', () => {
  let state = createAoiStabilityState();

  for (let index = 0; index < 5; index += 1) {
    state = updateAoiStability(state, {
      classification: {
        likelyHits: [{ id: 'sign', label: 'Sign' }],
        possibleHits: [{ id: 'sign', label: 'Sign' }],
        ambiguousHits: [],
      },
      dtMs: 33,
      uncertaintyPx: 60,
      rawQuality: 'coarse',
    });
  }

  assert.deepEqual(state.stableHits.map((hit) => hit.id), ['sign']);
  assert.equal(state.trustedForAoiAnalysis, true);
});

test('keeps ambiguous one-frame hits as candidates without trusting them', () => {
  const state = updateAoiStability(createAoiStabilityState(), {
    classification: {
      likelyHits: [],
      possibleHits: [{ id: 'person', label: 'Person' }],
      ambiguousHits: [{ id: 'person', label: 'Person' }],
    },
    dtMs: 33,
    uncertaintyPx: 180,
    rawQuality: 'coarse',
  });

  assert.deepEqual(state.stableHits, []);
  assert.equal(state.candidateAois[0].id, 'person');
  assert.equal(state.trustedForAoiAnalysis, false);
});
```

**Step 2: Run test to verify it fails**

Run:

```bash
node --test tests/aoiStability.test.js
```

Expected: FAIL with module not found.

**Step 3: Implement AOI stability**

Create `src/aois/aoiStability.js`:

```js
const DEFAULTS = {
  likelyGainPerSec: 7,
  possibleGainPerSec: 2.5,
  decayPerSec: 5,
  enterThreshold: 0.75,
  exitThreshold: 0.25,
  maxTrustedUncertaintyPx: 160,
};

function uniqueById(items = []) {
  const byId = new Map();
  items.forEach((item) => {
    if (typeof item?.id === 'string' && item.id) {
      byId.set(item.id, item);
    }
  });
  return [...byId.values()];
}

export function createAoiStabilityState() {
  return {
    scores: {},
    stableIds: [],
    stableHits: [],
    candidateAois: [],
    trustedForAoiAnalysis: false,
  };
}

function clampScore(value) {
  return Math.max(0, Math.min(1, value));
}

export function updateAoiStability(previous = createAoiStabilityState(), {
  classification = {},
  dtMs = 33,
  uncertaintyPx = 0,
  rawQuality = 'good',
  options = {},
} = {}) {
  const config = { ...DEFAULTS, ...options };
  const dtSec = Math.max(0, dtMs) / 1000;
  const likely = uniqueById(classification.likelyHits || []);
  const possible = uniqueById(classification.possibleHits || []);
  const all = uniqueById([...likely, ...possible, ...(classification.ambiguousHits || [])]);
  const likelyIds = new Set(likely.map((hit) => hit.id));
  const possibleIds = new Set(possible.map((hit) => hit.id));
  const allIds = new Set(all.map((hit) => hit.id));
  const scores = {};

  Object.entries(previous.scores || {}).forEach(([id, score]) => {
    const gain = likelyIds.has(id)
      ? config.likelyGainPerSec * dtSec
      : possibleIds.has(id)
        ? config.possibleGainPerSec * dtSec
        : -config.decayPerSec * dtSec;
    scores[id] = clampScore(score + gain);
  });

  all.forEach((hit) => {
    if (!(hit.id in scores)) {
      scores[hit.id] = 0;
    }
    const gain = likelyIds.has(hit.id)
      ? config.likelyGainPerSec * dtSec
      : config.possibleGainPerSec * dtSec;
    scores[hit.id] = clampScore(scores[hit.id] + gain);
  });

  const stableIds = Object.entries(scores)
    .filter(([id, score]) => {
      const wasStable = previous.stableIds?.includes(id);
      return wasStable ? score >= config.exitThreshold : score >= config.enterThreshold;
    })
    .map(([id]) => id);
  const hitById = new Map(all.map((hit) => [hit.id, hit]));
  const stableHits = stableIds
    .map((id) => hitById.get(id) || { id, label: id })
    .filter((hit) => allIds.has(hit.id) || previous.stableIds?.includes(hit.id));
  const candidateAois = all
    .map((hit) => ({ ...hit, score: scores[hit.id] || 0 }))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const trustedForAoiAnalysis = (
    stableHits.length > 0 &&
    rawQuality !== 'unusable' &&
    uncertaintyPx <= config.maxTrustedUncertaintyPx
  );

  return {
    scores,
    stableIds,
    stableHits,
    candidateAois,
    trustedForAoiAnalysis,
  };
}
```

**Step 4: Run test**

Run:

```bash
node --test tests/aoiStability.test.js
```

Expected: PASS.

---

### Task 7: Integrate AOI Stability Into Live App State

**Files:**
- Modify: `src/app/state.js`
- Modify: `src/app/appController.js`
- Test: `tests/appState.test.js`
- Test: `tests/uiSmoke.mjs`

**Step 1: Write failing state test**

In `tests/appState.test.js`:

```js
first.aoiStability.scores.sign = 1;
assert.deepEqual(second.aoiStability, {
  scores: {},
  stableIds: [],
  stableHits: [],
  candidateAois: [],
  trustedForAoiAnalysis: false,
});
```

**Step 2: Run to verify fail**

Run:

```bash
node --test tests/appState.test.js
```

Expected: FAIL.

**Step 3: Add state and app integration**

In `src/app/state.js`, add:

```js
aoiStability: {
  scores: {},
  stableIds: [],
  stableHits: [],
  candidateAois: [],
  trustedForAoiAnalysis: false,
},
lastAoiStabilityAt: 0,
```

In `src/app/appController.js`, import:

```js
import { createAoiStabilityState, updateAoiStability } from '../aois/aoiStability.js';
```

Add helper near `updateReadout()`:

```js
function getCurrentRawDiagnosticQuality() {
  return state.rawGazeDiagnostic.latestSummary?.quality || 'good';
}

function updateCurrentAoiStability(classification, now = performance.now()) {
  const dtMs = state.lastAoiStabilityAt > 0 ? now - state.lastAoiStabilityAt : RECORDING_SAMPLE_INTERVAL_MS;
  state.lastAoiStabilityAt = now;
  state.aoiStability = updateAoiStability(state.aoiStability || createAoiStabilityState(), {
    classification,
    dtMs,
    uncertaintyPx: state.latestUncertainty?.px || 0,
    rawQuality: getCurrentRawDiagnosticQuality(),
  });
}
```

In `updateReadout()`, after classification is calculated:

```js
updateCurrentAoiStability(classification);
```

When AOIs change or recording clears:

```js
state.aoiStability = createAoiStabilityState();
state.lastAoiStabilityAt = 0;
```

**Step 4: Run focused tests**

Run:

```bash
node --test tests/appState.test.js tests/aoiStability.test.js
```

Expected: PASS.

---

### Task 8: Export Stable AOI Evidence Per Sample

**Files:**
- Modify: `src/recording/sampleBuilder.js`
- Modify: `src/app/appController.js`
- Test: `tests/recordingExport.test.js`
- Test: `tests/sampleBuilder.test.js` if present, otherwise add assertions to `tests/recordingExport.test.js`

**Step 1: Write failing sample test**

Add a test near recording sample tests:

```js
test('builds recording samples with stable AOI evidence', () => {
  const sample = buildRecordingSample({
    timeSec: 1,
    source: 'webcam',
    gaze: { x: 10, y: 20 },
    camera: { yaw: 0, pitch: 0, fov: 75 },
    panorama: { yaw: 1, pitch: 2 },
    stableHits: [{ id: 'sign', label: 'Sign' }],
    aoiStability: {
      candidateAois: [{ id: 'sign', score: 0.9 }],
      trustedForAoiAnalysis: true,
    },
  });

  assert.deepEqual(sample.stableHits, ['sign']);
  assert.equal(sample.quality.trustedForAoiAnalysis, true);
  assert.equal(sample.aoiStability.candidateAois[0].score, 0.9);
});
```

**Step 2: Run to verify fail**

Run:

```bash
npm test -- tests/recordingExport.test.js
```

If the project command cannot target a single test file, run:

```bash
node --test tests/recordingExport.test.js
```

Expected: FAIL because `stableHits` is ignored.

**Step 3: Extend sample builder**

In `src/recording/sampleBuilder.js`, update signature:

```js
stableHits = [],
aoiStability = null,
```

Return fields:

```js
stableHits: getIds(stableHits),
aoiStability: aoiStability ? {
  candidateAois: Array.isArray(aoiStability.candidateAois)
    ? aoiStability.candidateAois.map((candidate) => ({ ...candidate }))
    : [],
  trustedForAoiAnalysis: Boolean(aoiStability.trustedForAoiAnalysis),
} : null,
```

Update `quality` before returning:

```js
const sampleQuality = buildSampleQuality(quality, gazeStreamQuality);
if (aoiStability) {
  sampleQuality.trustedForAoiAnalysis = Boolean(aoiStability.trustedForAoiAnalysis);
}
```

Use `sampleQuality` in the return.

In `src/app/appController.js`, where `buildRecordingSample()` is called, pass:

```js
stableHits: state.aoiStability.stableHits,
aoiStability: state.aoiStability,
```

**Step 4: Run tests**

Run:

```bash
node --test tests/recordingExport.test.js tests/aoiStability.test.js
```

Expected: PASS.

---

### Task 9: Metrics Prefer Stable Hits

**Files:**
- Modify: `src/recording/analysisMetrics.js`
- Test: `tests/analysisMetrics.test.js`

**Step 1: Write failing metric test**

Add:

```js
test('uses stable AOI hits for trusted dwell metrics when present', () => {
  const metrics = buildNamedAoiMetrics([
    {
      t: 0,
      hits: ['noisy-frame-hit'],
      stableHits: ['sign'],
      likelyHits: [],
      possibleHits: [],
      quality: { trustedForAoiAnalysis: true },
    },
    {
      t: 0.033,
      hits: [],
      stableHits: ['sign'],
      likelyHits: [],
      possibleHits: [],
      quality: { trustedForAoiAnalysis: true },
    },
  ], [
    { id: 'sign', label: 'Sign' },
    { id: 'noisy-frame-hit', label: 'Noisy' },
  ]);

  assert.equal(metrics.perAoi.sign.stableDwellSec > 0, true);
  assert.equal(metrics.perAoi.sign.stableHitCount, 2);
});
```

**Step 2: Run to verify fail**

Run:

```bash
node --test tests/analysisMetrics.test.js
```

Expected: FAIL because stable dwell fields do not exist.

**Step 3: Extend metrics**

In `createAoiMetric()` add:

```js
stableHitCount: 0,
stableDwellSec: 0,
trustedSampleCount: 0,
```

In sample loop:

```js
const stableHits = uniqueValues(sample.stableHits || []);
const trusted = Boolean(sample.quality?.trustedForAoiAnalysis);

stableHits.forEach((id) => {
  if (!perAoi[id]) {
    perAoi[id] = createAoiMetric({ id, label: id });
  }
  perAoi[id].stableHitCount += 1;
  perAoi[id].stableDwellSec += duration;
  if (trusted) {
    perAoi[id].trustedSampleCount += 1;
  }
});
```

Round in final metric normalization:

```js
metric.stableDwellSec = roundNumber(metric.stableDwellSec);
```

**Step 4: Run**

Run:

```bash
node --test tests/analysisMetrics.test.js
```

Expected: PASS.

---

### Task 10: Export Diagnostic and Stable AOI Metadata

**Files:**
- Modify: `src/recording/recordingExport.js`
- Test: `tests/recordingExport.test.js`

**Step 1: Write failing export test**

Add:

```js
test('exports raw gaze diagnostic and stable AOI metadata', () => {
  const summary = buildExportSummary([], {
    rawGazeDiagnostic: {
      latestSummary: { quality: 'coarse', p90JitterPx: 88 },
    },
    aoiStability: {
      trustedForAoiAnalysis: true,
    },
  });

  assert.equal(summary.rawGazeDiagnostic.quality, 'coarse');
  assert.equal(summary.aoiStability.trustedForAoiAnalysis, true);
});
```

**Step 2: Run to verify fail**

Run:

```bash
node --test tests/recordingExport.test.js
```

Expected: FAIL.

**Step 3: Implement export cloning**

In `src/recording/recordingExport.js`, add:

```js
function cloneRawGazeDiagnostic(rawGazeDiagnostic) {
  const summary = rawGazeDiagnostic?.latestSummary ?? rawGazeDiagnostic;
  return summary && typeof summary === 'object'
    ? structuredClone(summary)
    : null;
}

function cloneAoiStability(aoiStability) {
  return aoiStability && typeof aoiStability === 'object'
    ? structuredClone(aoiStability)
    : null;
}
```

Add to `buildExportSummary()`:

```js
rawGazeDiagnostic: cloneRawGazeDiagnostic(stateLike.rawGazeDiagnostic),
aoiStability: cloneAoiStability(stateLike.aoiStability),
```

Add to `buildExportPayload()`:

```js
rawGazeDiagnostic: cloneRawGazeDiagnostic(state.rawGazeDiagnostic ?? summary?.rawGazeDiagnostic),
aoiStability: cloneAoiStability(state.aoiStability ?? summary?.aoiStability),
```

Add to `benchmark` metadata only if needed:

```js
rawGazeDiagnosticQuality: cloneRawGazeDiagnostic(stateLike.rawGazeDiagnostic)?.quality ?? null,
```

Keep benchmark compact. Do not embed full per-target samples inside `benchmark`.

**Step 4: Run**

Run:

```bash
node --test tests/recordingExport.test.js
```

Expected: PASS.

---

### Task 11: Runtime Readout for Debugging

**Files:**
- Modify: `index.html`
- Modify: `src/app/dom.js`
- Modify: `src/app/appController.js`
- Test: `tests/appDom.test.js`
- Test: `tests/uiSmoke.mjs`

**Step 1: Write failing DOM test**

Add selector:

```js
'#gazeQualityReadout',
```

Assert:

```js
assert.equal(dom.gazeQualityReadout.selector, '#gazeQualityReadout');
```

**Step 2: Run fail**

Run:

```bash
node --test tests/appDom.test.js
```

Expected: FAIL.

**Step 3: Add UI readout**

In `index.html`, inside Live Readout `<dl>` add:

```html
<div>
  <dt>Gaze Quality</dt>
  <dd id="gazeQualityReadout">--</dd>
</div>
```

In `src/app/dom.js` add:

```js
gazeQualityReadout: getRequiredElement(documentRef, '#gazeQualityReadout'),
```

In `src/app/appController.js`, destructure `gazeQualityReadout`, then in `updateReadout()`:

```js
const rawDiagnostic = state.rawGazeDiagnostic.latestSummary;
const held = state.gaze.held ? 'held' : 'live';
const drop = state.gazeDropReason || 'ok';
gazeQualityReadout.textContent = rawDiagnostic
  ? `${rawDiagnostic.quality}, ${held}, ${drop}, p90 jitter ${Math.round(rawDiagnostic.p90JitterPx)}px`
  : `${held}, ${drop}`;
```

**Step 4: Run**

Run:

```bash
node --test tests/appDom.test.js
npm run test:ui
```

Expected: PASS.

---

### Task 12: Full Verification

**Files:**
- No production edits unless previous tasks reveal failures.

**Step 1: Run unit suite**

Run:

```bash
npm test
```

Expected: all tests pass.

**Step 2: Run browser smoke checks**

Run:

```bash
npm run test:ui
npm run test:raw-diagnostic
npm run test:calibration-quality
npm run test:runtime-stale
```

Expected: all pass or known fake-camera boundary skip is reported by existing helpers.

**Step 3: Manual user test**

Manual flow:

1. Hard refresh browser.
2. Open Admin mode.
3. Click `Diagnose Raw Gaze`.
4. Complete 5 targets without spamming.
5. Record the diagnostic status text.
6. If quality is `unusable`, do not run Check Accuracy. Try blank background and lower video load only as a diagnostic.
7. If quality is `coarse`, run calibration and record a short clip. Export JSON.
8. Inspect exported `stableHits`, `aoiStability`, `rawGazeDiagnostic`, and `trustedForAoiAnalysis`.

Expected:

- A bad raw tracker is labeled bad before recording.
- Coarse raw tracking can still produce uncertainty-heavy stable AOI metrics.
- The app does not claim precision when the raw stream is too noisy.

---

## Follow-Up If Diagnostic Shows WebGazer Is Still Unusable

Do not keep adding calibration profiles. Start a new plan for a gaze-provider swap.

Candidate architecture:

- Keep `createWebGazerProvider` as one implementation.
- Add a provider interface contract in `src/gaze/providers/providerContract.js`.
- Add a new provider backed by a different browser model or external local service.
- Preserve app-side diagnostic, validation, AOI stability, and export fields.

The diagnostic and AOI stability work above should remain useful even after replacing WebGazer.
