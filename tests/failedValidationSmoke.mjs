import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

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
  acceptDownloads: true,
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

    window.__aoiEmitGazeForCurrentTargetWithBias = (bias, durationMs = 5200) => new Promise((resolve) => {
      const target = document.querySelector('#calibrationTarget').getBoundingClientRect();
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
  });

  if (await startCalibrationOrKnownFakeCameraBoundary(page, {
    skipMessage: 'Only the known fake-camera WebGazer startup boundary should skip the failed validation smoke.',
  })) {
  const calibrationProgress = await page.locator('#calibrationProgress').innerText();
  const calibrationTargetCount = Number(calibrationProgress.match(/Target 1 of (\d+)/)?.[1]);

  for (let index = 0; index < calibrationTargetCount; index += 1) {
    await Promise.all([
      page.evaluate(() => window.__aoiEmitGazeForCurrentTargetWithBias({ x: 0, y: 0 })),
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

  for (let index = 0; index < accuracyTargetCount; index += 1) {
    const bias = index < 9 ? { x: 72, y: -34 } : { x: -260, y: 180 };
    await Promise.all([
      page.evaluate((nextBias) => window.__aoiEmitGazeForCurrentTargetWithBias(nextBias), bias),
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

  assert.doesNotMatch(
    await page.locator('#accuracyStatusLabel').innerText(),
    /^validated /,
    'Mismatched correction and holdout validation should not be marked validated.',
  );

  await page.locator('#recordButton').click();
  assert.equal(
    await page.locator('#recordButton').innerText(),
    'Stop Recording',
    'Recording should be allowed after failed independent validation while remaining unvalidated in exports.',
  );
  await page.locator('#recordButton').click();

  const downloadPromise = page.waitForEvent('download');
  await page.locator('#exportButton').click();
  const download = await downloadPromise;
  const payload = JSON.parse(await readFile(await download.path(), 'utf8'));

  assert.equal(payload.accuracyValidated, false);
  assert.equal(
    payload.gazeCorrection?.isIdentity ?? true,
    true,
    'Failed independent validation should not leave an active gaze correction in exports.',
  );
  }
} finally {
  await browser.close();
}
