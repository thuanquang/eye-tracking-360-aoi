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

    window.__aoiEmitStableGazeForCurrentTarget = (durationMs = 5200) => new Promise((resolve) => {
      const target = document.querySelector('#calibrationTarget').getBoundingClientRect();
      const gaze = {
        x: target.left + target.width / 2,
        y: target.top + target.height / 2,
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

    window.__aoiEmitGazeAtViewerCenter = (durationMs = 250) => new Promise((resolve) => {
      const viewer = document.querySelector('#viewer').getBoundingClientRect();
      const gaze = {
        x: viewer.left + viewer.width / 2,
        y: viewer.top + viewer.height / 2,
      };
      const startedAt = performance.now();
      const interval = window.setInterval(() => {
        window.__aoiGazeListener?.(gaze, performance.now() - startedAt);
      }, 20);

      window.setTimeout(() => {
        window.clearInterval(interval);
        resolve();
      }, durationMs);
    });
  });

  if (await startCalibrationOrKnownFakeCameraBoundary(page, {
    skipMessage: 'Only the known fake-camera WebGazer startup boundary should skip the stale gaze smoke.',
  })) {
  const calibrationProgress = await page.locator('#calibrationProgress').innerText();
  const calibrationTargetCount = Number(calibrationProgress.match(/Target 1 of (\d+)/)?.[1]);

  for (let index = 0; index < calibrationTargetCount; index += 1) {
    await Promise.all([
      page.evaluate(() => window.__aoiEmitStableGazeForCurrentTarget()),
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

  await page.locator('#accuracyButton').click();
  await page.waitForSelector('#calibrationOverlay:not([hidden])', { timeout: 45000 });
  const accuracyProgress = await page.locator('#calibrationProgress').innerText();
  const accuracyTargetCount = Number(accuracyProgress.match(/Accuracy target 1 of (\d+)/)?.[1]);

  await Promise.all([
    page.evaluate(() => window.__aoiEmitStableGazeForCurrentTarget()),
    page.locator('#calibrationTarget').click(),
  ]);

  await page.waitForFunction(() => document.querySelector('#calibrationProgress')?.textContent?.startsWith('Accuracy target 2'));
  await page.locator('#calibrationTarget').click();
  await page.waitForFunction(() => document.querySelector('#calibrationTarget')?.disabled === false);

  assert.match(
    await page.locator('#calibrationProgress').innerText(),
    /^Accuracy target 2 of \d+/,
    'Stale gaze from a previous target must not be reused as fresh accuracy data.',
  );
  assert.match(
    await page.locator('#calibrationDescription').innerText(),
    /fresh|steady|retry/i,
    'Rejected stale target should tell the tester to retry.',
  );

  await page.locator('#cancelCalibrationButton').click();
  await page.waitForFunction(() => document.querySelector('#calibrationOverlay')?.hidden === true);
  await page.evaluate(() => window.__aoiEmitGazeAtViewerCenter());
  await page.waitForFunction(() => /^x \d+, y \d+$/.test(document.querySelector('#screenReadout')?.textContent || ''));
  await page.waitForTimeout(700);
  assert.match(
    await page.locator('#screenReadout').innerText(),
    /^x \d+, y \d+$/,
    'Brief webcam dropouts such as ordinary blinks should hold the last gaze instead of flickering off.',
  );
  await page.waitForTimeout(900);
  assert.match(
    await page.locator('#screenReadout').innerText(),
    /stale|waiting/,
    'Long webcam dropouts should still time out instead of leaving stale AOI coordinates on screen.',
  );
  }
} finally {
  await browser.close();
}
