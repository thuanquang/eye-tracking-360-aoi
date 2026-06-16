import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { createMouseProvider } from '../src/gaze/providers/mouseProvider.js';
import {
  buildSeeSoRedirectUrl,
  createSeeSoProvider,
  describeSeeSoInitializationError,
  parseSeeSoCalibrationDataFromUrl,
} from '../src/gaze/providers/seesoProvider.js';
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

test('seeso provider initializes tracker and forwards successful gaze', async () => {
  const calls = [];
  const emitted = [];
  let gazeCallback = null;
  const track = { stop() { calls.push(['track.stop']); } };
  class FakeSeeSo {
    async initialize(licenseKey) {
      calls.push(['initialize', licenseKey]);
      return 0;
    }

    setMonitorSize(value) { calls.push(['setMonitorSize', value]); }
    setFaceDistance(value) { calls.push(['setFaceDistance', value]); }
    setCameraPosition(x, isTop) { calls.push(['setCameraPosition', x, isTop]); }
    addGazeCallback(callback) { gazeCallback = callback; calls.push(['addGazeCallback']); }
    addFaceCallback(callback) { calls.push(['addFaceCallback', typeof callback]); }
    startTracking(stream) { calls.push(['startTracking', stream.id]); return true; }
    async setCalibrationData(value) { calls.push(['setCalibrationData', value]); }
    removeGazeCallback(callback) { calls.push(['removeGazeCallback', callback === gazeCallback]); }
    stopTracking() { calls.push(['stopTracking']); }
    deinitialize() { calls.push(['deinitialize']); }
  }
  const provider = createSeeSoProvider({
    sdk: {
      SeeSo: FakeSeeSo,
      TrackingState: { SUCCESS: 0, FACE_MISSING: 3 },
      InitializationErrorType: { ERROR_NONE: 0 },
    },
    licenseKey: 'dev-key',
    calibrationData: '{"vector":"abc"}',
    windowRef: { outerWidth: 1200 },
    navigatorRef: {
      mediaDevices: {
        async getUserMedia() {
          calls.push(['getUserMedia']);
          return { id: 'camera-stream', getTracks: () => [track] };
        },
      },
    },
    onGaze: (gaze) => emitted.push(gaze),
  });

  await provider.start();
  gazeCallback({ x: 11, y: 22, trackingState: 0 });
  gazeCallback({ x: 33, y: 44, trackingState: 3 });
  provider.stop();

  assert.deepEqual(emitted, [{
    x: 11,
    y: 22,
    visible: true,
    source: 'webcam',
  }]);
  assert.deepEqual(calls, [
    ['initialize', 'dev-key'],
    ['setMonitorSize', 14],
    ['setFaceDistance', 50],
    ['setCameraPosition', 600, true],
    ['addGazeCallback'],
    ['addFaceCallback', 'function'],
    ['getUserMedia'],
    ['setCalibrationData', '{"vector":"abc"}'],
    ['startTracking', 'camera-stream'],
    ['removeGazeCallback', true],
    ['stopTracking'],
    ['track.stop'],
    ['deinitialize'],
  ]);
});

test('seeso provider applies calibration geometry before tracking starts', async () => {
  const calls = [];
  const calibrationData = JSON.stringify({
    vector: 'abc+def/ghi==',
    vectorLength: 3,
    isCameraOnTop: false,
    cameraX: 420,
    monitorInch: 15.6,
    faceDistance: 63,
  });
  class FakeSeeSo {
    async initialize() {
      calls.push(['initialize']);
      return 0;
    }

    setMonitorSize(value) { calls.push(['setMonitorSize', value]); }
    setFaceDistance(value) { calls.push(['setFaceDistance', value]); }
    setCameraPosition(x, isTop) { calls.push(['setCameraPosition', x, isTop]); }
    addGazeCallback() { calls.push(['addGazeCallback']); }
    addFaceCallback() { calls.push(['addFaceCallback']); }
    async setCalibrationData(value) { calls.push(['setCalibrationData', value]); }
    startTracking(stream) { calls.push(['startTracking', stream.id]); return true; }
  }
  const provider = createSeeSoProvider({
    sdk: {
      SeeSo: FakeSeeSo,
      TrackingState: { SUCCESS: 0 },
      InitializationErrorType: { ERROR_NONE: 0 },
    },
    licenseKey: 'dev-key',
    calibrationData,
    windowRef: { screen: { width: 1280 }, outerWidth: 1200 },
    navigatorRef: {
      mediaDevices: {
        async getUserMedia() {
          calls.push(['getUserMedia']);
          return { id: 'camera-stream', getTracks: () => [] };
        },
      },
    },
    onGaze: () => {},
  });

  await provider.start();

  assert.deepEqual(calls, [
    ['initialize'],
    ['setMonitorSize', 15.6],
    ['setFaceDistance', 63],
    ['setCameraPosition', 420, false],
    ['addGazeCallback'],
    ['addFaceCallback'],
    ['getUserMedia'],
    ['setCalibrationData', calibrationData],
    ['startTracking', 'camera-stream'],
  ]);
});

test('seeso provider opens hosted calibration and parses returned data', async () => {
  const calls = [];
  class FakeSeeSo {
    static openCalibrationPage(...args) {
      calls.push(args);
    }
  }
  const provider = createSeeSoProvider({
    sdk: { SeeSo: FakeSeeSo },
    licenseKey: 'dev-key',
    onGaze: () => {},
  });

  await provider.openCalibrationPage({
    userId: 'participant-1',
    redirectUrl: 'http://localhost:5179/?mode=admin&gazeProvider=seeso',
    calibrationPointCount: 5,
  });

  assert.deepEqual(calls, [[
    'dev-key',
    'participant-1',
    'http://localhost:5179/?mode=admin&gazeProvider=seeso',
    5,
  ]]);
  assert.equal(
    parseSeeSoCalibrationDataFromUrl('http://localhost:5179/?calibrationData=%7B%22vector%22%3A%22abc%22%7D'),
    '{"vector":"abc"}',
  );
  assert.equal(
    parseSeeSoCalibrationDataFromUrl('http://localhost:5179/?calibrationData={"vector":"abc+def/ghi=="}'),
    '{"vector":"abc+def/ghi=="}',
  );
  assert.equal(
    buildSeeSoRedirectUrl('http://localhost:5179/?mode=admin&calibrationData=old').toString(),
    'http://localhost:5179/?mode=admin&gazeProvider=seeso',
  );
  const malformedValidationReturn = 'http://localhost:5179/?mode=validation%3FcalibrationData%3D%7B%22vector%22%3A%22abc%22%7D&gazeProvider=seeso';
  assert.equal(
    parseSeeSoCalibrationDataFromUrl(malformedValidationReturn),
    '{"vector":"abc"}',
  );
  assert.equal(
    buildSeeSoRedirectUrl(malformedValidationReturn).toString(),
    'http://localhost:5179/?mode=validation&gazeProvider=seeso',
  );
});

test('seeso provider explains missing SharedArrayBuffer runtime before starting', async () => {
  class FakeSeeSo {
    async initialize() {
      return 0;
    }
  }
  const provider = createSeeSoProvider({
    sdk: {
      SeeSo: FakeSeeSo,
      InitializationErrorType: { ERROR_NONE: 0 },
    },
    licenseKey: 'dev-key',
    windowRef: { crossOriginIsolated: false },
    navigatorRef: {
      mediaDevices: {
        async getUserMedia() {
          return { getTracks: () => [] };
        },
      },
    },
    onGaze: () => {},
  });

  await assert.rejects(
    provider.start(),
    /SharedArrayBuffer.*cross-origin/,
  );
});

test('seeso provider cancels cleanly when stopped during initialization', async () => {
  const calls = [];
  let resolveInitialize = null;
  class FakeSeeSo {
    async initialize() {
      calls.push(['initialize']);
      return new Promise((resolve) => {
        resolveInitialize = () => resolve(0);
      });
    }

    setMonitorSize() { calls.push(['setMonitorSize']); }
    deinitialize() { calls.push(['deinitialize']); }
  }
  const provider = createSeeSoProvider({
    sdk: {
      SeeSo: FakeSeeSo,
      InitializationErrorType: { ERROR_NONE: 0 },
    },
    licenseKey: 'dev-key',
    onGaze: () => {},
  });

  const startPromise = provider.start();
  for (let index = 0; index < 5 && !resolveInitialize; index += 1) {
    await Promise.resolve();
  }
  assert.equal(typeof resolveInitialize, 'function');
  provider.stop();
  resolveInitialize();

  await assert.rejects(
    startPromise,
    /đã bị hủy/i,
  );
  assert.deepEqual(calls, [
    ['initialize'],
    ['deinitialize'],
  ]);
});

test('seeso provider translates generic initialization failures into actionable guidance', async () => {
  class FakeSeeSo {
    async initialize() {
      return 1;
    }
  }
  const provider = createSeeSoProvider({
    sdk: {
      SeeSo: FakeSeeSo,
      InitializationErrorType: { ERROR_NONE: 0, ERROR_INIT: 1 },
    },
    licenseKey: 'dev-key',
    windowRef: { crossOriginIsolated: true, SharedArrayBuffer: function SharedArrayBuffer() {} },
    onGaze: () => {},
  });

  await assert.rejects(
    provider.start(),
    /ERROR_INIT.*SharedArrayBuffer.*cross-origin/,
  );
  assert.match(
    describeSeeSoInitializationError(3),
    /khóa bộ theo dõi.*không hợp lệ/i,
  );
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

test('app wires SeeSo as an alternate webcam gaze provider', async () => {
  const appSource = await readFile(new URL('../src/app/appController.js', import.meta.url), 'utf8');

  assert.match(appSource, /createSeeSoProvider/);
  assert.match(appSource, /webcamStartPromise/);
  assert.match(appSource, /webcamStartProviderId/);
  assert.match(appSource, /parseSeeSoCalibrationDataFromUrl/);
  assert.match(appSource, /buildSeeSoRedirectUrl/);
  assert.match(appSource, /gazeProviderSelect/);
  assert.match(appSource, /SEESO_EMBEDDED_LICENSE_KEY/);
  assert.match(appSource, /openCalibrationPage/);
});

test('app treats SeeSo calibration as hosted setup before webcam tracking', async () => {
  const appSource = await readFile(new URL('../src/app/appController.js', import.meta.url), 'utf8');
  const hostedStart = appSource.indexOf('async function startSeeSoHostedCalibration()');
  const calibrationStart = appSource.indexOf('async function startCalibration()');
  const calibrationEnd = appSource.indexOf('function cancelCalibration()');
  const hostedCalibrationFunction = hostedStart >= 0 && calibrationStart > hostedStart
    ? appSource.slice(hostedStart, calibrationStart)
    : '';
  const startCalibrationFunction = calibrationStart >= 0 && calibrationEnd > calibrationStart
    ? appSource.slice(calibrationStart, calibrationEnd)
    : '';
  const seeSoBranchIndex = startCalibrationFunction.indexOf('if (isSeeSoProviderSelected())');
  const webcamStartIndex = startCalibrationFunction.indexOf('await setWebcamMode()');

  assert.match(hostedCalibrationFunction, /createSeeSoProvider\(\{/);
  assert.ok(
    seeSoBranchIndex >= 0 && webcamStartIndex >= 0 && seeSoBranchIndex < webcamStartIndex,
    'SeeSo hosted calibration should open before local webcam gaze is started',
  );
});

test('app exposes admin SeeSo readiness controls', async () => {
  const appSource = await readFile(new URL('../src/app/appController.js', import.meta.url), 'utf8');
  const adminSyncStart = appSource.indexOf('function syncAdminGazeSetupControls()');
  const adminSyncEnd = appSource.indexOf('function syncParticipantGazeSetupControls()');
  const adminSyncFunction = adminSyncStart >= 0 && adminSyncEnd > adminSyncStart
    ? appSource.slice(adminSyncStart, adminSyncEnd)
    : '';

  assert.match(appSource, /gazeEngineStatus/);
  assert.match(adminSyncFunction, /Hiệu chuẩn bộ theo dõi/);
  assert.match(adminSyncFunction, /Hiệu chuẩn lại bộ theo dõi/);
  assert.match(adminSyncFunction, /Bắt đầu ánh nhìn \+ kiểm tra độ chính xác/);
  assert.match(adminSyncFunction, /accuracyButton\.disabled\s*=/);
  assert.match(adminSyncFunction, /recordButton\.disabled\s*=/);
});
