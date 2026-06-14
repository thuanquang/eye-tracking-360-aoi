import assert from 'node:assert/strict';
import { chromium } from 'playwright';

import { startCalibrationOrKnownFakeCameraBoundary } from './webcamSmokeHelpers.mjs';

const TARGET_URL = process.env.AOI_PROTOTYPE_URL || 'http://127.0.0.1:5179';

function urlWithMode(mode) {
  const url = new URL(TARGET_URL);
  url.searchParams.set('mode', mode);
  return url.toString();
}

async function completeVisibleCalibration(page) {
  for (let index = 0; index < 80; index += 1) {
    const overlayHidden = await page.locator('#calibrationOverlay').evaluate((overlay) => overlay.hidden);
    if (overlayHidden) {
      return;
    }

    const progressText = await page.locator('#calibrationProgress').innerText();
    const progressMatch = progressText.match(/^Target\s+(\d+)/i);
    const previousTargetIndex = progressMatch ? Number(progressMatch[1]) : 0;

    await page.locator('#calibrationTarget').click();
    await page.waitForFunction((targetIndex) => {
      const overlay = document.querySelector('#calibrationOverlay');
      if (overlay?.hidden) {
        return true;
      }

      const nextProgressText = document.querySelector('#calibrationProgress')?.textContent || '';
      const nextProgressMatch = nextProgressText.match(/^Target\s+(\d+)/i);
      return nextProgressMatch && Number(nextProgressMatch[1]) > targetIndex;
    }, previousTargetIndex, { timeout: 30000 });
  }

  throw new Error('Calibration did not finish before the smoke helper iteration limit.');
}

const browser = await chromium.launch({
  args: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
  ],
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

    window.__aoiInstallDiagnosticTimerClamp = () => {
      if (window.__aoiDiagnosticTimerClampInstalled) {
        return;
      }
      window.__aoiDiagnosticTimerClampInstalled = true;
      const nativeSetTimeout = window.setTimeout.bind(window);
      const nativeSetInterval = window.setInterval.bind(window);
      window.__aoiDiagnosticNativeSetTimeout = nativeSetTimeout;
      window.setTimeout = (callback, delay = 0, ...args) => {
        const clampedDelay = delay >= 1000
          ? Math.min(delay, 700)
          : delay >= 100
            ? Math.min(delay, 20)
            : Math.min(delay, 5);
        return nativeSetTimeout(callback, clampedDelay, ...args);
      };
      window.setInterval = (callback, delay = 0, ...args) => nativeSetInterval(
        callback,
        Math.min(delay, 5),
        ...args,
      );
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

    window.__aoiEmitOneGazeForCurrentTarget = () => {
      const target = document.querySelector('#calibrationTarget').getBoundingClientRect();
      window.__aoiGazeListener?.({
        x: target.left + target.width / 2,
        y: target.top + target.height / 2,
      }, performance.now());
    };

    window.__aoiEmitGazeForCurrentTargetUntilDone = ({ noisy = false } = {}) => new Promise((resolve) => {
      const initialProgress = document.querySelector('#calibrationProgress')?.textContent || '';
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
      let done = false;

      const cleanup = () => {
        if (done) {
          return;
        }
        done = true;
        window.clearInterval(emitInterval);
        window.clearInterval(checkInterval);
        resolve();
      };

      const emit = () => {
        const offset = noisy ? offsets[index % offsets.length] : { x: 0, y: 0 };
        index += 1;
        window.__aoiGazeListener?.({
          x: center.x + offset.x,
          y: center.y + offset.y,
        }, index * 20);
      };
      emit();
      const emitInterval = window.setInterval(emit, 20);
      const checkInterval = window.setInterval(() => {
        const overlay = document.querySelector('#calibrationOverlay');
        const progress = document.querySelector('#calibrationProgress')?.textContent || '';
        if (overlay?.hidden || progress !== initialProgress) {
          cleanup();
        }
      }, 20);
      const timeout = window.__aoiDiagnosticNativeSetTimeout || window.setTimeout;
      timeout(cleanup, 10000);
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

  await page.evaluate(() => window.__aoiInstallDiagnosticTimerClamp());
  const calibrationStarted = await startCalibrationOrKnownFakeCameraBoundary(page, {
    skipMessage: 'Known fake-camera WebGazer startup boundary.',
  });
  if (!calibrationStarted) {
    process.exit(0);
  }

  await page.locator('#cancelCalibrationButton').click();
  await page.locator('#rawGazeDiagnosticButton').click();
  await page.waitForFunction(() => /calibrat/i.test(document.querySelector('#viewerNotice')?.textContent || ''), null, { timeout: 30000 });
  assert.equal(await page.locator('#calibrationOverlay').evaluate((overlay) => overlay.hidden), true);
  assert.match(await page.locator('#viewerNotice').innerText(), /calibrate webcam.*raw gaze diagnostic/i);

  const calibrationRestarted = await startCalibrationOrKnownFakeCameraBoundary(page, {
    skipMessage: 'Known fake-camera WebGazer startup boundary.',
  });
  if (!calibrationRestarted) {
    process.exit(0);
  }
  await completeVisibleCalibration(page);
  await page.waitForFunction(() => document.querySelector('#calibrationOverlay')?.hidden === true);

  await page.locator('#rawGazeDiagnosticButton').click();
  await page.waitForSelector('#calibrationOverlay:not([hidden])', { timeout: 45000 });

  await page.locator('#calibrationTarget').click();
  await page.waitForFunction(() => {
    const progress = document.querySelector('#calibrationProgress')?.textContent || '';
    const notice = document.querySelector('#viewerNotice')?.textContent || '';
    return progress.startsWith('Raw gaze 2 of') || /raw webcam gaze/i.test(notice);
  }, null, { timeout: 30000 });
  assert.match(await page.locator('#calibrationProgress').innerText(), /^Raw gaze 1 of/);
  assert.match(
    await page.locator('#viewerNotice').innerText(),
    /waiting for raw webcam gaze|raw webcam gaze/i,
  );

  await page.evaluate(() => window.__aoiEmitOneGazeForCurrentTarget());
  await page.waitForFunction(() => {
    const dot = document.querySelector('#gazeDot');
    return dot?.style.transform && !dot.style.transform.includes('-100px');
  }, null, { timeout: 30000 });
  await page.waitForTimeout(350);
  assert.equal(
    await page.locator('#gazeDot').evaluate((dot) => !dot.style.transform.includes('-100px')),
    true,
    'Raw diagnostic cursor should remain visible between sparse WebGazer emissions.',
  );

  const cursorProbe = page.evaluate(() => window.__aoiEmitGazeForCurrentTarget(700));
  await page.waitForFunction(() => {
    const dot = document.querySelector('#gazeDot');
    const overlay = document.querySelector('#calibrationOverlay');
    if (!dot || !overlay || overlay.hidden) {
      return false;
    }

    const dotStyle = getComputedStyle(dot);
    const overlayStyle = getComputedStyle(overlay);
    const dotZIndex = Number.parseInt(dotStyle.zIndex, 10);
    const overlayZIndex = Number.parseInt(overlayStyle.zIndex, 10);
    return (
      dot.style.transform
      && !dot.style.transform.includes('-100px')
      && Number.isFinite(dotZIndex)
      && Number.isFinite(overlayZIndex)
      && dotZIndex > overlayZIndex
    );
  }, null, { timeout: 30000 });
  await cursorProbe;

  for (let index = 0; index < 5; index += 1) {
    await Promise.all([
      page.evaluate(() => window.__aoiEmitGazeForCurrentTargetUntilDone()),
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
  const stableSummary = metadata.rawGazeDiagnostic.latestSummary;
  assert.notEqual(stableSummary.quality, 'unusable');
  assert.equal(stableSummary.shouldBlockRecording, false);
  assert.equal(stableSummary.p90JitterPx < 1, true);
  assert.equal(stableSummary.p90BiasPx < 1, true);
  assert.match(await page.locator('#rawGazeDiagnosticStatus').innerText(), /good|coarse/i);

  await page.locator('#rawGazeDiagnosticButton').click();
  await page.waitForSelector('#calibrationOverlay:not([hidden])', { timeout: 45000 });

  for (let index = 0; index < 5; index += 1) {
    await Promise.all([
      page.evaluate(() => window.__aoiEmitGazeForCurrentTargetUntilDone({ noisy: true })),
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
