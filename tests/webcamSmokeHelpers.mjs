import assert from 'node:assert/strict';

export async function startCalibrationOrKnownFakeCameraBoundary(page, {
  actionLabel = 'Calibrate webcam',
  skipMessage = 'Only the known fake-camera WebGazer startup boundary should skip this webcam smoke.',
} = {}) {
  await page.locator('#calibrateButton').click();

  let result;

  try {
    const handle = await page.waitForFunction(() => {
      const overlay = document.querySelector('#calibrationOverlay');
      if (overlay && overlay.hidden === false) {
        return { state: 'ready' };
      }

      const status = document.querySelector('#webcamStatusLabel')?.textContent?.trim();
      if (['blocked', 'unloaded', 'no api'].includes(status)) {
        return {
          state: 'webcam-failed',
          status,
          notice: document.querySelector('#viewerNotice')?.textContent?.trim() || '',
        };
      }

      return null;
    }, null, { timeout: 45000 });
    result = await handle.jsonValue();
  } catch (error) {
    const diagnostics = await page.evaluate(() => ({
      status: document.querySelector('#webcamStatusLabel')?.textContent?.trim() || 'unknown',
      notice: document.querySelector('#viewerNotice')?.textContent?.trim() || '',
      overlayHidden: document.querySelector('#calibrationOverlay')?.hidden ?? null,
    }));

    if (
      diagnostics.status === 'blocked'
      && /Could not start webcam gaze: t is not a function/.test(diagnostics.notice)
    ) {
      assert.match(diagnostics.notice, /Could not start webcam gaze: t is not a function/, skipMessage);
      return false;
    }

    throw new Error(
      `${actionLabel} did not open calibration overlay before timeout. `
      + `Webcam status: ${diagnostics.status}; notice: ${diagnostics.notice}; `
      + `overlayHidden: ${diagnostics.overlayHidden}. Original error: ${error.message}`,
    );
  }

  if (result?.state === 'ready') {
    return true;
  }

  if (
    result?.status === 'blocked'
    && /Could not start webcam gaze: t is not a function/.test(result.notice)
  ) {
    assert.match(result.notice, /Could not start webcam gaze: t is not a function/, skipMessage);
    return false;
  }

  throw new Error(
    `${actionLabel} could not start. `
    + `Webcam status: ${result?.status ?? 'unknown'}; notice: ${result?.notice ?? ''}.`,
  );
}
