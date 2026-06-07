import assert from 'node:assert/strict';

import { chromium } from 'playwright';

const TARGET_URL = process.env.AOI_PROTOTYPE_URL || 'http://127.0.0.1:5179';

async function captureAllTargets(page, progressPattern, emitExpression) {
  const progressText = await page.locator('#calibrationProgress').innerText();
  const targetCount = Number(progressText.match(progressPattern)?.[1]);

  for (let index = 0; index < targetCount; index += 1) {
    await Promise.all([
      page.evaluate(emitExpression),
      page.locator('#calibrationTarget').click(),
    ]);

    if (index < targetCount - 1) {
      await page.waitForFunction(
        ({ label, targetIndex }) => document.querySelector('#calibrationProgress')?.textContent?.startsWith(`${label} ${targetIndex + 2}`),
        {
          label: progressText.startsWith('Accuracy') ? 'Accuracy target' : 'Target',
          targetIndex: index,
        },
        { timeout: 30000 },
      );
    }
  }

  await page.waitForFunction(() => document.querySelector('#calibrationOverlay')?.hidden === true);
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
  await page.goto(TARGET_URL, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => Boolean(window.webgazer?.setGazeListener));
  await page.evaluate(() => {
    window.webgazer.setGazeListener = (callback) => {
      window.__aoiGazeListener = callback;
      return window.webgazer;
    };

    window.__aoiEmitStableGazeForCurrentTarget = (durationMs = 5200) => new Promise((resolve) => {
      const target = document.querySelector('#calibrationTarget').getBoundingClientRect();
      const gaze = {
        x: target.left + target.width / 2 + 72,
        y: target.top + target.height / 2 - 34,
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

    window.__aoiStartViewerCenterGaze = () => {
      const viewer = document.querySelector('#viewer').getBoundingClientRect();
      const startedAt = performance.now();
      const emit = () => {
        window.__aoiGazeListener?.({
          x: viewer.left + viewer.width / 2,
          y: viewer.top + viewer.height / 2,
        }, performance.now() - startedAt);
      };
      emit();
      window.__aoiViewerCenterInterval = window.setInterval(emit, 20);
    };

    window.__aoiStopViewerCenterGaze = () => {
      window.clearInterval(window.__aoiViewerCenterInterval);
    };
  });

  await page.locator('#calibrateButton').click();
  await page.waitForSelector('#calibrationOverlay:not([hidden])', { timeout: 45000 });
  await captureAllTargets(
    page,
    /Target 1 of (\d+)/,
    () => window.__aoiEmitStableGazeForCurrentTarget(),
  );

  await page.locator('#accuracyButton').click();
  await page.waitForSelector('#calibrationOverlay:not([hidden])', { timeout: 45000 });
  await captureAllTargets(
    page,
    /Accuracy target 1 of (\d+)/,
    () => window.__aoiEmitStableGazeForCurrentTarget(),
  );

  assert.match(await page.locator('#accuracyStatusLabel').innerText(), /^validated \d+px$/);

  await page.locator('#recordButton').click();
  assert.equal(await page.locator('#recordButton').innerText(), 'Stop Recording');
  await page.evaluate(() => {
    window.__aoiValidationMaxAgeMs = 700;
  });

  await page.evaluate(() => window.__aoiStartViewerCenterGaze());
  await page.waitForFunction(() => /^x \d+, y \d+$/.test(document.querySelector('#screenReadout')?.textContent || ''));
  await page.waitForFunction(
    () => document.querySelector('#recordButton')?.textContent === 'Start Recording',
    null,
    { timeout: 2500 },
  );
  await page.evaluate(() => window.__aoiStopViewerCenterGaze());

  assert.equal(
    await page.locator('#accuracyStatusLabel').innerText(),
    'recheck needed',
    'Expired webcam validation should stop recording and require a new accuracy check.',
  );
  assert.match(
    await page.locator('#viewerNotice').innerText(),
    /expired|Check accuracy|recheck/i,
  );
} finally {
  await browser.close();
}
