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

    window.__aoiEmitNoisyGazeForCurrentTarget = (durationMs = 2200) => new Promise((resolve) => {
      const target = document.querySelector('#calibrationTarget').getBoundingClientRect();
      const center = {
        x: target.left + target.width / 2,
        y: target.top + target.height / 2,
      };
      const offsets = [
        { x: -260, y: -160 },
        { x: 260, y: 160 },
        { x: -240, y: 180 },
        { x: 240, y: -180 },
      ];
      let index = 0;
      const startedAt = performance.now();
      const emit = () => {
        const offset = offsets[index % offsets.length];
        index += 1;
        window.__aoiGazeListener?.({
          x: center.x + offset.x,
          y: center.y + offset.y,
        }, performance.now() - startedAt);
      };
      emit();
      const interval = window.setInterval(emit, 20);
      window.setTimeout(() => {
        window.clearInterval(interval);
        resolve();
      }, durationMs);
    });
  });

  const calibrationStarted = await startCalibrationOrKnownFakeCameraBoundary(page, {
    skipMessage: 'Known fake-camera WebGazer startup boundary.',
  });
  if (!calibrationStarted) {
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

  await page.locator('#rawGazeDiagnosticButton').click();
  await page.waitForSelector('#calibrationOverlay:not([hidden])', { timeout: 45000 });

  for (let index = 0; index < 5; index += 1) {
    await Promise.all([
      page.evaluate(() => window.__aoiEmitNoisyGazeForCurrentTarget()),
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
  const noisyMetadata = await page.evaluate(() => window.__aoiGetRuntimeQualityMetadata?.());
  assert.equal(noisyMetadata.rawGazeDiagnostic.latestSummary.quality, 'unusable');
  await page.locator('#recordButton').click();
  assert.match(await page.locator('#viewerNotice').innerText(), /blocked|jitter/i);
} finally {
  await browser.close();
}
