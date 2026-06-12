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
  await page.waitForFunction(() => Boolean(
    window.webgazer?.recordScreenPosition &&
    window.webgazer?.setGazeListener,
  ));
  await page.evaluate(() => {
    window.__aoiGazeListener = null;
    window.__aoiRecordScreenPositionCalls = [];
    window.__aoiClearDataCalls = [];
    window.__aoiCurrentGazeMode = 'none';
    window.__aoiDriftAfterRecordCount = null;
    window.__aoiForceDrift = false;

    window.webgazer.setGazeListener = (callback) => {
      window.__aoiGazeListener = callback;
      return window.webgazer;
    };

    const originalRecordScreenPosition = window.webgazer.recordScreenPosition.bind(window.webgazer);
    window.webgazer.recordScreenPosition = (...args) => {
      window.__aoiRecordScreenPositionCalls.push({
        args,
        at: performance.now(),
        gazeMode: window.__aoiCurrentGazeMode,
      });
      if (
        Number.isFinite(window.__aoiDriftAfterRecordCount) &&
        window.__aoiRecordScreenPositionCalls.length >= window.__aoiDriftAfterRecordCount
      ) {
        window.__aoiForceDrift = true;
      }
      return originalRecordScreenPosition(...args);
    };

    if (window.webgazer.clearData) {
      const originalClearData = window.webgazer.clearData.bind(window.webgazer);
      window.webgazer.clearData = (...args) => {
        window.__aoiClearDataCalls.push({
          args,
          at: performance.now(),
        });
        return originalClearData(...args);
      };
    }

    window.__aoiEmitStableGazeForCurrentTarget = (durationMs = 1400) => new Promise((resolve) => {
      const target = document.querySelector('#calibrationTarget').getBoundingClientRect();
      const gaze = {
        x: target.left + target.width / 2,
        y: target.top + target.height / 2,
      };
      const startedAt = performance.now();
      const emit = () => {
        window.__aoiCurrentGazeMode = 'stable';
        window.__aoiGazeListener?.(gaze, performance.now() - startedAt);
      };
      emit();
      const interval = window.setInterval(emit, 20);

      window.setTimeout(() => {
        window.clearInterval(interval);
        window.__aoiCurrentGazeMode = 'none';
        resolve();
      }, durationMs);
    });

    window.__aoiEmitGazeThatDriftsAfterWebGazerCommitStarts = (durationMs = 4200) => new Promise((resolve) => {
      const target = document.querySelector('#calibrationTarget').getBoundingClientRect();
      const stableGaze = {
        x: target.left + target.width / 2,
        y: target.top + target.height / 2,
      };
      const driftingGaze = {
        x: stableGaze.x + 260,
        y: stableGaze.y,
      };
      const startedAt = performance.now();
      const emit = () => {
        const elapsed = performance.now() - startedAt;
        window.__aoiCurrentGazeMode = window.__aoiForceDrift ? 'drift' : 'stable';
        window.__aoiGazeListener?.(
          window.__aoiCurrentGazeMode === 'stable' ? stableGaze : driftingGaze,
          elapsed,
        );
      };
      emit();
      const interval = window.setInterval(emit, 20);

      window.setTimeout(() => {
        window.clearInterval(interval);
        window.__aoiCurrentGazeMode = 'none';
        window.__aoiForceDrift = false;
        window.__aoiDriftAfterRecordCount = null;
        resolve();
      }, durationMs);
    });
  });

  if (await startCalibrationOrKnownFakeCameraBoundary(page, {
    skipMessage: 'Only the known fake-camera WebGazer startup boundary should skip the calibration quality smoke.',
  })) {

  await page.locator('#calibrationTarget').click();
  await page.waitForFunction(() => document.querySelector('#calibrationProgress')?.textContent?.startsWith('Target 2'));

  assert.equal(
    await page.evaluate(() => window.__aoiRecordScreenPositionCalls.length),
    12,
    'Calibration should train WebGazer from target clicks even before raw gaze predictions are usable.',
  );
  assert.ok(
    await page.evaluate(() => {
      const calls = window.__aoiRecordScreenPositionCalls;
      return calls.at(-1).at - calls[0].at >= 400;
    }),
    'Accepted calibration targets should train WebGazer across multiple video frames, not one tight burst.',
  );

  await Promise.all([
    page.evaluate(() => window.__aoiEmitStableGazeForCurrentTarget(1400)),
    page.locator('#calibrationTarget').click(),
  ]);

  await page.waitForFunction(() => document.querySelector('#calibrationProgress')?.textContent?.startsWith('Target 3'));
  assert.ok(
    await page.evaluate(() => window.__aoiRecordScreenPositionCalls.length >= 24),
    'Subsequent calibration targets should keep adding WebGazer training records.',
  );
  }
} finally {
  await browser.close();
}
