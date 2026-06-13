# UI Separation and Named AOI Metrics Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Split the prototype into clear Admin and Participant modes, then enrich exports with named per-AOI research metrics.

**Architecture:** Keep the single static HTML/JS app and use URL/query-driven mode switching (`?mode=admin` and `?mode=participant`) instead of adding a framework. Participant mode reuses the existing WebGazer calibration, video player, recorder, and exporter, but hides researcher/debug controls behind a concise survey flow. Named metrics are computed from exported gaze samples in a small pure JS analysis module so they are testable outside the browser.

**Tech Stack:** Static HTML/CSS, ES modules, Three.js, WebGazer, Node `node:test`, Playwright smoke tests.

---

### Task 1: Participant/Admin Mode UI Contract

**Files:**
- Modify: `index.html`
- Modify: `styles.css`
- Modify: `src/app.js`
- Test: `tests/uiSmoke.mjs`

**Step 1: Write failing browser smoke tests**

Add checks in `tests/uiSmoke.mjs` that load `?mode=participant` and assert:

```js
await participantPage.goto(`${TARGET_URL}?mode=participant`, { waitUntil: 'networkidle' });
await participantPage.waitForSelector('#participantPanel');
assert.equal(await participantPage.locator('#controlPanel').isVisible(), false);
assert.equal(await participantPage.locator('#participantPanel').isVisible(), true);
assert.equal(await participantPage.locator('#participantStartButton').isEnabled(), false);
```

Then fill participant ID/name/age/consent and assert the start button enables. Also assert the admin/default page still shows `#controlPanel`.

**Step 2: Run failing test**

Run: `npm run test:ui`
Expected: FAIL because `#participantPanel`, `#controlPanel`, and participant controls do not exist yet.

**Step 3: Implement mode structure**

In `index.html`:
- Add IDs to existing researcher panel: `id="controlPanel"`.
- Add top-level mode class support on `<main id="appShell">`.
- Add a compact participant panel with participant ID, name, age, consent checkbox, and a primary start button.
- Add an admin/participant link pair in toolbar.

In `styles.css`:
- Hide `#controlPanel` and timeline/debug readouts in participant mode.
- Make participant mode use a focused full-width viewer layout.
- Keep the existing dark utilitarian visual language.

In `src/app.js`:
- Parse `new URLSearchParams(location.search).get('mode')`.
- Apply `is-participant-mode` / `is-admin-mode` classes.
- Validate participant fields and enable start only when required fields are present.
- Store participant metadata in state for export.
- Participant start should request fullscreen if possible, select webcam mode, and show concise instructions. It should not auto-bypass calibration or recording quality checks.

**Step 4: Run test**

Run: `npm run test:ui`
Expected: PASS for UI mode assertions.

---

### Task 2: Participant Recording Flow

**Files:**
- Modify: `src/app.js`
- Modify: `styles.css`
- Test: `tests/uiSmoke.mjs`

**Step 1: Write failing browser smoke tests**

Extend participant test to assert:

```js
await participantPage.locator('#participantIdInput').fill('P042');
await participantPage.locator('#participantNameInput').fill('Nguyen A');
await participantPage.locator('#participantAgeInput').fill('22');
await participantPage.locator('#participantConsentInput').check();
assert.equal(await participantPage.locator('#participantStartButton').isEnabled(), true);
```

Clicking start should set mode label to webcam and show participant stage text.

**Step 2: Run failing test**

Run: `npm run test:ui`
Expected: FAIL until participant start handler is wired.

**Step 3: Implement flow**

In `src/app.js`:
- Add `participant: { id, name, age, consent, startedAt, mode }` to state.
- Add `collectParticipantMetadata()` and `updateParticipantStartState()`.
- Add `startParticipantSession()` that records metadata, attempts fullscreen on `viewerSection`, calls `setWebcamMode()`, and updates participant status.
- Keep admin controls functionally unchanged.

**Step 4: Run test**

Run: `npm run test:ui`
Expected: PASS.

---

### Task 3: Named AOI Metrics Module

**Files:**
- Create: `src/analysisMetrics.js`
- Create/Modify: `tests/analysisMetrics.test.js`
- Modify: `src/app.js`
- Test: `tests/analysisMetrics.test.js`

**Step 1: Write failing unit tests**

Create `tests/analysisMetrics.test.js` with sample data:

```js
import { buildNamedAoiMetrics } from '../src/analysisMetrics.js';

test('builds named per-AOI dwell and fixation metrics', () => {
  const aois = [{ id: 'logo', label: 'Logo' }, { id: 'product', label: 'Product' }];
  const samples = [
    { t: 0, hits: ['logo'], likelyHits: ['logo'], possibleHits: [], ambiguousHits: [], activeAois: aois },
    { t: 0.15, hits: ['logo'], likelyHits: ['logo'], possibleHits: [], ambiguousHits: [], activeAois: aois },
    { t: 0.3, hits: ['product'], likelyHits: ['product'], possibleHits: [], ambiguousHits: [], activeAois: aois },
    { t: 0.45, hits: [], likelyHits: [], possibleHits: ['product'], ambiguousHits: ['product'], activeAois: aois },
  ];
  const metrics = buildNamedAoiMetrics(samples, aois);
  assert.equal(metrics.perAoi.logo.label, 'Logo');
  assert.equal(metrics.perAoi.logo.hitCount, 2);
  assert.equal(metrics.perAoi.logo.fixationCount >= 1, true);
  assert.equal(metrics.perAoi.product.possibleSampleCount, 1);
});
```

**Step 2: Run failing test**

Run: `npm test -- tests/analysisMetrics.test.js`
Expected: FAIL because `src/analysisMetrics.js` does not exist.

**Step 3: Implement minimal metrics**

In `src/analysisMetrics.js`, export:
- `buildNamedAoiMetrics(samples, aois)`
- Helper functions for sample durations, AOI label map, and simple consecutive-AOI fixation grouping.

Metrics should include:
- `perAoi[id].id`
- `label`
- `hitCount`
- `likelyHitCount`
- `possibleSampleCount`
- `ambiguousSampleCount`
- `totalDwellSec`
- `likelyDwellSec`
- `firstHitSec`
- `timeToFirstFixationMs`
- `fixationCount`
- `averageFixationDurationMs`
- `percentageOfViewingTime`

Also include session-level:
- `totalFixations`
- `averageFixationDurationMs`
- `averageNumberOfAoisFixated`
- `aoiCoveragePercent`
- `overallProcessingEfficiency`

**Step 4: Run unit tests**

Run: `npm test -- tests/analysisMetrics.test.js`
Expected: PASS.

---

### Task 4: Export Integration

**Files:**
- Modify: `src/app.js`
- Modify: `tests/uiSmoke.mjs`
- Test: `npm run test:ui`

**Step 1: Write failing export assertions**

In `tests/uiSmoke.mjs`, after export JSON parse, assert:

```js
assert.equal(typeof exportedJson.namedAoiMetrics, 'object');
assert.equal(exportedJson.namedAoiMetrics.perAoi['sidecar-center'].label, 'Sidecar center AOI');
assert.equal(typeof exportedJson.namedAoiMetrics.perAoi['sidecar-center'].totalDwellSec, 'number');
assert.equal(typeof exportedJson.namedAoiMetrics.session.averageFixationDurationMs, 'number');
assert.equal(exportedJson.participant, null);
```

Participant export should include participant metadata when recorded through participant mode.

**Step 2: Run failing test**

Run: `npm run test:ui`
Expected: FAIL because export payload does not include `namedAoiMetrics` or participant metadata.

**Step 3: Integrate metrics**

In `src/app.js`:
- `import { buildNamedAoiMetrics } from './analysisMetrics.js?v=ui-modes-1';`
- Add `participant: getExportParticipantMetadata()` to export payload.
- Add `namedAoiMetrics: buildNamedAoiMetrics(state.samples, activeAois)`.
- Optionally mirror key session metrics into `summary.namedAoiMetrics` only if it stays non-duplicative.

**Step 4: Run test**

Run: `npm run test:ui`
Expected: PASS.

---

### Task 5: Verification and Docs

**Files:**
- Modify: `README.md`
- Test: all tests

**Step 1: Update README**

Document:
- `http://localhost:5179/?mode=admin`
- `http://localhost:5179/?mode=participant`
- Participant fields and fullscreen behavior.
- New `namedAoiMetrics` export section.
- Webcam metric caveat: fixation/saccade-style metrics are approximations for MVP webcam tracking.

**Step 2: Run verification**

Run:
```powershell
npm test
npm run test:ui
```
Expected: all tests pass.

**Step 3: Browser verification**

Open/reload:
- `http://localhost:5179/?mode=admin`
- `http://localhost:5179/?mode=participant`

Confirm admin controls are visible in admin mode, participant form is visible in participant mode, and no console errors from app code.
