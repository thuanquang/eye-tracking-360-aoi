import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { chromium } from 'playwright';
import { RECORDING_SAMPLE_INTERVAL_MS } from '../src/app/constants.js';
import {
  STUDY_VIDEOS,
  getGeneratedAoiPathForStudyVideo,
} from '../src/app/studyVideos.js';

const TARGET_URL = process.env.AOI_PROTOTYPE_URL || 'http://127.0.0.1:5179';
const SMOKE_FLAT_STUDY_VIDEO = STUDY_VIDEOS.find((video) => video.projection === 'flat');
const SMOKE_PANORAMA_STUDY_VIDEO = STUDY_VIDEOS.find((video) => video.projection === 'equirectangular');
if (!SMOKE_FLAT_STUDY_VIDEO || !SMOKE_PANORAMA_STUDY_VIDEO) {
  throw new Error('UI smoke requires at least one flat and one equirectangular study video.');
}
const SMOKE_FLAT_GENERATED_AOI_SOURCE = getGeneratedAoiPathForStudyVideo(SMOKE_FLAT_STUDY_VIDEO);
const SMOKE_PANORAMA_GENERATED_AOI_SOURCE = getGeneratedAoiPathForStudyVideo(SMOKE_PANORAMA_STUDY_VIDEO);

function urlWithMode(mode) {
  const url = new URL(TARGET_URL);
  url.searchParams.set('mode', mode);
  return url.toString();
}

function hasColorVariance(samples) {
  const uniqueColors = new Set();

  for (let index = 0; index < samples.length; index += 4) {
    const alpha = samples[index + 3];
    if (alpha === 0) {
      continue;
    }

    uniqueColors.add(`${samples[index]},${samples[index + 1]},${samples[index + 2]}`);
    if (uniqueColors.size > 12) {
      return true;
    }
  }

  return false;
}

async function recordMouseExport(page, viewerBox) {
  if (await page.locator('#appShell').evaluate((shell) => shell.classList.contains('is-analytics-mode'))) {
    await page.locator('#exitAnalyticsButton').click();
  }

  if (!(await page.locator('#recordButton').isVisible()) && await page.locator('#adminWorkflowRail a[href="#adminRecordingPanel"]').isVisible()) {
    await page.locator('#adminWorkflowRail a[href="#adminRecordingPanel"]').click();
  }

  await page.locator('#recordButton').scrollIntoViewIfNeeded();
  await page.mouse.move(viewerBox.x + viewerBox.width / 2, viewerBox.y + viewerBox.height / 2);
  await page.locator('#recordButton').click();
  await page.waitForFunction(() => document.querySelector('#sampleCount')?.textContent !== '0');
  await page.locator('#recordButton').click();
  await page.waitForFunction(() => document.querySelector('#appShell')?.classList.contains('is-analytics-mode'));

  const downloadPromise = page.waitForEvent('download');
  await page.locator('#analyticsExportButton').click();
  const download = await downloadPromise;

  return JSON.parse(await readFile(await download.path(), 'utf8'));
}

async function getSvgHandleScreenPoint(page, handle) {
  const overlayBox = await page.locator('#aoiOverlay').boundingBox();
  assert.notEqual(overlayBox, null, 'AOI overlay should have a screen box for vertex dragging.');
  const point = await handle.evaluate((element) => ({
    x: Number(element.getAttribute('cx')),
    y: Number(element.getAttribute('cy')),
  }));
  assert.equal(Number.isFinite(point.x), true, 'Vertex handle should expose a finite SVG cx.');
  assert.equal(Number.isFinite(point.y), true, 'Vertex handle should expose a finite SVG cy.');

  return {
    x: overlayBox.x + point.x,
    y: overlayBox.y + point.y,
    svgX: point.x,
    svgY: point.y,
  };
}

const browser = await chromium.launch();
const page = await browser.newPage({
  acceptDownloads: true,
  viewport: { width: 1366, height: 900 },
});
const consoleErrors = [];
const pageErrors = [];

page.on('console', (message) => {
  if (message.type() === 'error') {
    consoleErrors.push(message.text());
  }
});
page.on('pageerror', (error) => {
  pageErrors.push(error.message);
});

try {
  await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__aoiAppReady));
  assert.equal(await page.locator('#modeSelectScreen').isVisible(), true, 'Root URL should show the mode selection screen.');
  assert.equal(await page.locator('#viewerSection').isVisible(), false, 'Root URL should wait for a workflow choice.');
  assert.equal(await page.locator('#controlPanel').isVisible(), false, 'Root URL should not show admin controls until Admin mode is selected.');

  await page.goto(urlWithMode('admin'), { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#viewer canvas:not(.gaze-heatmap-overlay)');
  await page.waitForFunction(() => Boolean(window.__aoiAppReady));
  await page.waitForFunction(() => document.querySelector('#sourceVideo')?.readyState >= 1);
  assert.equal(await page.locator('#modeSelectScreen').isVisible(), false, 'Admin URL should skip the mode selection screen.');
  assert.equal(await page.locator('#viewerSection').isVisible(), true, 'Admin URL should enter the viewer.');
  assert.equal(await page.locator('#controlPanel').isVisible(), true, 'Admin URL should show admin controls.');
  assert.equal(
    await page.evaluate(() => Boolean(window.__aoiAppReady)),
    true,
    'App controller should expose a test-only readiness marker after initialization.',
  );

  const hasContent = await page.evaluate(() => document.body.innerText.trim().length > 0);
  assert.equal(hasContent, true, 'Page body should contain visible UI text.');
  assert.equal(await page.locator('#controlPanel').isVisible(), true, 'Admin controls should be visible by default.');
  assert.equal(await page.locator('#participantPanel').isVisible(), false, 'Participant panel should be hidden in admin mode.');
  assert.equal(await page.locator('#adminWorkflowRail').isVisible(), true, 'Admin should expose a researcher workflow rail.');
  assert.deepEqual(
    await page.locator('#adminWorkflowRail .admin-flow-step').evaluateAll((steps) => (
      steps.map((step) => step.getAttribute('href'))
    )),
    ['#adminSetupPanel', '#manualAoiPanel', '#adminCalibrationPanel', '#adminRecordingPanel', '#adminAoiListPanel'],
    'Admin workflow should show the expected setup order.',
  );
  assert.equal(await page.locator('#adminSetupPanel').isVisible(), true, 'Admin setup controls should be grouped in the first workflow panel.');
  assert.equal(await page.locator('#adminCalibrationPanel').isVisible(), true, 'Admin calibration controls should be grouped separately from video setup.');
  assert.equal(await page.locator('#adminRecordingPanel').isVisible(), true, 'Admin recording/export controls should be grouped in one workflow panel.');
  assert.equal(
    await page.locator('#webcamModeButton').evaluate((button) => button.classList.contains('is-active')),
    true,
    'Admin should start in webcam gaze mode.',
  );
  assert.match(await page.locator('#screenReadout').innerText(), /waiting for webcam gaze|--/);
  await page.locator('#manualAoiPanel').scrollIntoViewIfNeeded();
  await assert.doesNotReject(
    page.locator('#manualAoiPanel').waitFor({ state: 'visible', timeout: 1000 }),
    'Admin should expose manual AOI authoring controls.',
  );
  assert.equal(
    await page.locator('#cloudAoiPanel').count(),
    0,
    'Admin should not expose Google Colab auto-AOI controls.',
  );
  await page.locator('#adminWorkflowRail a[href="#manualAoiPanel"]').click();
  assert.equal(
    await page.locator('#adminWorkflowRail a[aria-current="step"]').innerText(),
    '02 AOIS',
    'Admin workflow should mark AOIs selected after clicking the AOI step.',
  );
  await page.locator('#projectionSelect').scrollIntoViewIfNeeded();
  await assert.doesNotReject(
    page.locator('#projectionSelect').waitFor({ state: 'visible', timeout: 1000 }),
    'Admin should expose video projection metadata controls.',
  );
  await page.locator('#exportStatsCsvButton').scrollIntoViewIfNeeded();
  await assert.doesNotReject(
    page.locator('#exportStatsCsvButton').waitFor({ state: 'visible', timeout: 1000 }),
    'Admin should expose AOI stats CSV export.',
  );
  assert.equal(
    await page.locator('#aoiStatsPanel').isVisible(),
    false,
    'Admin should hide AOI stats until a recording stops or JSON is loaded.',
  );
  assert.equal(
    await page.locator('#heatmapCanvas').count(),
    0,
    'Admin should not render a sidebar heatmap preview.',
  );
  assert.equal(
    await page.locator('#gazeHeatmapOverlay').count(),
    1,
    'Admin should mount the heatmap overlay in the player.',
  );
  const participantPage = await browser.newPage({
    viewport: { width: 1366, height: 900 },
  });
  await participantPage.goto(urlWithMode('participant'), { waitUntil: 'domcontentloaded' });
  await participantPage.waitForSelector('#participantPanel');
  assert.equal(await participantPage.locator('#controlPanel').isVisible(), false, 'Research controls should be hidden in participant mode.');
  assert.equal(await participantPage.locator('#participantPanel').isVisible(), true, 'Participant panel should be visible in participant mode.');
  assert.equal(await participantPage.locator('#viewerSection').isVisible(), false, 'Participant mode should start on a separate setup screen.');
  assert.equal(
    await participantPage.locator('#participantFlowRail').isVisible(),
    true,
    'Participant mode should expose the step-based screen flow.',
  );
  assert.equal(await participantPage.locator('#participantStartButton').isEnabled(), false, 'Participant start should require required fields.');
  await participantPage.locator('#participantIdInput').fill('P042');
  await participantPage.locator('#participantNameInput').fill('Nguyen A');
  await participantPage.locator('#participantAgeInput').fill('22');
  await participantPage.locator('#participantConsentInput').check();
  assert.equal(await participantPage.locator('#participantStartButton').isEnabled(), true, 'Participant start should enable after valid metadata.');
  await participantPage.locator('#participantStartButton').click();
  assert.equal(await participantPage.locator('#viewerSection').isVisible(), true, 'Participant session should advance to the viewer screen.');
  await participantPage.locator('#participantSessionPanel').waitFor({ state: 'visible', timeout: 5000 });
  await assert.doesNotReject(
    participantPage.locator('#participantCalibrateButton').waitFor({ state: 'visible', timeout: 5000 }),
    'Participant session should expose calibration as a flow action.',
  );
  assert.equal(
    await participantPage.locator('#participantAccuracyButton').count(),
    0,
    'Participant session should not expose a separate gaze/accuracy action.',
  );
  await assert.doesNotReject(
    participantPage.locator('#participantRecordButton').waitFor({ state: 'visible', timeout: 5000 }),
    'Participant session should expose recording as a flow action.',
  );
  await participantPage.waitForFunction(() => (
    !document.fullscreenElement || document.fullscreenElement.id === 'appShell'
  ));
  await participantPage.locator('#participantRecordButton').click();
  assert.equal(
    await participantPage.locator('#participantRecordButton').evaluate((button) => button.classList.contains('primary')),
    false,
    'Participant recording control should be clickable after fullscreen starts.',
  );
  await participantPage.locator('#participantRecordButton').click();
  assert.notEqual(await participantPage.locator('#modeLabel').innerText(), '', 'Participant mode should keep a gaze mode label.');
  await participantPage.close();

  const validationPage = await browser.newPage({
    viewport: { width: 1366, height: 900 },
  });
  await validationPage.goto(urlWithMode('validation'), { waitUntil: 'domcontentloaded' });
  await validationPage.waitForSelector('#validationTestPanel');
  assert.equal(await validationPage.locator('#controlPanel').isVisible(), false, 'Validation test should hide admin controls.');
  assert.equal(await validationPage.locator('#participantPanel').isVisible(), false, 'Validation test should hide participant setup.');
  assert.equal(await validationPage.locator('#viewerSection').isVisible(), true, 'Validation test should show the blank app screen.');
  assert.equal(await validationPage.locator('#validationTestPanel').isVisible(), true, 'Validation test controls should be visible.');
  assert.equal(await validationPage.locator('#gazeProviderSelect').inputValue(), 'seeso', 'Validation test should force the hosted tracker.');
  assert.equal(await validationPage.locator('#validationTestCalibrateButton').isVisible(), true, 'Validation test should expose tracker calibration.');
  assert.equal(await validationPage.locator('#validationTestAccuracyButton').isVisible(), true, 'Validation test should expose the accuracy-check step.');
  assert.equal(await validationPage.locator('#participantRecordButton').isVisible(), false, 'Validation test should not expose recording.');
  assert.equal(
    await validationPage.locator('#gazeDot').evaluate((element) => getComputedStyle(element).opacity),
    '1',
    'Validation test should show the live tracking cursor on the blank screen.',
  );
  assert.equal(
    await validationPage.locator('#appShell').evaluate((element) => element.classList.contains('is-validation-test')),
    true,
    'Validation viewer should use the blank validation app state.',
  );
  await validationPage.close();

  const validationReturnPage = await browser.newPage({
    viewport: { width: 1366, height: 900 },
  });
  await validationReturnPage.goto(TARGET_URL, { waitUntil: 'domcontentloaded' });
  await validationReturnPage.evaluate(() => {
    sessionStorage.setItem('aoi.seesoCalibrationReturnMode', 'validation');
  });
  const returnedCalibrationUrl = new URL(TARGET_URL);
  returnedCalibrationUrl.searchParams.set('gazeProvider', 'seeso');
  returnedCalibrationUrl.searchParams.set('calibrationData', JSON.stringify({ vector: 'validation-return' }));
  await validationReturnPage.goto(returnedCalibrationUrl.toString(), { waitUntil: 'domcontentloaded' });
  await validationReturnPage.waitForSelector('#validationTestPanel');
  assert.equal(await validationReturnPage.locator('#validationTestPanel').isVisible(), true, 'Hosted calibration return should restore validation mode.');
  assert.equal(await validationReturnPage.locator('#controlPanel').isVisible(), false, 'Hosted calibration return should not fall back to admin mode.');
  assert.equal(await validationReturnPage.locator('#gazeProviderSelect').inputValue(), 'seeso', 'Hosted calibration return should keep the tracker selected.');
  await validationReturnPage.close();

  const malformedValidationReturnPage = await browser.newPage({
    viewport: { width: 1366, height: 900 },
  });
  const malformedValidationUrl = new URL(TARGET_URL);
  malformedValidationUrl.searchParams.set(
    'mode',
    `validation?calibrationData=${JSON.stringify({ vector: 'malformed-validation-return' })}`,
  );
  malformedValidationUrl.searchParams.set('gazeProvider', 'seeso');
  await malformedValidationReturnPage.goto(malformedValidationUrl.toString(), { waitUntil: 'domcontentloaded' });
  await malformedValidationReturnPage.waitForSelector('#validationTestPanel');
  assert.equal(await malformedValidationReturnPage.locator('#validationTestPanel').isVisible(), true, 'Malformed hosted return should still restore validation mode.');
  assert.equal(await malformedValidationReturnPage.locator('#controlPanel').isVisible(), false, 'Malformed hosted return should not fall back to admin mode.');
  await malformedValidationReturnPage.close();

  await page.locator('#studyVideoSelect').selectOption(SMOKE_FLAT_STUDY_VIDEO.id);
  await page.waitForFunction(
    (expectedProjection) => document.querySelector('#projectionSelect')?.value === expectedProjection,
    SMOKE_FLAT_STUDY_VIDEO.projection,
  );
  await page.waitForFunction(
    (expectedSource) => document.querySelector('#aoiSourceLabel')?.textContent === expectedSource,
    SMOKE_FLAT_GENERATED_AOI_SOURCE,
  );
  assert.equal(
    await page.locator('#aoiSourceLabel').innerText(),
    SMOKE_FLAT_GENERATED_AOI_SOURCE,
    'UI should show whether AOIs came from the generated study AOI file.',
  );
  assert.equal(
    await page.locator('#projectionSelect').isDisabled(),
    true,
    'Fixed study videos should lock projection metadata controls.',
  );
  await page.locator('#manualAoiLabelInput').fill('Drawn object');
  await page.locator('#drawPolygonAoiButton').click();
  const drawBox = await page.locator('#viewer').boundingBox();

  await page.mouse.click(drawBox.x + drawBox.width * 0.35, drawBox.y + drawBox.height * 0.25);
  await page.mouse.click(drawBox.x + drawBox.width * 0.55, drawBox.y + drawBox.height * 0.28);
  await page.mouse.click(drawBox.x + drawBox.width * 0.50, drawBox.y + drawBox.height * 0.50);
  await page.mouse.click(drawBox.x + drawBox.width * 0.32, drawBox.y + drawBox.height * 0.45);
  await page.locator('#finishPolygonAoiButton').click();

  await page.waitForFunction(() => document.querySelector('#aoiList')?.textContent?.includes('Drawn object'));
  assert.equal(
    await page.locator('#aoiOverlay [data-aoi-id="drawn-object"]').count(),
    1,
    'Drawn polygon AOIs should appear on the overlay.',
  );
  const drawnAoiButton = page.locator('#aoiList button[data-aoi-id="drawn-object"]');
  await drawnAoiButton.focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => (
    document.activeElement?.matches('#aoiList button[data-aoi-id="drawn-object"][aria-pressed="true"]')
  ));
  assert.equal(
    await drawnAoiButton.getAttribute('aria-pressed'),
    'true',
    'Keyboard-selected AOIs should expose selected state on the list button.',
  );
  assert.equal(
    await page.locator(':focus').getAttribute('data-aoi-id'),
    'drawn-object',
    'Keyboard AOI selection should keep focus on the selected AOI button after rerender.',
  );
  const firstHandle = page.locator('#aoiOverlay .aoi-vertex-handle').first();
  const before = await getSvgHandleScreenPoint(page, firstHandle);
  await page.mouse.move(before.x, before.y);
  await page.mouse.down();
  await page.mouse.move(before.x + 20, before.y + 16);
  await page.mouse.up();
  const after = await getSvgHandleScreenPoint(page, firstHandle);
  assert.notEqual(Math.round(after.svgX), Math.round(before.svgX));

  const drawnExportPromise = page.waitForEvent('download');
  await page.locator('#exportButton').click();
  const drawnExportDownload = await drawnExportPromise;
  const drawnExportJson = JSON.parse(await readFile(await drawnExportDownload.path(), 'utf8'));
  const drawnAoi = drawnExportJson.aois.find((aoi) => aoi.id === 'drawn-object');
  assert.equal(drawnAoi.shape, 'polygon', 'Manual drawn AOIs should export as polygons.');
  assert.equal(drawnAoi.space, 'video', 'Manual flat drawn AOIs should export in video space.');
  assert.equal(drawnAoi.points.length >= 4, true, 'Manual drawn polygon AOIs should export vertex points.');
  assert.equal(
    drawnAoi.keyframes[0].points.length,
    drawnAoi.points.length,
    'Manual drawn polygon AOIs should export matching keyframe points.',
  );

  await page.locator('#manualAoiLabelInput').fill('Degenerate manual polygon');
  await page.locator('#drawPolygonAoiButton').click();
  const degenerateManualBox = await page.locator('#viewer').boundingBox();
  await page.mouse.click(degenerateManualBox.x + degenerateManualBox.width * 0.22, degenerateManualBox.y + degenerateManualBox.height * 0.32);
  await page.mouse.click(degenerateManualBox.x + degenerateManualBox.width * 0.42, degenerateManualBox.y + degenerateManualBox.height * 0.32);
  await page.mouse.click(degenerateManualBox.x + degenerateManualBox.width * 0.62, degenerateManualBox.y + degenerateManualBox.height * 0.32);
  assert.equal(
    await page.locator('#finishPolygonAoiButton').isDisabled(),
    true,
    'Degenerate manual polygons should keep Finish disabled.',
  );
  assert.equal(
    (await page.locator('#aoiList').innerText()).includes('Degenerate manual polygon'),
    false,
    'Manual polygon authoring should reject degenerate zero-area polygons.',
  );
  await page.locator('#cancelPolygonAoiButton').click();

  await page.locator('#manualAoiLabelInput').fill('Manual flat AOI');
  await page.locator('#manualAoiSizeInput').fill('24');
  await page.locator('#addManualAoiButton').click();
  await page.waitForFunction(() => document.querySelector('#aoiList')?.textContent?.includes('Manual flat AOI'));
  await page.locator('#studyVideoSelect').selectOption(SMOKE_PANORAMA_STUDY_VIDEO.id);
  await page.waitForFunction(
    (expectedProjection) => document.querySelector('#projectionSelect')?.value === expectedProjection,
    SMOKE_PANORAMA_STUDY_VIDEO.projection,
  );
  await page.waitForFunction(
    (expectedSource) => document.querySelector('#aoiSourceLabel')?.textContent === expectedSource,
    SMOKE_PANORAMA_GENERATED_AOI_SOURCE,
  );
  const tmpDir = await mkdtemp(join(tmpdir(), 'aoi-sidecar-'));
  const sidecarPath = join(tmpDir, 'test-video.aoi.json');
  await writeFile(sidecarPath, JSON.stringify({
    video: {
      name: SMOKE_PANORAMA_STUDY_VIDEO.name,
      durationSec: 16,
      projection: SMOKE_PANORAMA_STUDY_VIDEO.projection,
      stereoLayout: SMOKE_PANORAMA_STUDY_VIDEO.stereoLayout,
    },
    aois: [
      {
        id: 'sidecar-center',
        label: 'Sidecar center AOI',
        color: '#ff4f9a',
        yawMin: -12,
        yawMax: 12,
        pitchMin: -8,
        pitchMax: 8,
        keyframes: [
          { t: 0, yawMin: -12, yawMax: 12, pitchMin: -8, pitchMax: 8 },
          { t: 8, yawMin: 12, yawMax: 36, pitchMin: -6, pitchMax: 10 },
        ],
      },
      {
        id: 'sidecar-right-edge',
        label: 'Sidecar right-edge AOI',
        color: '#5dd7c8',
        yawMin: 42,
        yawMax: 76,
        pitchMin: -8,
        pitchMax: 8,
      },
      {
        id: 'sidecar-seam-polygon',
        label: 'Sidecar seam polygon',
        color: '#ff0000',
        shape: 'polygon',
        points: [
          { yaw: 170, pitch: 58 },
          { yaw: -170, pitch: 58 },
          { yaw: -170, pitch: 72 },
          { yaw: 170, pitch: 72 },
        ],
      },
    ],
  }, null, 2));
  await page.locator('#aoiFileInput').setInputFiles(sidecarPath);
  await page.locator('#aoiFileInput').dispatchEvent('change');
  await page.waitForFunction(() => document.querySelector('#aoiList')?.textContent?.includes('Sidecar center AOI'));
  assert.equal(
    await page.locator('#aoiSourceLabel').innerText(),
    'test-video.aoi.json',
    'Local AOI sidecar files should register as the active AOI source.',
  );
  await page.waitForFunction(() => document.querySelectorAll('#aoiOverlay .aoi-overlay-shape').length > 0);
  assert.equal(
    await page.locator('#aoiOverlay .aoi-overlay-shape').count(),
    2,
    'Loaded AOIs should be projected as anchored shapes on the 360 player.',
  );
  assert.equal(
    await page.locator('#aoiOverlay [data-aoi-id="sidecar-right-edge"]').count(),
    1,
    'AOIs partly outside the player viewport should still render as clipped anchored shapes.',
  );
  const seamMiddlePixel = await page.locator('#miniMap').evaluate((canvas) => {
    const context = canvas.getContext('2d');
    const pixel = context.getImageData(Math.floor(canvas.width * 0.53), Math.floor(canvas.height * 0.14), 1, 1).data;
    return Array.from(pixel);
  });
  assert.equal(
    seamMiddlePixel[0] < 40,
    true,
    'Seam-crossing panorama polygons should not fill the middle of the mini-map.',
  );

  const viewerBox = await page.locator('#viewer').boundingBox();
  const mouseMoveLeakCount = await page.locator('#viewer').evaluate((viewerElement) => {
    window.__aoiMouseMoveLeakCount = 0;
    document.addEventListener('mousemove', () => {
      window.__aoiMouseMoveLeakCount += 1;
    });
    viewerElement.dispatchEvent(new MouseEvent('mousemove', {
      bubbles: true,
      cancelable: true,
      clientX: viewerElement.getBoundingClientRect().left + 20,
      clientY: viewerElement.getBoundingClientRect().top + 20,
    }));

    return window.__aoiMouseMoveLeakCount;
  });
  assert.equal(mouseMoveLeakCount, 0, 'Mousemove events should not reach WebGazer-style document listeners.');

  await page.mouse.move(viewerBox.x + 48, viewerBox.y + 48);
  await page.mouse.move(viewerBox.x + viewerBox.width - 48, viewerBox.y + viewerBox.height - 48);
  assert.match(
    await page.locator('#screenReadout').innerText(),
    /waiting for webcam gaze|--/,
    'Mouse movement should not drive gaze unless mouse debug mode is selected.',
  );

  await assert.doesNotReject(
    page.locator('#calibrateButton').waitFor({ state: 'visible', timeout: 1000 }),
    'Webcam calibration control should be visible.',
  );
  await assert.doesNotReject(
    page.locator('#accuracyButton').waitFor({ state: 'visible', timeout: 1000 }),
    'Webcam accuracy control should be visible.',
  );
  assert.deepEqual(
    await page.locator('#gazeProviderSelect option').evaluateAll((options) => options.map((option) => option.value)),
    ['webgazer', 'seeso'],
    'Gaze provider selector should expose WebGazer and the hosted tracker.',
  );
  assert.equal(
    await page.locator('#gazeProviderSelect').inputValue(),
    'webgazer',
    'WebGazer should remain the default gaze provider.',
  );
  assert.deepEqual(
    await page.locator('#calibrationProfileSelect option').evaluateAll((options) => options.map((option) => option.value)),
    ['standard', 'research-39', 'research-78'],
    'Calibration profile selector should expose standard and research modes.',
  );
  await page.locator('#calibrationProfileSelect').selectOption('research-39');
  assert.deepEqual(
    await page.locator('#validationPolicySelect option').evaluateAll((options) => options.map((option) => option.value)),
    ['prototype', 'research'],
    'Validation policy selector should expose prototype and research modes.',
  );
  await page.locator('#validationPolicySelect').selectOption('research');

  const noticeHidden = await page.locator('#viewerNotice').evaluate((element) => {
    return element.classList.contains('is-hidden') || getComputedStyle(element).display === 'none';
  });
  assert.equal(noticeHidden, true, 'Loaded local video should hide the placeholder notice.');

  await page.locator('#recordButton').click();
  assert.equal(
    await page.locator('#recordButton').evaluate((button) => button.classList.contains('primary')),
    false,
    'Webcam recording should be allowed without checking accuracy again.',
  );
  assert.doesNotMatch(
    await page.locator('#viewerNotice').innerText(),
    /Check accuracy/,
    'Starting webcam recording without validation should not show an accuracy-block notice.',
  );
  await page.locator('#recordButton').click();

  await page.locator('#mouseModeButton').click();
  assert.equal(
    await page.locator('#mouseModeButton').evaluate((button) => button.classList.contains('is-active')),
    true,
  );
  await page.mouse.move(viewerBox.x + viewerBox.width / 2, viewerBox.y + viewerBox.height / 2);
  await page.locator('#recordButton').click();
  await page.waitForFunction(() => document.querySelector('#sampleCount')?.textContent !== '0');
  await page.locator('#calibrateButton').click();
  await page.waitForTimeout(150);
  assert.equal(
    await page.locator('#recordButton').evaluate((button) => button.classList.contains('primary')),
    true,
    'Starting calibration should stop an active recording before target mode can run.',
  );
  assert.equal(
    await page.locator('#recordButton').evaluate((button) => button.classList.contains('primary')),
    true,
    'Stopped recording controls should return to the primary start state.',
  );
  const samplesAfterCalibrationStart = await page.locator('#sampleCount').innerText();
  await page.waitForTimeout(RECORDING_SAMPLE_INTERVAL_MS * 3);
  assert.equal(
    await page.locator('#sampleCount').innerText(),
    samplesAfterCalibrationStart,
    'Calibration startup should not keep appending recording samples.',
  );
  await page.locator('#clearButton').click();
  assert.equal(await page.locator('#sampleCount').innerText(), '0');
  if (await page.locator('#cancelCalibrationButton').isVisible()) {
    await page.locator('#cancelCalibrationButton').click();
  }

  await page.locator('#mouseModeButton').click();
  assert.equal(
    await page.locator('#mouseModeButton').evaluate((button) => button.classList.contains('is-active')),
    true,
  );
  await page.mouse.move(viewerBox.x + viewerBox.width / 2, viewerBox.y + viewerBox.height / 2);
  await page.locator('#recordButton').click();
  await page.waitForFunction(() => document.querySelector('#sampleCount')?.textContent !== '0');
  await page.locator('#recordButton').click();

  const boxExportedJson = await recordMouseExport(page, viewerBox);
  const [boxSample] = boxExportedJson.samples;

  assert.equal(boxExportedJson.samples.length > 0, true, 'Mouse recording should export at least one 360 sidecar sample.');
  assert.equal(
    boxExportedJson.aoiSource,
    'test-video.aoi.json',
    'Export should identify the registered 360 AOI sidecar source.',
  );
  assert.equal(
    boxExportedJson.aois.some((aoi) => aoi.id === 'sidecar-center'),
    true,
    'Export should package AOI definitions from the registered 360 sidecar file.',
  );
  assert.equal(
    boxExportedJson.project.video.projection,
    'equirectangular',
    'Export should preserve 360 video projection metadata from the AOI sidecar.',
  );
  assert.equal(
    boxExportedJson.project.video.stereoLayout,
    SMOKE_PANORAMA_STUDY_VIDEO.stereoLayout,
    'Export should preserve panorama stereo layout metadata from the AOI sidecar.',
  );
  assert.equal(
    boxSample.activeAois.some((aoi) => aoi.id === 'sidecar-center' && Number.isFinite(aoi.yawMin)),
    true,
    'Time-resolved 360 AOI bounds should be inspectable by AOI id.',
  );

  await page.locator('#analyticsClearButton').click();
  assert.equal(await page.locator('#sampleCount').innerText(), '0', 'Clear should reset samples before polygon export coverage.');
  await page.locator('#studyVideoSelect').selectOption(SMOKE_FLAT_STUDY_VIDEO.id);
  await page.waitForFunction(
    (expectedProjection) => document.querySelector('#projectionSelect')?.value === expectedProjection,
    SMOKE_FLAT_STUDY_VIDEO.projection,
  );
  await page.waitForFunction(
    (expectedSource) => document.querySelector('#aoiSourceLabel')?.textContent === expectedSource,
    SMOKE_FLAT_GENERATED_AOI_SOURCE,
  );
  const polygonSourceBeforeReject = await page.locator('#aoiSourceLabel').innerText();

  const invalidPolygonSidecarPath = join(tmpDir, 'invalid-polygon-video.aoi.json');
  await writeFile(invalidPolygonSidecarPath, JSON.stringify({
    video: {
      name: SMOKE_FLAT_STUDY_VIDEO.name,
      projection: SMOKE_FLAT_STUDY_VIDEO.projection,
      stereoLayout: SMOKE_FLAT_STUDY_VIDEO.stereoLayout,
    },
    aois: [
      {
        id: 'invalid-polygon-object',
        label: 'Invalid polygon object',
        color: '#ffd166',
        space: 'video',
        shape: 'polygon',
        points: [
          { x: 0.3, y: 0.2 },
          { x: 0.55, y: 0.24 },
          { x: 0.52, y: 0.5 },
          { x: 0.33, y: 0.46 },
        ],
        keyframes: [
          {
            t: 0,
            points: [
              { x: 0.3, y: 0.2 },
              { x: '', y: 0.24 },
              { x: 0.52, y: 0.5 },
              { x: 0.33, y: 0.46 },
            ],
          },
        ],
      },
    ],
  }, null, 2));

  await page.locator('#aoiFileInput').setInputFiles(invalidPolygonSidecarPath);
  await page.locator('#aoiFileInput').dispatchEvent('change');
  await page.waitForFunction(() => (
    document.querySelector('#viewerNotice')?.textContent?.includes('AOI JSON') ||
    document.querySelector('#aoiSourceLabel')?.textContent === 'invalid-polygon-video.aoi.json'
  ));
  assert.match(
    await page.locator('#viewerNotice').innerText(),
    /AOI JSON/,
    'Invalid polygon keyframe coordinates should be rejected.',
  );
  assert.equal(
    await page.locator('#aoiSourceLabel').innerText(),
    polygonSourceBeforeReject,
    'Rejected polygon sidecars should not replace the active AOI source.',
  );
  assert.equal(
    (await page.locator('#aoiList').innerText()).includes('Invalid polygon object'),
    false,
    'Rejected polygon sidecars should not switch the AOI list.',
  );

  const degeneratePolygonSidecarPath = join(tmpDir, 'degenerate-polygon-video.aoi.json');
  await writeFile(degeneratePolygonSidecarPath, JSON.stringify({
    video: {
      name: SMOKE_FLAT_STUDY_VIDEO.name,
      projection: SMOKE_FLAT_STUDY_VIDEO.projection,
      stereoLayout: SMOKE_FLAT_STUDY_VIDEO.stereoLayout,
    },
    aois: [
      {
        id: 'degenerate-polygon-object',
        label: 'Degenerate polygon object',
        color: '#ffd166',
        space: 'video',
        shape: 'polygon',
        points: [
          { x: 0.2, y: 0.2 },
          { x: 0.4, y: 0.4 },
          { x: 0.6, y: 0.6 },
        ],
      },
    ],
  }, null, 2));

  await page.locator('#aoiFileInput').setInputFiles(degeneratePolygonSidecarPath);
  await page.locator('#aoiFileInput').dispatchEvent('change');
  await page.waitForFunction(() => (
    document.querySelector('#viewerNotice')?.textContent?.includes('AOI JSON') ||
    document.querySelector('#aoiSourceLabel')?.textContent === 'degenerate-polygon-video.aoi.json'
  ));
  assert.match(
    await page.locator('#viewerNotice').innerText(),
    /AOI JSON/,
    'Degenerate polygon sidecars should be rejected.',
  );
  assert.equal(
    await page.locator('#aoiSourceLabel').innerText(),
    polygonSourceBeforeReject,
    'Rejected degenerate polygon sidecars should not replace the active AOI source.',
  );
  assert.equal(
    (await page.locator('#aoiList').innerText()).includes('Degenerate polygon object'),
    false,
    'Rejected degenerate polygon sidecars should not switch the AOI list.',
  );

  const polygonObjectPoints = [
    { x: 0.3, y: 0.2 },
    { x: 0.55, y: 0.24 },
    { x: 0.52, y: 0.5 },
    { x: 0.33, y: 0.46 },
  ];
  const importedPaddingOnlyPoints = [
    { x: 0.72, y: 0.2 },
    { x: 0.86, y: 0.2 },
    { x: 0.86, y: 0.36 },
    { x: 0.72, y: 0.36 },
  ];
  const importedExplicitPaddingPoints = [
    { x: 0.72, y: 0.52 },
    { x: 0.86, y: 0.52 },
    { x: 0.86, y: 0.68 },
    { x: 0.72, y: 0.68 },
  ];
  const polygonSidecarPath = join(tmpDir, 'polygon-video.aoi.json');
  await writeFile(polygonSidecarPath, JSON.stringify({
    video: {
      name: SMOKE_FLAT_STUDY_VIDEO.name,
      projection: SMOKE_FLAT_STUDY_VIDEO.projection,
      stereoLayout: SMOKE_FLAT_STUDY_VIDEO.stereoLayout,
    },
    aois: [
      {
        id: 'polygon-object',
        label: 'Polygon object',
        color: '#ffd166',
        space: 'video',
        shape: 'polygon',
        analysisPaddingPx: 6,
        points: polygonObjectPoints,
        keyframes: [
          {
            t: 0,
            points: polygonObjectPoints,
          },
        ],
      },
      {
        id: 'imported-padding-polygon',
        label: 'Imported padding polygon',
        color: '#5dd7c8',
        space: 'video',
        shape: 'polygon',
        analysisPaddingPx: 8,
        points: importedPaddingOnlyPoints,
        keyframes: [
          {
            t: 0,
            points: importedPaddingOnlyPoints,
          },
        ],
      },
      {
        id: 'source-frame-padding-polygon',
        label: 'Source frame padding polygon',
        color: '#ff8a5c',
        space: 'video',
        shape: 'polygon',
        analysisPaddingPx: 8,
        analysisPadding: 0.123,
        points: importedExplicitPaddingPoints,
        keyframes: [
          {
            t: 0,
            points: importedExplicitPaddingPoints,
          },
        ],
      },
    ],
  }, null, 2));

  await page.locator('#aoiFileInput').setInputFiles(polygonSidecarPath);
  await page.locator('#aoiFileInput').dispatchEvent('change');
  await page.waitForFunction(() => document.querySelector('#aoiList')?.textContent?.includes('Polygon object'));
  await page.waitForFunction(() => document.querySelector('#aoiOverlay [data-aoi-id="polygon-object"]'));
  assert.equal(
    await page.locator('#aoiOverlay [data-aoi-id="polygon-object"]').count(),
    1,
    'Imported polygon AOIs should render as object-shaped overlay polygons.',
  );
  await page.locator('#aoiList button[data-aoi-id="polygon-object"]').click();
  await page.locator('#selectedAoiPanel').waitFor({ state: 'visible' });
  assert.equal(
    await page.locator('#selectedAoiLabelInput').inputValue(),
    'Polygon object',
    'Selecting an imported polygon AOI should populate the selected AOI panel.',
  );
  assert.equal(
    await page.locator('#selectedAoiPaddingInput').inputValue(),
    '6',
    'Selecting an imported polygon AOI should populate saved pixel padding.',
  );
  await page.locator('#selectedAoiLabelInput').fill('Reviewed polygon object');
  await page.locator('#selectedAoiPaddingInput').fill('12');
  await page.locator('#selectedAoiColorInput').fill('#00ffaa');
  await page.locator('#saveSelectedAoiButton').click();
  await page.waitForFunction(() => document.querySelector('#aoiList')?.textContent?.includes('Reviewed polygon object'));
  assert.equal(
    (await page.locator('#aoiList').innerText()).includes('Polygon object'),
    false,
    'Saving the selected AOI should update the AOI list label.',
  );

  const exportedJson = await recordMouseExport(page, viewerBox);
  const [sample] = exportedJson.samples;

  assert.equal(exportedJson.samples.length > 0, true, 'Mouse recording should export at least one sample.');
  assert.equal(
    exportedJson.aoiSource,
    'polygon-video.aoi.json',
    'Export should identify the registered AOI sidecar source.',
  );
  assert.equal(
    exportedJson.aois.some((aoi) => aoi.id === 'polygon-object' && aoi.shape === 'polygon'),
    true,
    'Export should package AOI definitions from the registered sidecar file.',
  );
  assert.equal(
    exportedJson.project.video.name,
    SMOKE_FLAT_STUDY_VIDEO.name,
    'Export should package usable video identity metadata with the AOIs.',
  );
  assert.equal(
    exportedJson.project.video.projection,
    SMOKE_FLAT_STUDY_VIDEO.projection,
    'Export should preserve flat video projection metadata from the AOI sidecar.',
  );
  assert.equal(
    exportedJson.project.video.stereoLayout,
    SMOKE_FLAT_STUDY_VIDEO.stereoLayout,
    'Export should preserve mono video layout metadata from the AOI sidecar.',
  );
  assert.equal(
    exportedJson.project.aois.count,
    exportedJson.aois.length,
    'Export should summarize how many AOIs are packaged with the video.',
  );
  assert.equal(
    exportedJson.aois[0].keyframes.length,
    1,
    'Export should package dynamic AOI keyframes with the video.',
  );
  assert.equal(
    exportedJson.summary.totalSamples,
    exportedJson.samples.length,
    'Export should include a quick sample count summary.',
  );
  assert.equal(
    exportedJson.summary.sources.mouse,
    exportedJson.samples.length,
    'Export summary should count samples by input source.',
  );
  assert.equal(
    typeof exportedJson.summary.durationSec,
    'number',
    'Export summary should include recording duration in seconds.',
  );
  assert.equal(
    exportedJson.summary.recordingSampleIntervalMs,
    RECORDING_SAMPLE_INTERVAL_MS,
    'Export summary should include the active recording sample cadence.',
  );
  assert.deepEqual(
    exportedJson.selectedCalibrationProfile,
    { id: 'research-39', label: 'Research 39', pointCount: 39 },
    'Export should include selected calibration setup metadata.',
  );
  assert.equal(exportedJson.calibrationProfile, null, 'Mouse exports without calibration should not report a used calibration profile.');
  assert.equal(exportedJson.calibrationProfileUsed, null, 'Mouse exports without calibration should not report calibration-profile-used metadata.');
  assert.equal(exportedJson.selectedValidationPolicyId, 'research', 'Export should include the selected validation policy.');
  assert.equal(exportedJson.validationPolicyId, null, 'Export should not report a used validation policy without completed validation.');
  assert.equal(exportedJson.policyPassed, null, 'Export should not report a policy result without completed validation.');
  assert.deepEqual(exportedJson.policyFailures, [], 'Export should not invent policy failures without completed validation.');
  assert.equal(exportedJson.validationGazeStreamQuality, null, 'Export should not invent validation stream quality without completed validation.');
  assert.deepEqual(
    exportedJson.summary.selectedCalibrationProfile,
    exportedJson.selectedCalibrationProfile,
    'Export summary should include selected calibration setup metadata.',
  );
  assert.equal(exportedJson.summary.calibrationProfile, null, 'Export summary should not report a used profile without calibration.');
  assert.equal(exportedJson.summary.selectedValidationPolicyId, 'research', 'Export summary should include selected validation policy.');
  assert.equal(exportedJson.summary.validationPolicyId, null, 'Export summary should not report unused validation policy metadata.');
  assert.deepEqual(
    exportedJson.project.selectedCalibrationProfile,
    exportedJson.selectedCalibrationProfile,
    'Project package should include selected calibration setup metadata.',
  );
  assert.equal(exportedJson.project.calibrationProfile, null, 'Project package should not report a used profile without calibration.');
  assert.equal(exportedJson.project.selectedValidationPolicyId, 'research', 'Project package should include selected validation policy.');
  assert.equal(exportedJson.project.validationPolicyId, null, 'Project package should not report unused validation policy metadata.');
  assert.equal(
    typeof exportedJson.summary.aoiHitCounts,
    'object',
    'Export summary should include AOI hit counts.',
  );
  assert.equal(
    typeof exportedJson.summary.aoiDwellSec,
    'object',
    'Export summary should include estimated AOI dwell seconds.',
  );
  assert.equal(
    typeof exportedJson.summary.likelyAoiDwellSec,
    'object',
    'Export summary should include estimated likely-AOI dwell seconds.',
  );
  assert.equal(typeof exportedJson.namedAoiMetrics, 'object', 'Export should include named AOI metrics.');
  assert.equal(
    exportedJson.namedAoiMetrics.perAoi['polygon-object'].label,
    'Reviewed polygon object',
    'Named AOI metrics should retain AOI labels.',
  );
  await page.waitForFunction(() => document.querySelectorAll('#aoiStatsTable tbody tr').length > 0);
  assert.equal(
    await page.locator('#aoiStatsTable tbody tr').count(),
    Object.keys(exportedJson.namedAoiMetrics.perAoi).length,
    'AOI stats table should auto-render one row per named AOI metric after sample data exists.',
  );
  await page.waitForFunction(() => document.querySelectorAll('#aoiStatsCards .aoi-stat-card').length > 0);
  assert.equal(
    await page.locator('#aoiStatsCards .aoi-stat-card').count(),
    Object.keys(exportedJson.namedAoiMetrics.perAoi).length,
    'AOI result cards should auto-render one card per named AOI metric after sample data exists.',
  );
  assert.match(
    await page.locator('#aoiStatsCards .aoi-stat-card').first().innerText(),
    /Reviewed polygon object[\s\S]*\d+\.\d{2}s/i,
    'AOI result cards should lead with the main attention metric.',
  );
  assert.equal(
    await page.locator('#appShell').evaluate((shell) => shell.classList.contains('is-analytics-mode')),
    true,
    'Stopping a recording should put the admin sidebar into analytics mode.',
  );
  assert.equal(
    await page.locator('#gazeHeatmapOverlay').evaluate((canvas) => {
      const context = canvas.getContext('2d');
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;

      return Array.from(pixels).some((value) => value !== 0);
    }),
    true,
    'Player heatmap overlay should draw non-empty pixels after sample data exists.',
  );
  assert.equal(
    exportedJson.aois[0].color,
    '#00ffaa',
    'Export should retain selected AOI color edits.',
  );
  assert.equal(
    exportedJson.aois[0].analysisPaddingPx,
    12,
    'Export should retain selected AOI analysis padding edits.',
  );
  assert.equal(
    typeof exportedJson.aois[0].analysisPadding,
    'number',
    'Export should include selected AOI effective polygon analysis padding.',
  );
  assert.equal(
    exportedJson.aois[0].analysisPadding > 0,
    true,
    'Selected AOI effective polygon analysis padding should be positive.',
  );
  const importedPaddingAoi = exportedJson.aois.find((aoi) => aoi.id === 'imported-padding-polygon');
  assert.equal(
    importedPaddingAoi.analysisPaddingPx,
    8,
    'Export should retain imported polygon pixel padding.',
  );
  assert.equal(
    typeof importedPaddingAoi.analysisPadding,
    'number',
    'Export should materialize imported polygon pixel padding for analysis.',
  );
  assert.equal(
    importedPaddingAoi.analysisPadding > 0,
    true,
    'Imported polygon effective analysis padding should be positive.',
  );
  const explicitPaddingAoi = exportedJson.aois.find((aoi) => aoi.id === 'source-frame-padding-polygon');
  assert.equal(
    explicitPaddingAoi.analysisPaddingPx,
    8,
    'Export should retain imported polygon pixel padding when explicit analysis padding exists.',
  );
  assert.equal(
    explicitPaddingAoi.analysisPadding,
    0.123,
    'Export should preserve imported explicit analysis padding without viewer-size recomputation.',
  );
  assert.equal(
    typeof exportedJson.namedAoiMetrics.perAoi['polygon-object'].totalDwellSec,
    'number',
    'Named AOI metrics should include per-AOI dwell seconds.',
  );
  assert.equal(
    typeof exportedJson.namedAoiMetrics.session.averageFixationDurationMs,
    'number',
    'Named AOI metrics should include session fixation metrics.',
  );
  assert.equal(exportedJson.participant, null, 'Admin/mouse demo exports should not invent participant metadata.');
  assert.equal(
    exportedJson.summary.durationSec > 0,
    true,
    'Export summary duration should be useful even when the video is paused in a mouse-demo recording.',
  );
  assert.equal(
    exportedJson.summary.accuracyValidated,
    false,
    'Mouse demo exports should not pretend webcam accuracy was validated.',
  );
  assert.equal(Array.isArray(sample.hits), true, 'Exported samples should retain exact AOI hits.');
  assert.equal(Array.isArray(sample.likelyHits), true, 'Exported samples should include likely AOI hits.');
  assert.equal(Array.isArray(sample.possibleHits), true, 'Exported samples should include possible AOI hits.');
  assert.equal(Array.isArray(sample.ambiguousHits), true, 'Exported samples should include ambiguous AOI hits.');
  assert.equal(Array.isArray(sample.activeAois), true, 'Exported samples should include time-resolved AOI bounds.');
  const samplePolygonAoi = sample.activeAois.find((aoi) => aoi.id === 'polygon-object');
  assert.equal(
    samplePolygonAoi?.shape,
    'polygon',
    'Time-resolved polygon AOIs should be inspectable by AOI id.',
  );
  assert.deepEqual(
    samplePolygonAoi.points,
    polygonObjectPoints,
    'Time-resolved polygon AOI points should preserve exported vertex coordinates.',
  );
  assert.equal(
    samplePolygonAoi.analysisPaddingPx,
    12,
    'Time-resolved polygon AOIs should preserve selected pixel padding.',
  );
  assert.equal(
    typeof samplePolygonAoi.analysisPadding,
    'number',
    'Time-resolved polygon AOIs should preserve effective analysis padding.',
  );
  assert.equal(
    samplePolygonAoi.analysisPadding > 0,
    true,
    'Time-resolved polygon effective analysis padding should be positive.',
  );
  assert.equal(
    sample.quality.trustedForAoiAnalysis,
    true,
    'Mouse-demo samples should be marked trusted for AOI analysis.',
  );
  assert.equal(
    sample.quality.webcamAccuracyValidated,
    false,
    'Mouse-demo samples should not claim webcam accuracy validation.',
  );
  assert.equal(
    exportedJson.summary.trustedSampleCount,
    exportedJson.samples.length,
    'Export summary should count trusted samples.',
  );
  assert.deepEqual(
    sample.gazeUncertainty,
    { px: 0, yawRadius: 0, pitchRadius: 0 },
    'Mouse-mode samples should export zero gaze uncertainty.',
  );

  const statsRecordingPath = join(tmpDir, 'loaded-stats-recording.json');
  await writeFile(statsRecordingPath, JSON.stringify({
    video: {
      name: SMOKE_FLAT_STUDY_VIDEO.name,
      projection: SMOKE_FLAT_STUDY_VIDEO.projection,
      stereoLayout: SMOKE_FLAT_STUDY_VIDEO.stereoLayout,
    },
    project: {
      aois: { source: 'loaded-stats-recording.aoi.json' },
    },
    aois: [
      {
        id: 'loaded-stats-aoi',
        label: 'Loaded stats AOI',
        color: '#fc7753',
        space: 'video',
        xMin: 0.2,
        xMax: 0.8,
        yMin: 0.2,
        yMax: 0.8,
      },
    ],
    samples: [
      {
        t: 0,
        source: 'review',
        panorama: { yaw: 0, pitch: 0 },
        hits: [],
        likelyHits: ['loaded-stats-aoi'],
        possibleHits: [],
        ambiguousHits: [],
        quality: { trustedForAoiAnalysis: true },
      },
      {
        t: 1,
        source: 'review',
        panorama: { yaw: 40, pitch: 0 },
        hits: [],
        likelyHits: [],
        possibleHits: [],
        ambiguousHits: [],
        quality: { trustedForAoiAnalysis: true },
      },
    ],
  }));
  await page.locator('#recordingFileInput').setInputFiles(statsRecordingPath);
  await page.locator('#recordingFileInput').dispatchEvent('change');
  await page.waitForFunction(() => document.querySelector('#appShell')?.classList.contains('is-analytics-mode'));
  await page.waitForFunction(() => document.querySelector('#aoiStatsCards')?.textContent?.includes('Loaded stats AOI'));
  await page.waitForFunction(() => document.querySelector('#aoiStatsCards')?.textContent?.includes('1.00s'));
  assert.match(
    await page.locator('#aoiStatsCards .aoi-stat-card').first().innerText(),
    /Loaded stats AOI[\s\S]*1\.00s/i,
    'Loaded recording cards should auto-refresh from the main attention metric without clicking Refresh.',
  );
  const loadedStatsCsvDownloadPromise = page.waitForEvent('download');
  await page.locator('#analyticsExportStatsCsvButton').click();
  const loadedStatsCsvDownload = await loadedStatsCsvDownloadPromise;
  const loadedStatsCsv = await readFile(await loadedStatsCsvDownload.path(), 'utf8');
  assert.match(
    loadedStatsCsv,
    /loaded-stats-aoi,Loaded stats AOI,0,1,0,/,
    'Stats CSV should use the same loaded recording sample source as the visible panel.',
  );
  const loadedStatsJsonDownloadPromise = page.waitForEvent('download');
  await page.locator('#analyticsExportButton').click();
  const loadedStatsJsonDownload = await loadedStatsJsonDownloadPromise;
  const loadedStatsJson = JSON.parse(await readFile(await loadedStatsJsonDownload.path(), 'utf8'));
  assert.equal(
    loadedStatsJson.namedAoiMetrics.perAoi['loaded-stats-aoi'].likelyDwellSec,
    1,
    'JSON named AOI metrics should use the same loaded recording sample source as the visible panel.',
  );
  assert.equal(
    loadedStatsJson.statReport.perAoiRows[0].stats.find((stat) => stat.id === 'likelyDwellSec')?.value,
    1,
    'JSON stat report should use the same loaded recording sample source as the visible panel.',
  );

  assert.equal(
    await page.locator('#gazeHeatmapOverlay').evaluate((canvas) => {
      const context = canvas.getContext('2d');
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;

      return Array.from(pixels).some((value) => value !== 0);
    }),
    true,
    'Loaded recording JSON should draw the player heatmap overlay.',
  );

  await page.locator('#analyticsClearButton').click();
  await page.waitForFunction(() => document.querySelector('#sampleCount')?.textContent === '0');
  assert.equal(
    await page.locator('#appShell').evaluate((shell) => shell.classList.contains('is-analytics-mode')),
    false,
    'Clearing samples should leave analytics mode.',
  );
  assert.equal(
    await page.locator('#aoiStatsPanel').isVisible(),
    false,
    'Clearing samples should hide the analytics stats panel.',
  );
  const dynamicPolygonSidecarPath = join(tmpDir, 'dynamic-polygon-video.aoi.json');
  const dynamicTopLevelPoints = [
    { x: 0.18, y: 0.18 },
    { x: 0.38, y: 0.18 },
    { x: 0.36, y: 0.38 },
    { x: 0.16, y: 0.36 },
  ];
  const dynamicStartPoints = [
    { x: 0.30, y: 0.22 },
    { x: 0.58, y: 0.24 },
    { x: 0.54, y: 0.52 },
    { x: 0.28, y: 0.48 },
  ];
  const dynamicEndPoints = [
    { x: 0.36, y: 0.28 },
    { x: 0.62, y: 0.31 },
    { x: 0.57, y: 0.57 },
    { x: 0.34, y: 0.54 },
  ];
  await writeFile(dynamicPolygonSidecarPath, JSON.stringify({
    video: {
      name: SMOKE_FLAT_STUDY_VIDEO.name,
      projection: SMOKE_FLAT_STUDY_VIDEO.projection,
      stereoLayout: SMOKE_FLAT_STUDY_VIDEO.stereoLayout,
    },
    aois: [
      {
        id: 'dynamic-polygon-object',
        label: 'Dynamic polygon object',
        color: '#ffd166',
        space: 'video',
        shape: 'polygon',
        points: dynamicTopLevelPoints,
        keyframes: [
          { t: 0, points: dynamicStartPoints },
          { t: 8, points: dynamicEndPoints },
        ],
      },
    ],
  }, null, 2));
  await page.locator('#aoiFileInput').setInputFiles(dynamicPolygonSidecarPath);
  await page.locator('#aoiFileInput').dispatchEvent('change');
  await page.waitForFunction(() => document.querySelector('#aoiList')?.textContent?.includes('Dynamic polygon object'));
  await page.locator('#sourceVideo').evaluate((video) => {
    video.currentTime = 0;
  });
  await page.locator('#aoiList button[data-aoi-id="dynamic-polygon-object"]').click();
  const dynamicHandle = page.locator('#aoiOverlay .aoi-vertex-handle').first();
  const dynamicBefore = await getSvgHandleScreenPoint(page, dynamicHandle);
  await page.mouse.move(dynamicBefore.x, dynamicBefore.y);
  await page.mouse.down();
  await page.mouse.move(dynamicBefore.x + 20, dynamicBefore.y + 16);
  await page.mouse.up();

  const dynamicExportPromise = page.waitForEvent('download');
  await page.locator('#exportButton').click();
  const dynamicExportDownload = await dynamicExportPromise;
  const dynamicExportJson = JSON.parse(await readFile(await dynamicExportDownload.path(), 'utf8'));
  const editedDynamicAoi = dynamicExportJson.aois.find((aoi) => aoi.id === 'dynamic-polygon-object');
  assert.deepEqual(
    editedDynamicAoi.points,
    dynamicTopLevelPoints,
    'Dynamic polygon edits should leave top-level base points unchanged.',
  );
  assert.notDeepEqual(
    editedDynamicAoi.keyframes[0].points[0],
    dynamicStartPoints[0],
    'Dragging a dynamic polygon handle should update the dragged keyframe vertex.',
  );
  assert.deepEqual(
    editedDynamicAoi.keyframes[0].points.slice(1),
    dynamicStartPoints.slice(1),
    'Dragging one dynamic polygon handle should preserve non-dragged vertices in the edited keyframe.',
  );
  assert.deepEqual(
    editedDynamicAoi.keyframes[1].points,
    dynamicEndPoints,
    'Dragging one dynamic polygon handle should not corrupt other keyframes.',
  );
  await page.locator('#sourceVideo').evaluate((video) => {
    video.currentTime = 4;
    video.dispatchEvent(new Event('timeupdate'));
  });
  await page.waitForFunction(() => document.querySelector('#sourceVideo')?.currentTime >= 4);
  await page.waitForFunction(() => (
    document.querySelectorAll('#aoiOverlay .aoi-vertex-handle').length === 0 &&
    /keyframe/i.test(document.querySelector('#manualAoiStatus')?.textContent || '')
  ));
  assert.equal(
    await page.locator('#aoiOverlay .aoi-vertex-handle').count(),
    0,
    'Dynamic polygon vertex handles should be hidden between keyframes.',
  );
  assert.match(
    await page.locator('#manualAoiStatus').innerText(),
    /keyframe/i,
    'Dynamic polygon midpoint editing should explain that handles are available at keyframes.',
  );
  await page.locator('#deleteSelectedAoiButton').click();
  await page.waitForFunction(() => document.querySelector('#selectedAoiPanel')?.hidden === true);
  assert.equal(
    (await page.locator('#aoiList').innerText()).includes('Dynamic polygon object'),
    false,
    'Deleting the selected AOI should remove it from the AOI list.',
  );
  assert.equal(
    await page.locator('#aoiOverlay [data-aoi-id="dynamic-polygon-object"]').count(),
    0,
    'Deleting the selected AOI should remove its overlay shape.',
  );
  const deletedAoiExportPromise = page.waitForEvent('download');
  await page.locator('#exportButton').click();
  const deletedAoiExportDownload = await deletedAoiExportPromise;
  const deletedAoiExportJson = JSON.parse(await readFile(await deletedAoiExportDownload.path(), 'utf8'));
  assert.equal(
    deletedAoiExportJson.aois.some((aoi) => aoi.id === 'dynamic-polygon-object'),
    false,
    'Deleted AOIs should not be included in exports.',
  );

  const reviewPath = join(tmpDir, 'recording-review.json');
  await writeFile(reviewPath, JSON.stringify(exportedJson), 'utf8');
  await page.locator('#recordingFileInput').setInputFiles(reviewPath);
  await page.locator('#recordingFileInput').dispatchEvent('change');
  await page.waitForFunction(() => document.querySelector('#reviewButton')?.disabled === false);
  assert.equal(
    await page.locator('#reviewButton').isEnabled(),
    true,
    'Loading an exported recording should enable review mode.',
  );
  if (await page.locator('#appShell').evaluate((shell) => shell.classList.contains('is-analytics-mode'))) {
    await page.locator('#exitAnalyticsButton').click();
  }
  if (!(await page.locator('#reviewButton').isVisible()) && await page.locator('#adminWorkflowRail a[href="#adminRecordingPanel"]').isVisible()) {
    await page.locator('#adminWorkflowRail a[href="#adminRecordingPanel"]').click();
  }
  await page.locator('#reviewButton').click();
  await page.waitForFunction(() => (document.querySelector('#modeLabel')?.textContent || '').trim().length > 0);
  await page.waitForFunction(() => /^x \d+, y \d+$/.test(document.querySelector('#screenReadout')?.textContent || ''));
  assert.equal(
    await page.locator('#projectionSelect').inputValue(),
    'flat',
    'Flat recording review should keep the packaged flat projection selected.',
  );
  assert.match(
    await page.locator('#panoramaReadout').innerText(),
    /^video x \d+\.\d{3}, y \d+\.\d{3}$/,
    'Flat recording review should derive video-space coordinates from recorded screen samples.',
  );
  assert.match(
    await page.locator('#hitReadout').innerText(),
    /Polygon object|none|possible|ambiguous/i,
    'Review mode should replay recorded tracker and AOI readout state.',
  );
  assert.equal(
    await page.locator('#sampleCount').innerText(),
    String(exportedJson.samples.length),
    'Review mode should show the loaded recording sample count.',
  );

  const calibrationHidden = await page.locator('#calibrationOverlay').evaluate((element) => element.hidden);
  assert.equal(calibrationHidden, true, 'Calibration overlay should be hidden before calibration starts.');

  const canvasSamples = await page.locator('#viewer canvas:not(.gaze-heatmap-overlay)').evaluate((canvas) => {
    const context = canvas.getContext('webgl2') || canvas.getContext('webgl');
    const width = canvas.width;
    const height = canvas.height;
    const pixels = new Uint8Array(4 * 25);
    let offset = 0;

    for (let row = 0; row < 5; row += 1) {
      for (let column = 0; column < 5; column += 1) {
        context.readPixels(
          Math.floor((column + 0.5) * width / 5),
          Math.floor((row + 0.5) * height / 5),
          1,
          1,
          context.RGBA,
          context.UNSIGNED_BYTE,
          pixels,
          offset,
        );
        offset += 4;
      }
    }

    return Array.from(pixels);
  });

  assert.equal(hasColorVariance(canvasSamples), true, 'Three.js canvas should render nonblank video pixels.');
  assert.deepEqual(consoleErrors, [], 'Browser console should not contain errors.');
  assert.deepEqual(pageErrors, [], 'Browser page should not throw uncaught errors.');
} finally {
  await browser.close();
}
