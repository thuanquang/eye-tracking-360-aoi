import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { createMouseProvider } from '../src/gaze/providers/mouseProvider.js';
import { createWebGazerProvider } from '../src/gaze/providers/webgazerProvider.js';

test('mouse provider emits viewer-relative gaze points', () => {
  const emitted = [];
  const listeners = new Map();
  const viewer = {
    getBoundingClientRect: () => ({ left: 10, top: 20, width: 300, height: 200 }),
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    removeEventListener() {},
  };
  const provider = createMouseProvider({ viewer, onGaze: (gaze) => emitted.push(gaze) });

  provider.start();
  listeners.get('pointermove')({ clientX: 110, clientY: 70 });

  assert.deepEqual(emitted[0], {
    x: 100,
    y: 50,
    visible: true,
    source: 'mouse',
  });
});

test('mouse provider detaches pointer listener when stopped', () => {
  const emitted = [];
  let attached = null;
  const removed = [];
  const viewer = {
    getBoundingClientRect: () => ({ left: 10, top: 20, width: 300, height: 200 }),
    addEventListener(type, listener) {
      attached = { type, listener };
    },
    removeEventListener(type, listener) {
      removed.push({ type, listener });
    },
  };
  const provider = createMouseProvider({ viewer, onGaze: (gaze) => emitted.push(gaze) });

  provider.start();
  provider.stop();
  attached.listener({ clientX: 110, clientY: 70 });

  assert.equal(attached.type, 'pointermove');
  assert.deepEqual(removed, [attached]);
  assert.equal(emitted.length, 0);
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

test('webgazer provider reports unavailable face quality without blocking gaze', async () => {
  let listener = null;
  const faceQualityEvents = [];
  const gazeEvents = [];
  const webgazer = {
    saveDataAcrossSessions() { return this; },
    setRegression() { return this; },
    setTracker() { return this; },
    applyKalmanFilter() { return this; },
    showFaceOverlay() { return this; },
    showFaceFeedbackBox() { return this; },
    showVideoPreview() { return this; },
    showPredictionPoints() { return this; },
    removeMouseEventListeners() { return this; },
    setGazeListener(callback) { listener = callback; return this; },
    async begin() {},
  };
  const provider = createWebGazerProvider({
    webgazer,
    onGaze: (gaze) => gazeEvents.push(gaze),
    onFaceQuality: (quality) => faceQualityEvents.push(quality),
  });

  await provider.start();
  listener({ x: 14, y: 28 });

  assert.deepEqual(faceQualityEvents, [{
    available: false,
    reason: 'provider-no-face-quality',
  }]);
  assert.deepEqual(gazeEvents, [{
    x: 14,
    y: 28,
    visible: true,
    source: 'webcam',
  }]);
});

test('webgazer provider expands ridge click training buffers after start and reset', async () => {
  function DataWindow(windowSize, existingData = []) {
    this.windowSize = windowSize;
    this.data = existingData.slice(-windowSize);
    this.length = this.data.length;
  }

  function createSmallRegression() {
    return {
      screenXClicksArray: new DataWindow(50, [[1], [2]]),
      screenYClicksArray: new DataWindow(50, [[3], [4]]),
      eyeFeaturesClicks: new DataWindow(50, ['left', 'right']),
      dataClicks: new DataWindow(50, [{ type: 'click' }]),
    };
  }

  let regression = createSmallRegression();
  const webgazer = {
    util: { DataWindow },
    saveDataAcrossSessions() { return this; },
    setRegression() { return this; },
    setTracker() { return this; },
    applyKalmanFilter() { return this; },
    showFaceOverlay() { return this; },
    showFaceFeedbackBox() { return this; },
    showVideoPreview() { return this; },
    showPredictionPoints() { return this; },
    removeMouseEventListeners() { return this; },
    setGazeListener() { return this; },
    getRegression() { return [regression]; },
    async begin() {},
    async clearData() {
      regression = createSmallRegression();
    },
  };
  const provider = createWebGazerProvider({ webgazer, onGaze: () => {} });

  await provider.start();

  assert.equal(regression.screenXClicksArray.windowSize >= 312, true);
  assert.equal(regression.screenYClicksArray.windowSize >= 312, true);
  assert.equal(regression.eyeFeaturesClicks.windowSize >= 312, true);
  assert.equal(regression.dataClicks.windowSize >= 312, true);
  assert.deepEqual(regression.screenXClicksArray.data, [[1], [2]]);

  await provider.resetCalibration();

  assert.equal(regression.screenXClicksArray.windowSize >= 312, true);
  assert.equal(regression.screenYClicksArray.windowSize >= 312, true);
  assert.equal(regression.eyeFeaturesClicks.windowSize >= 312, true);
  assert.equal(regression.dataClicks.windowSize >= 312, true);
});

test('webgazer provider prefers clearGazeListener during cleanup', () => {
  const calls = [];
  const webgazer = {
    clearGazeListener() { calls.push(['clearGazeListener']); },
    setGazeListener(callback) { calls.push(['setGazeListener', callback]); },
  };
  const provider = createWebGazerProvider({ webgazer, onGaze: () => {} });

  provider.stop();

  assert.deepEqual(calls, [['clearGazeListener']]);
});

test('app wires mouse gaze through the mouse provider', async () => {
  const appSource = await readFile(new URL('../src/app/appController.js', import.meta.url), 'utf8');
  const dragStart = appSource.indexOf('function drag(event)');
  const dragEnd = appSource.indexOf('function endDrag(event)');
  const dragFunction = dragStart >= 0 && dragEnd > dragStart
    ? appSource.slice(dragStart, dragEnd)
    : '';

  assert.match(appSource, /import \{ createMouseProvider \}/);
  assert.match(appSource, /createMouseProvider\(\{/);
  assert.match(appSource, /mouseProvider\.start\(\)/);
  assert.doesNotMatch(dragFunction, /source:\s*'mouse'/);
  assert.doesNotMatch(appSource, /window\.webgazer\?\.removeMouseEventListeners|window\.webgazer\.removeMouseEventListeners/);
});
