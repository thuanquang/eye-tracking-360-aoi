# Analytics Mode Heatmap Overlay Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Show AOI stats only after an admin recording is stopped or a recording JSON is loaded, switch those actions into a stats-focused analytics mode, remove the sidebar heatmap card, and render a polished gaze heatmap directly over the player.

**Architecture:** Keep existing metric computation and `buildAoiStatsViewModel()` intact. Add a small analytics presentation state in `src/app/appController.js` that controls when stats render and toggles an `is-analytics-mode` class on the app shell. Move heatmap rendering from the sidebar canvas to a transparent player overlay canvas that is redrawn from the active stat sample source. Use existing viewer projection helpers for screen/video/panorama coordinate mapping.

**Tech Stack:** Static HTML/CSS, browser ES modules, Three.js viewer, existing AOI/math helpers, Node `node:test`, Playwright smoke tests.

---

## Product Behavior

- Stats are hidden during setup, AOI authoring, calibration, idle recording controls, and active recording.
- Stopping an admin recording with samples enters analytics mode and displays stats for `state.samples`.
- Loading a recording JSON enters analytics mode and displays stats for `state.reviewSamples`.
- Analytics mode turns the sidebar into a results surface: summary, top AOI cards, detail table, and compact result actions only.
- The sidebar heatmap card is removed.
- A transparent heatmap canvas appears inside `#viewer` only in analytics mode.
- Starting a new recording, clearing samples, or pressing "Back to controls" exits analytics mode and clears/hides the overlay.
- Participant mode does not unexpectedly expose the admin analytics sidebar unless the app is already in admin mode.

---

## Current Integration Points

- `index.html`
  - Viewer markup: `#viewer`, `#aoiOverlay`, `#gazeDot`, `#viewerNotice`
  - Stats markup: `#aoiStatsPanel`, `#aoiStatsSummary`, `#aoiStatsCards`, `#aoiStatsDetails`, `#aoiStatsTable`
  - Existing sidebar heatmap to remove: `#heatmapCanvas`, `.aoi-heatmap-panel`
- `src/app/dom.js`
  - Replace `heatmapCanvas` lookup with `gazeHeatmapOverlay`
  - Add analytics action lookup if a new button is introduced
- `src/app/appController.js`
  - Current stat source: `activeStatsSampleSource`
  - Recording stop path: `setRecordingActive(false)` via `toggleRecording()`
  - JSON load path: `registerRecording(json, source)`
  - Existing stats render: `renderAoiStatsPanel()`
  - Existing sidebar heatmap render to remove: `drawHeatmapPreview(samples)`
  - Existing projection helpers: `panoramaPointToScreen()`, `screenPointToVideoPoint()`, `getCurrentVideoRect()`, `getViewerScreenDimensions()`
- `styles.css`
  - Existing player stack: `.viewer`, `.aoi-overlay`, `.gaze-dot`, `.viewer-notice`
  - Existing stats styles around `.aoi-stats-*`
  - Existing sidebar heatmap styles to remove: `.aoi-heatmap-*`, `.heatmap-preview`

---

## Task 1: Lock DOM And Layout Expectations First

**Files:**
- Modify: `tests/appDom.test.js`
- Modify: `tests/responsiveLayout.test.js`
- Modify or create: `tests/appControllerSource.test.js`

**TDD Step 1: Write failing DOM selector coverage**

Update `tests/appDom.test.js`:

- Replace `#heatmapCanvas` in `APP_SELECTORS` with `#gazeHeatmapOverlay`.
- Add `#exitAnalyticsButton` if the implementation adds a dedicated Back to controls button.
- Assert `dom.gazeHeatmapOverlay.selector === '#gazeHeatmapOverlay'`.
- Assert no `dom.heatmapCanvas` access remains.

Expected initial failure:

```powershell
node --test tests/appDom.test.js
```

Expected result before implementation: FAIL because `queryAppDom()` still requires `#heatmapCanvas`.

**TDD Step 2: Write failing layout/source assertions**

Update `tests/responsiveLayout.test.js` or add a focused test file if this file is already too broad:

- `index.html` contains `<canvas id="gazeHeatmapOverlay"` inside `<div id="viewer"`.
- `index.html` does not contain `id="heatmapCanvas"` or `class="aoi-heatmap-panel"`.
- `styles.css` contains `.gaze-heatmap-overlay`.
- `styles.css` contains `.app-shell.is-analytics-mode`.
- `styles.css` hides non-result admin panels in analytics mode.

If `tests/appControllerSource.test.js` is used, assert source-level guardrails:

- `enterAnalyticsMode(` exists.
- `exitAnalyticsMode(` exists.
- `setRecordingActive(false)` or the recording stop path calls `enterAnalyticsMode('live')` only when admin samples exist.
- `registerRecording(` calls `enterAnalyticsMode('review')`.
- `drawHeatmapPreview` and `heatmapCanvas` no longer exist in `src/app/appController.js`.

Run:

```powershell
node --test tests/appDom.test.js tests/responsiveLayout.test.js tests/appControllerSource.test.js
```

Expected result before implementation: FAIL on the new analytics/overlay expectations.

---

## Task 2: Move Heatmap Canvas Into The Player DOM

**Files:**
- Modify: `index.html`
- Modify: `src/app/dom.js`
- Modify: `tests/appDom.test.js`

**Implementation Steps:**

1. Insert the heatmap overlay canvas inside `#viewer`, before `#aoiOverlay`:

```html
<canvas id="gazeHeatmapOverlay" class="gaze-heatmap-overlay" aria-hidden="true"></canvas>
```

2. Remove the sidebar heatmap panel:

```html
<div class="aoi-heatmap-panel">...</div>
```

3. Keep `#aoiStatsCards` as the only visual ranked-result area inside `.aoi-results-main`.

4. Update `src/app/dom.js`:

```js
gazeHeatmapOverlay: getRequiredElement(documentRef, '#gazeHeatmapOverlay'),
```

5. Remove:

```js
heatmapCanvas: getRequiredElement(documentRef, '#heatmapCanvas'),
```

**Verification:**

```powershell
node --test tests/appDom.test.js
```

Expected: PASS after implementation.

---

## Task 3: Add Analytics Mode State And Sidebar Clearing

**Files:**
- Modify: `index.html`
- Modify: `src/app/appController.js`
- Modify: `src/app/dom.js`
- Modify: `styles.css`
- Modify: `tests/responsiveLayout.test.js`
- Modify or create: `tests/appControllerSource.test.js`

**Implementation Steps:**

1. Add a compact analytics action row inside `#aoiStatsPanel`.

Recommended controls:

- `#exitAnalyticsButton` with text `Back to controls`
- Keep `#refreshStatsButton` only if it remains useful after loaded AOIs change
- Keep export actions available in analytics mode by moving existing JSON/CSV buttons into a result action area or styling the existing action row so only export/clear remain visible

2. Add analytics state in `src/app/appController.js` near `activeStatsSampleSource`:

```js
let analyticsMode = null;
```

Use values:

- `null`
- `'live'`
- `'review'`

3. Add helpers:

```js
function hasSamplesForAnalytics(source = activeStatsSampleSource) {
  const samples = source === 'review' ? state.reviewSamples : state.samples;
  return Array.isArray(samples) && samples.length > 0;
}

function enterAnalyticsMode(source) {
  if (state.appMode !== 'admin' || !hasSamplesForAnalytics(source)) {
    return;
  }

  analyticsMode = source;
  activeStatsSampleSource = source;
  appShell.classList.add('is-analytics-mode');
  aoiStatsPanel.hidden = false;
  renderAoiStatsPanel();
  drawGazeHeatmapOverlay(getActiveStatsSamples());
}

function exitAnalyticsMode({ clearOverlay = true } = {}) {
  analyticsMode = null;
  appShell.classList.remove('is-analytics-mode');
  if (clearOverlay) {
    clearGazeHeatmapOverlay();
  }
}
```

4. Gate stats rendering:

- `renderAoiStatsPanel()` should return early or render an empty hidden panel when `analyticsMode === null`.
- Export functions may still build stats from the active source, but they should not force stats visible by calling `renderAoiStatsPanel()` unless analytics is active.

5. Update trigger points:

- In `setRecordingActive(true)`: call `exitAnalyticsMode()`, set source to `live`.
- In the stop-recording path, after `state.isRecording = false`, call `enterAnalyticsMode('live')` when admin samples exist.
- In `registerRecording(json, source)`: after `state.reviewSamples` and `state.reviewSource` are set, call `enterAnalyticsMode('review')`.
- In `clearSamples()`: call `exitAnalyticsMode()`, clear sample counters, and clear the overlay.
- In `startReviewMode()`: keep `activeStatsSampleSource = 'review'`; do not make review playback the only way stats appear.
- In `toggleReviewMode()` stop path: do not exit analytics for loaded JSON unless the user explicitly presses Back/Clear.
- Wire `exitAnalyticsButton.addEventListener('click', () => exitAnalyticsMode())`.

6. Add CSS for stats-only sidebar:

```css
.app-shell.is-analytics-mode #adminWorkflowRail,
.app-shell.is-analytics-mode #controlPanel > .panel-section:not(#adminRecordingPanel),
.app-shell.is-analytics-mode #adminRecordingPanel > :not(#aoiStatsPanel) {
  display: none;
}

.app-shell.is-analytics-mode #adminRecordingPanel {
  display: grid;
  gap: 12px;
}
```

Adjust selectors to match the final markup. The important behavior is: no setup, AOI, calibration, readout, or raw recording controls are visible in the sidebar while analytics mode is active.

**Verification:**

```powershell
node --test tests/appDom.test.js tests/responsiveLayout.test.js tests/appControllerSource.test.js
```

Expected: PASS for the new analytics source/layout tests.

---

## Task 4: Render A Polished Player Heatmap Overlay

**Files:**
- Modify: `src/app/appController.js`
- Modify: `styles.css`
- Modify or create: `tests/appControllerSource.test.js`
- Optional create: `src/recording/playerHeatmapOverlay.js`
- Optional create: `tests/playerHeatmapOverlay.test.js`

**Implementation Steps:**

1. Destructure `gazeHeatmapOverlay` from the DOM bundle.

2. Add overlay canvas sizing:

```js
function syncGazeHeatmapOverlaySize() {
  const dimensions = getViewerScreenDimensions();
  const pixelRatio = window.devicePixelRatio || 1;
  gazeHeatmapOverlay.width = Math.max(1, Math.round(dimensions.width * pixelRatio));
  gazeHeatmapOverlay.height = Math.max(1, Math.round(dimensions.height * pixelRatio));
  gazeHeatmapOverlay.style.width = `${dimensions.width}px`;
  gazeHeatmapOverlay.style.height = `${dimensions.height}px`;
  return { width: dimensions.width, height: dimensions.height, pixelRatio };
}
```

3. Convert samples to overlay points.

Use this priority:

- If `sample.screen.x/y` exists, use it directly when it is inside the viewer.
- Else if `sample.video.x/y` exists for flat projection, use `videoPointToScreenPoint(sample.video, getCurrentVideoRect())`.
- Else if `sample.panorama.yaw/pitch` exists, use `panoramaPointToScreen({ yaw, pitch, width, height, camera: { yaw: state.cameraYaw, pitch: state.cameraPitch, fov: camera.fov } })`.
- Skip points outside the visible player.
- Weight each point by `sample.durationMs`, `sample.weightMs`, or `recordingSampleScheduler.intervalMs`.
- Prefer trusted/stable gaze samples, but fall back to any usable loaded sample so a JSON load still gives visual feedback.

4. Draw the heatmap:

- Clear transparent canvas.
- Use soft radial gradients, not grid cells.
- Use a restrained color ramp, for example cool teal at low density, amber at mid density, coral at high density.
- Draw with alpha so AOIs and the video remain readable.
- Composite density first if needed, then colorize or draw layered gradients.
- Cap max per-point opacity so dense files do not become a solid rectangle.

5. Add overlay CSS:

```css
.gaze-heatmap-overlay {
  position: absolute;
  inset: 0;
  z-index: 2;
  width: 100%;
  height: 100%;
  opacity: 0;
  pointer-events: none;
  mix-blend-mode: screen;
  transition: opacity 160ms ease;
}

.app-shell.is-analytics-mode .gaze-heatmap-overlay {
  opacity: 0.78;
}
```

Also make the render canvas stack explicit:

```css
.viewer > canvas:not(.gaze-heatmap-overlay) {
  position: absolute;
  inset: 0;
  z-index: 1;
}
```

Keep `.aoi-overlay` above the heatmap and `.gaze-dot` above AOIs.

6. Redraw triggers:

- After `enterAnalyticsMode()`
- After `renderAoiStatsPanel()` when analytics is active
- After viewer resize
- After camera yaw/pitch changes while analytics is active
- After review playback sample/camera updates if review mode is playing

7. Remove old panorama grid heatmap code:

- Remove `buildPanoramaHeatmap` import from `src/app/appController.js` if nothing else uses it.
- Remove `drawHeatmapEmptyState()`.
- Remove `drawHeatmapPreview()`.

**Verification:**

```powershell
node --test tests/appDom.test.js tests/responsiveLayout.test.js tests/appControllerSource.test.js
```

Expected: PASS.

If `playerHeatmapOverlay.js` is extracted:

```powershell
node --test tests/playerHeatmapOverlay.test.js
```

Expected: PASS for screen, flat-video, panorama, out-of-bounds, and weighting cases.

---

## Task 5: Browser Smoke The End-To-End Modes

**Files:**
- Modify: `tests/uiSmoke.mjs`
- Optional modify: `tests/responsiveLayout.test.js`

**Implementation Steps:**

1. Extend the UI smoke flow to create or load enough sample data to trigger stats.

2. Assert after stopping an admin recording:

- `#appShell` has `is-analytics-mode`.
- `#aoiStatsPanel` is visible.
- `#aoiStatsCards` has at most 10 `.aoi-stat-card` children.
- `#controlPanel` does not show setup/AOI/calibration panels.
- `#gazeHeatmapOverlay` is visible in the viewer.
- Canvas pixel probe finds non-transparent overlay pixels when samples exist.

3. Assert after loading a recording JSON:

- `#appShell` has `is-analytics-mode`.
- Summary values use loaded review samples.
- Sidebar heatmap canvas does not exist.
- Player heatmap overlay exists and redraws after a resize or reset view.

4. Assert when pressing Back to controls:

- `#appShell` no longer has `is-analytics-mode`.
- Non-result admin controls are visible again.
- Heatmap overlay is transparent or cleared.

**Verification:**

Run focused checks first:

```powershell
node --test tests/appDom.test.js tests/responsiveLayout.test.js tests/aoiStatsViewModel.test.js tests/appControllerSource.test.js
```

Expected: PASS.

Then run the browser smoke:

```powershell
npm run test:ui
```

Expected: PASS on a clean branch. If this fails on pre-existing validation/tracker assertions, record the exact failing unrelated test and still keep the focused analytics checks passing.

---

## Task 6: Final Verification And Commit

**Files:**
- Review all files changed by this plan only.

**Commands:**

```powershell
git status --short
node --test tests/appDom.test.js tests/responsiveLayout.test.js tests/aoiStatsViewModel.test.js tests/appControllerSource.test.js
npm run test:ui
```

Expected:

- Focused Node tests PASS.
- UI smoke PASS, or any failure is confirmed as an existing unrelated validation/tracker issue with exact test name and output.

**Manual Browser Check:**

```powershell
npm run serve
```

Open the served localhost URL and check:

- Before recording: no stats sidebar and no heatmap overlay.
- Stop recording: sidebar switches to analytics results and the player has a soft gaze heatmap overlay.
- Load recording JSON: sidebar switches to analytics results and the player overlay appears.
- Back to controls: normal sidebar returns and overlay clears.
- Large AOI files: only the top 10 AOI cards are highlighted; the detail table still contains all AOIs.

**Commit:**

Only stage files touched by this plan. Do not stage unrelated dirty files already present in the worktree.

```powershell
git add index.html styles.css src/app/dom.js src/app/appController.js tests/appDom.test.js tests/responsiveLayout.test.js tests/appControllerSource.test.js tests/uiSmoke.mjs
git add src/recording/playerHeatmapOverlay.js tests/playerHeatmapOverlay.test.js
git commit -m "Show AOI analytics after completed runs"
```

If optional files were not created, omit them from `git add`.

---

## Risks And Practical Choices

- Loaded JSON may contain screen samples, panorama samples, video samples, or a mix. The overlay renderer must gracefully use whichever coordinate type is available.
- Panorama heatmap overlay depends on the current camera view; redraw on camera movement so the heatmap follows what is visible.
- Very dense sessions can make a canvas unreadable. Clamp opacity and sample stride if needed, but do not drop points from metric calculations.
- Analytics mode should not remove export access. Keep JSON/CSV export and clear/back actions available in the results panel.
- Do not fix unrelated validation/tracker test failures in this implementation unless they directly block analytics verification.
