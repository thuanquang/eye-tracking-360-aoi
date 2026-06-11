import test from 'node:test';
import assert from 'node:assert/strict';

import { createMouseProvider } from '../src/gaze/providers/mouseProvider.js';
import { createWebGazerProvider } from '../src/gaze/providers/webgazerProvider.js';

test('mouse provider emits viewer-relative gaze points', () => {
  const emitted = [];
  const viewer = {
    getBoundingClientRect: () => ({ left: 10, top: 20, width: 300, height: 200 }),
    addEventListener(type, listener) {
      this.listener = listener;
    },
    removeEventListener() {},
  };
  const provider = createMouseProvider({ viewer, onGaze: (gaze) => emitted.push(gaze) });

  provider.start();
  viewer.listener({ clientX: 110, clientY: 70 });

  assert.deepEqual(emitted[0], {
    x: 100,
    y: 50,
    visible: true,
    source: 'mouse',
  });
});

test('webgazer provider configures controlled calibration and forwards gaze', async () => {
  const calls = [];
  let listener = null;
  const webgazer = {
    saveDataAcrossSessions(value) { calls.push(['saveDataAcrossSessions', value]); return this; },
    setRegression(value) { calls.push(['setRegression', value]); return this; },
    setTracker(value) { calls.push(['setTracker', value]); return this; },
    applyKalmanFilter(value) { calls.push(['applyKalmanFilter', value]); return this; },
    showFaceOverlay(value) { calls.push(['showFaceOverlay', value]); return this; },
    showFaceFeedbackBox(value) { calls.push(['showFaceFeedbackBox', value]); return this; },
    showVideoPreview(value) { calls.push(['showVideoPreview', value]); return this; },
    removeMouseEventListeners() { calls.push(['removeMouseEventListeners']); return this; },
    setGazeListener(callback) { listener = callback; return this; },
    async begin() { calls.push(['begin']); },
    recordScreenPosition(x, y, eventType) { calls.push(['recordScreenPosition', x, y, eventType]); },
    async clearData() { calls.push(['clearData']); },
  };
  const emitted = [];
  const provider = createWebGazerProvider({
    webgazer,
    onGaze: (gaze) => emitted.push(gaze),
  });

  await provider.start();
  listener({ x: 11, y: 22 });
  provider.recordCalibrationPoint({ x: 33, y: 44 });
  await provider.resetCalibration();

  assert.deepEqual(calls.slice(0, 4), [
    ['saveDataAcrossSessions', false],
    ['setRegression', 'ridge'],
    ['setTracker', 'TFFacemesh'],
    ['applyKalmanFilter', false],
  ]);
  assert.deepEqual(emitted[0], { x: 11, y: 22, visible: true, source: 'webcam' });
  assert.equal(calls.some((call) => call[0] === 'recordScreenPosition'), true);
  assert.equal(calls.some((call) => call[0] === 'clearData'), true);
});
