import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { chromium } from 'playwright';
import { RECORDING_SAMPLE_INTERVAL_MS } from '../src/app/constants.js';
import { getDefaultStudyVideo } from '../src/app/studyVideos.js';

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
  acceptDownloads: true,
  permissions: ['camera'],
  viewport: { width: 1366, height: 900 },
});
const page = await context.newPage();
const defaultStudyVideo = getDefaultStudyVideo();
const errors = [];
const failedResponses = [];

async function assertCalibrationTargetInsideViewer(pageInstance) {
  const boxes = await pageInstance.evaluate(() => {
    const viewer = document.querySelector('#viewer').getBoundingClientRect();
    const target = document.querySelector('#calibrationTarget').getBoundingClientRect();

    return {
      viewer: {
        left: viewer.left,
        right: viewer.right,
        top: viewer.top,
        bottom: viewer.bottom,
      },
      targetCenter: {
        x: target.left + target.width / 2,
        y: target.top + target.height / 2,
      },
    };
  });

  assert.ok(
    boxes.targetCenter.x >= boxes.viewer.left && boxes.targetCenter.x <= boxes.viewer.right,
    'Calibration target center should stay inside the video player horizontally.',
  );
  assert.ok(
    boxes.targetCenter.y >= boxes.viewer.top && boxes.targetCenter.y <= boxes.viewer.bottom,
    'Calibration target center should stay inside the video player vertically.',
  );
}

async function assertCalibrationTargetDoesNotOverlapCard(pageInstance) {
  const boxes = await pageInstance.evaluate(() => {
    const card = document.querySelector('.calibration-card').getBoundingClientRect();
    const target = document.querySelector('#calibrationTarget').getBoundingClientRect();

    return {
      card: {
        left: card.left,
        right: card.right,
        top: card.top,
        bottom: card.bottom,
      },
      target: {
        left: target.left,
        right: target.right,
        top: target.top,
        bottom: target.bottom,
      },
    };
  });
  const overlapsHorizontally = boxes.target.left < boxes.card.right && boxes.target.right > boxes.card.left;
  const overlapsVertically = boxes.target.top < boxes.card.bottom && boxes.target.bottom > boxes.card.top;

  assert.equal(
    overlapsHorizontally && overlapsVertically,
    false,
    'Calibration instructions should not overlap the active target.',
  );
}

page.on('console', (message) => {
  if (message.type() === 'error') {
    errors.push(message.text());
  }
});
page.on('pageerror', (error) => errors.push(error.message));
page.on('response', (response) => {
  if (response.status() >= 400) {
    failedResponses.push({ status: response.status(), url: response.url() });
  }
});

try {
  await page.goto(urlWithMode('admin'), { waitUntil: 'networkidle' });
  await page.waitForFunction(() => Boolean(
    window.webgazer?.applyKalmanFilter &&
    window.webgazer?.clearData &&
    window.webgazer?.removeMouseEventListeners &&
    window.webgazer?.saveDataAcrossSessions &&
    window.webgazer?.setRegression &&
    window.webgazer?.setTracker &&
    window.webgazer?.showFaceFeedbackBox &&
    window.webgazer?.showFaceOverlay,
  ));
  await page.evaluate(() => {
    window.__aoiApplyKalmanFilterArgs = [];
    window.__aoiRemoveMouseEventListenersCalls = 0;
    window.__aoiClearDataCalls = 0;
    window.__aoiSaveDataAcrossSessionsArgs = [];
    window.__aoiSetRegressionArgs = [];
    window.__aoiSetTrackerArgs = [];
    window.__aoiShowFaceFeedbackBoxArgs = [];
    window.__aoiShowFaceOverlayArgs = [];
    window.__aoiSetGazeListenerCalls = 0;
    window.__aoiGazeListener = null;

    window.webgazer.setGazeListener = (callback) => {
      window.__aoiSetGazeListenerCalls += 1;
      window.__aoiGazeListener = callback;
      return window.webgazer;
    };

    window.__aoiEmitBiasedGazeForCurrentTarget = (durationMs = 5200) => {
      return new Promise((resolve) => {
        const target = document.querySelector('#calibrationTarget').getBoundingClientRect();
        const bias = { x: 72, y: -34 };
        const gaze = {
          x: target.left + target.width / 2 + bias.x,
          y: target.top + target.height / 2 + bias.y,
        };
        const startedAt = performance.now();
        const emit = () => {
          window.__aoiGazeListener?.(gaze, performance.now() - startedAt);
        };
        emit();
        const interval = window.setInterval(emit, 20);

        window.setTimeout(() => {
          window.clearInterval(interval);
          resolve();
        }, durationMs);
      });
    };

    window.__aoiEmitBiasedGazeAtViewerPercent = (xPercent, yPercent, durationMs = 1400) => {
      return new Promise((resolve) => {
        const viewer = document.querySelector('#viewer').getBoundingClientRect();
        const bias = { x: 72, y: -34 };
        const gaze = {
          x: viewer.left + viewer.width * (xPercent / 100) + bias.x,
          y: viewer.top + viewer.height * (yPercent / 100) + bias.y,
        };
        const startedAt = performance.now();
        const emit = () => {
          window.__aoiGazeListener?.(gaze, performance.now() - startedAt);
        };
        emit();
        const interval = window.setInterval(emit, 20);

        window.setTimeout(() => {
          window.clearInterval(interval);
          resolve();
        }, durationMs);
      });
    };

    const originalApplyKalmanFilter = window.webgazer.applyKalmanFilter.bind(window.webgazer);
    window.webgazer.applyKalmanFilter = (...args) => {
      window.__aoiApplyKalmanFilterArgs.push(args);
      return originalApplyKalmanFilter(...args);
    };

    const originalClearData = window.webgazer.clearData.bind(window.webgazer);
    window.webgazer.clearData = (...args) => {
      window.__aoiClearDataCalls += 1;
      return originalClearData(...args);
    };

    const originalSaveDataAcrossSessions = window.webgazer.saveDataAcrossSessions.bind(window.webgazer);
    window.webgazer.saveDataAcrossSessions = (...args) => {
      window.__aoiSaveDataAcrossSessionsArgs.push(args);
      return originalSaveDataAcrossSessions(...args);
    };

    const originalSetRegression = window.webgazer.setRegression.bind(window.webgazer);
    window.webgazer.setRegression = (...args) => {
      window.__aoiSetRegressionArgs.push(args);
      return originalSetRegression(...args);
    };

    const originalSetTracker = window.webgazer.setTracker.bind(window.webgazer);
    window.webgazer.setTracker = (...args) => {
      window.__aoiSetTrackerArgs.push(args);
      return originalSetTracker(...args);
    };

    const originalShowFaceFeedbackBox = window.webgazer.showFaceFeedbackBox.bind(window.webgazer);
    window.webgazer.showFaceFeedbackBox = (...args) => {
      window.__aoiShowFaceFeedbackBoxArgs.push(args);
      return originalShowFaceFeedbackBox(...args);
    };

    const originalShowFaceOverlay = window.webgazer.showFaceOverlay.bind(window.webgazer);
    window.webgazer.showFaceOverlay = (...args) => {
      window.__aoiShowFaceOverlayArgs.push(args);
      return originalShowFaceOverlay(...args);
    };

    const originalRemoveMouseEventListeners = window.webgazer.removeMouseEventListeners.bind(window.webgazer);
    window.webgazer.removeMouseEventListeners = (...args) => {
      window.__aoiRemoveMouseEventListenersCalls += 1;
      return originalRemoveMouseEventListeners(...args);
    };
  });

  assert.deepEqual(
    await page.locator('#validationPolicySelect option').evaluateAll((options) => options.map((option) => ({
      value: option.value,
      label: option.textContent.trim(),
    }))),
    [
      { value: 'prototype', label: 'Prototype' },
      { value: 'research', label: 'Research' },
    ],
    'Validation policy selector should expose prototype and research modes.',
  );
  assert.equal(
    await page.locator('#validationPolicySelect').inputValue(),
    'prototype',
    'Prototype validation policy should remain the default for webcam validation.',
  );

  await page.locator('#playVideoButton').click();
  await page.waitForFunction(() => document.querySelector('#sourceVideo')?.paused === false);

  if (await startCalibrationOrKnownFakeCameraBoundary(page, {
    skipMessage: 'Only the known fake-camera WebGazer startup boundary should skip the full webcam smoke.',
  })) {

  assert.equal(await page.locator('#webcamStatusLabel').innerText(), 'calibrating');
  assert.equal(
    await page.locator('#sourceVideo').evaluate((video) => video.paused),
    true,
    'Calibration should pause the 360 video to reduce visual distraction.',
  );
  const initialCalibrationProgress = await page.locator('#calibrationProgress').innerText();
  const calibrationTargetCount = Number(initialCalibrationProgress.match(/Target 1 of (\d+)/)?.[1]);
  assert.equal(
    calibrationTargetCount,
    9,
    'Default calibration should use the conservative 3x3 baseline.',
  );
  await assertCalibrationTargetDoesNotOverlapCard(page);

  await Promise.all([
    page.evaluate(() => window.__aoiEmitBiasedGazeForCurrentTarget()),
    page.locator('#calibrationTarget').click(),
  ]);
  await page.waitForFunction(() => document.querySelector('#calibrationProgress')?.textContent?.startsWith('Target 2'));
  await Promise.all([
    page.evaluate(() => window.__aoiEmitBiasedGazeForCurrentTarget()),
    page.locator('#calibrationTarget').click(),
  ]);
  await page.waitForFunction(() => document.querySelector('#calibrationProgress')?.textContent?.startsWith('Target 3'));
  await assertCalibrationTargetInsideViewer(page);

  for (let index = 2; index < calibrationTargetCount; index += 1) {
    await Promise.all([
      page.evaluate(() => window.__aoiEmitBiasedGazeForCurrentTarget()),
      page.locator('#calibrationTarget').click(),
    ]);

    if (index < calibrationTargetCount - 1) {
      await page.waitForFunction(
        (targetIndex) => document.querySelector('#calibrationProgress')?.textContent?.startsWith(`Target ${targetIndex + 2}`),
        index,
        { timeout: 30000 },
      );
    }
  }

  await page.waitForFunction(() => document.querySelector('#calibrationOverlay')?.hidden === true);
  assert.equal(
    await page.locator('#sourceVideo').evaluate((video) => video.paused),
    false,
    'Video playback should resume after calibration when it was playing before calibration.',
  );

  assert.equal(await page.locator('#webcamStatusLabel').innerText(), 'calibrated');
  assert.ok(
    await page.evaluate(() => window.__aoiRemoveMouseEventListenersCalls > 0),
    'WebGazer mouse training listeners should be removed during webcam startup.',
  );
  assert.ok(
    await page.evaluate(() => window.__aoiSaveDataAcrossSessionsArgs.some((args) => args[0] === false)),
    'WebGazer should not persist contaminated calibration data across sessions.',
  );
  assert.ok(
    await page.evaluate(() => window.__aoiClearDataCalls > 0),
    'Starting calibration should clear stale WebGazer data before collecting target samples.',
  );
  assert.ok(
    await page.evaluate(() => window.__aoiSetRegressionArgs.some((args) => args[0] === 'ridge')),
    'Controlled calibration should use ridge regression so newer targets do not outweigh earlier targets.',
  );
  assert.ok(
    await page.evaluate(() => window.__aoiSetTrackerArgs.some((args) => args[0] === 'TFFacemesh')),
    'Controlled calibration should explicitly use the MediaPipe FaceMesh tracker.',
  );
  assert.ok(
    await page.evaluate(() => window.__aoiApplyKalmanFilterArgs.some((args) => args[0] === false)),
    'App-level gaze filtering should own smoothing instead of stacking on WebGazer Kalman smoothing.',
  );
  assert.ok(
    await page.evaluate(() => window.__aoiShowFaceOverlayArgs.some((args) => args[0] === true)),
    'WebGazer face overlay should be visible during webcam calibration.',
  );
  assert.ok(
    await page.evaluate(() => window.__aoiShowFaceFeedbackBoxArgs.some((args) => args[0] === true)),
    'WebGazer face feedback box should be visible during webcam calibration.',
  );

  await page.locator('#accuracyButton').click();
  await page.waitForSelector('#calibrationOverlay:not([hidden])', { timeout: 45000 });
  assert.equal(await page.locator('#webcamStatusLabel').innerText(), 'validating');
  const initialAccuracyProgress = await page.locator('#calibrationProgress').innerText();
  const accuracyTargetCount = Number(initialAccuracyProgress.match(/Accuracy target 1 of (\d+)/)?.[1]);
  assert.ok(
    accuracyTargetCount >= 15,
    'Accuracy refinement should include both correction-fit targets and independent validation targets.',
  );

  for (let index = 0; index < accuracyTargetCount; index += 1) {
    await Promise.all([
      page.evaluate(() => window.__aoiEmitBiasedGazeForCurrentTarget()),
      page.locator('#calibrationTarget').click(),
    ]);

    if (index < accuracyTargetCount - 1) {
      await page.waitForFunction(
        (targetIndex) => document.querySelector('#calibrationProgress')?.textContent?.startsWith(`Accuracy target ${targetIndex + 2}`),
        index,
        { timeout: 30000 },
      );
    }
  }

  await page.waitForFunction(() => document.querySelector('#calibrationOverlay')?.hidden === true);
  assert.match(
    await page.locator('#accuracyStatusLabel').innerText(),
    /^validated \d+px$/,
    'Synthetic biased validation should fit a correction and confirm it on independent targets.',
  );

  await page.locator('#resetViewButton').click();
  await page.locator('#recordButton').click();
  assert.equal(
    await page.locator('#recordButton').innerText(),
    'Stop Recording',
    'Validated webcam mode should allow recording to start.',
  );
  await page.evaluate(() => window.__aoiEmitBiasedGazeAtViewerPercent(50, 50));
  await page.waitForFunction(() => Number(document.querySelector('#sampleCount')?.textContent || 0) > 0);
  await page.locator('#recordButton').click();

  const downloadPromise = page.waitForEvent('download');
  await page.locator('#exportButton').click();
  const download = await downloadPromise;
  const payload = JSON.parse(await readFile(await download.path(), 'utf8'));
  assert.ok(payload.samples.length > 0, 'Validated webcam recording should export recorded gaze samples.');
  assert.equal(
    payload.summary.totalSamples,
    payload.samples.length,
    'Export summary should match the recorded webcam sample count.',
  );
  assert.equal(
    payload.summary.sources.webcam,
    payload.samples.length,
    'Recorded samples should come through the webcam pipeline.',
  );
  assert.equal(
    payload.summary.recordingSampleIntervalMs,
    RECORDING_SAMPLE_INTERVAL_MS,
    'Export summary should include the active recording sample cadence.',
  );
  assert.equal(
    payload.summary.trustedSampleCount,
    payload.samples.length,
    'Validated webcam samples should be trusted for AOI analysis.',
  );
  assert.equal(
    payload.samples.every((sample) => sample.quality?.webcamAccuracyValidated === true),
    true,
    'Recorded webcam samples should carry validation status.',
  );
  assert.equal(payload.selectedValidationPolicyId, 'prototype', 'Webcam export should include selected validation policy metadata.');
  assert.equal(payload.validationPolicyId, 'prototype', 'Webcam export should include the completed validation policy.');
  assert.equal(payload.policyPassed, true, 'Completed webcam validation should report the policy result.');
  assert.deepEqual(payload.policyFailures, [], 'Completed webcam validation should export policy failure details.');
  assert.equal(payload.summary.validationPolicyId, 'prototype', 'Export summary should include the completed validation policy.');
  assert.equal(payload.project.validationPolicyId, 'prototype', 'Project package should include the completed validation policy.');
  assert.equal(
    Number.isFinite(payload.validationGazeStreamQuality?.effectiveHz),
    true,
    'Webcam export should include validation stream quality from the accuracy check.',
  );
  assert.equal(
    Number.isFinite(payload.summary.validationGazeStreamQuality?.effectiveHz),
    true,
    'Export summary should include validation stream quality from the accuracy check.',
  );
  assert.equal(
    payload.samples.every((sample) => sample.quality?.validationPolicyId === 'prototype' && sample.quality?.policyPassed === true),
    true,
    'Recorded webcam samples should carry validation policy status.',
  );
  const exportedSampleDebug = payload.samples.slice(0, 3).map((sample) => ({
    screen: sample.screen,
    panorama: sample.panorama,
    likelyHits: sample.likelyHits,
    possibleHits: sample.possibleHits,
    ambiguousHits: sample.ambiguousHits,
  }));
  assert.equal(
    payload.samples.some((sample) => sample.likelyHits?.length > 0),
    true,
    `A centered calibrated webcam gaze should register against bundled AOIs. Samples: ${JSON.stringify(exportedSampleDebug)}`,
  );
  assert.equal(
    payload.samples.every((sample) => sample.activeAois?.length > 0),
    true,
    'Exported webcam samples should include time-resolved AOI bounds.',
  );
  assert.equal(
    payload.project.video.name,
    defaultStudyVideo.name,
    'Webcam export should keep the default study video identity in the project package.',
  );
  assert.equal(
    payload.project.aois.count,
    payload.aois.length,
    'Webcam export should package AOI definitions with the recording.',
  );
  if (payload.gazeCorrection) {
    assert.equal(
      payload.gazeCorrection.sampleCount >= accuracyTargetCount,
      true,
      'Validated webcam correction should fold holdout validation targets into the final live correction when a non-identity correction is needed.',
    );
  }
  assert.equal(
    Number.isFinite(payload.summary.accuracyP90Px),
    true,
    'Export summary should include p90 validation error for webcam confidence.',
  );
  assert.equal(
    Number.isFinite(payload.summary.accuracyP90DispersionPx),
    true,
    'Export summary should include p90 target-capture dispersion for webcam confidence.',
  );
  assert.equal(
    Number.isFinite(payload.accuracy.p90DispersionPx),
    true,
    'Exported accuracy details should include capture dispersion.',
  );

  if (payload.gazeCorrection) {
    await page.setViewportSize({ width: 1280, height: 860 });
    await page.waitForTimeout(100);
    assert.match(
      await page.locator('#accuracyStatusLabel').innerText(),
      /^validated \d+px$/,
      'Normalized gaze correction should remain valid after ordinary viewer resize.',
    );
  }

  assert.deepEqual(failedResponses, []);
  assert.deepEqual(errors, []);
  }
} finally {
  await browser.close();
}
