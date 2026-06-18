import assert from 'node:assert/strict';

import { chromium } from 'playwright';

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
const failedMediaPipeResponses = [];

page.on('response', (response) => {
  if (response.status() >= 400 && response.url().includes('/mediapipe/face_mesh/')) {
    failedMediaPipeResponses.push({ status: response.status(), url: response.url() });
  }
});

try {
  await page.goto(urlWithMode('admin'), { waitUntil: 'networkidle' });
  await page.waitForFunction(() => Boolean(window.webgazer?.begin && window.webgazer?.setTracker));

  await page.locator('#calibrateButton').click();
  await page.waitForSelector('#calibrationOverlay:not([hidden])', { timeout: 45000 });

  assert.deepEqual(
    failedMediaPipeResponses,
    [],
    'WebGazer FaceMesh startup should load MediaPipe assets without 404s.',
  );
  assert.equal(await page.locator('#webcamStatusLabel').innerText(), 'calibrating');
} finally {
  await browser.close();
}
