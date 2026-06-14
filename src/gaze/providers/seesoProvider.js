const DEFAULT_SEESO_MODULE_PATH = '../../../node_modules/seeso/dist/seeso.min.js';
const DEFAULT_SEESO_USER_ID = 'aoi-prototype-user';
const DEFAULT_TRACKING_SUCCESS = 0;
const SEESO_INITIALIZATION_ERRORS = new Map([
  [1, {
    name: 'ERROR_INIT',
    message: 'The SDK runtime could not initialize. For Web, this is commonly caused by missing SharedArrayBuffer or missing cross-origin isolation headers.',
  }],
  [2, {
    name: 'ERROR_CAMERA_PERMISSION',
    message: 'Camera permission was denied or the camera could not be opened.',
  }],
  [3, {
    name: 'AUTH_INVALID_KEY',
    message: 'The Eyedid SeeSo license key is invalid.',
  }],
  [4, {
    name: 'AUTH_INVALID_ENV_USED_DEV_IN_PROD',
    message: 'A development license key is being used in a production environment.',
  }],
  [5, {
    name: 'AUTH_INVALID_ENV_USED_PROD_IN_DEV',
    message: 'A production license key is being used in a development environment.',
  }],
  [8, {
    name: 'AUTH_EXCEEDED_FREE_TIER',
    message: 'The free usage limit for this license key has been exceeded.',
  }],
  [13, {
    name: 'AUTH_CANNOT_FIND_HOST',
    message: 'The SDK could not reach the Eyedid authentication host. Check network access.',
  }],
  [15, {
    name: 'AUTH_INVALID_KEY_FORMAT',
    message: 'The license key format is invalid.',
  }],
  [16, {
    name: 'AUTH_EXPIRED_KEY',
    message: 'The license key has expired.',
  }],
]);

export function parseSeeSoCalibrationDataFromUrl(urlString) {
  try {
    const match = String(urlString).match(/[?&]calibrationData=([^&#]*)/);
    if (!match) {
      return null;
    }

    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

export function buildSeeSoRedirectUrl(urlString) {
  const url = new URL(urlString);
  url.searchParams.set('gazeProvider', 'seeso');
  url.searchParams.delete('calibrationData');
  return url;
}

export function describeSeeSoInitializationError(code) {
  const numericCode = Number(code);
  const knownError = SEESO_INITIALIZATION_ERRORS.get(numericCode);
  const label = knownError ? `${knownError.name} ${numericCode}` : String(code);
  const guidance = knownError?.message ?? 'The SDK returned an unknown initialization error.';

  return `Eyedid SeeSo initialization failed (${label}). ${guidance}`;
}

async function loadSeeSoSdk({
  moduleLoader = (path) => import(path),
  modulePath = DEFAULT_SEESO_MODULE_PATH,
} = {}) {
  const module = await moduleLoader(modulePath);
  const SeeSo = module.default ?? module.SeeSo ?? module.Seeso;

  if (typeof SeeSo !== 'function') {
    throw new Error('Eyedid SeeSo SDK module did not export a tracker class.');
  }

  return {
    SeeSo,
    TrackingState: module.TrackingState ?? { SUCCESS: DEFAULT_TRACKING_SUCCESS },
    InitializationErrorType: module.InitializationErrorType ?? { ERROR_NONE: 0 },
  };
}

function getTracks(stream) {
  return typeof stream?.getTracks === 'function' ? stream.getTracks() : [];
}

function isSuccessfulGaze(gazeInfo, TrackingState) {
  const success = TrackingState?.SUCCESS ?? DEFAULT_TRACKING_SUCCESS;

  return (
    gazeInfo?.trackingState === undefined ||
    gazeInfo.trackingState === success
  );
}

function hasSharedArrayBuffer(windowRef) {
  return (
    typeof windowRef?.SharedArrayBuffer === 'function' ||
    typeof globalThis.SharedArrayBuffer === 'function'
  );
}

function shouldCheckBrowserRuntime(windowRef) {
  return Boolean(
    windowRef?.document ||
    windowRef?.crossOriginIsolated === false ||
    windowRef?.SharedArrayBuffer !== undefined
  );
}

function parseCalibrationSettings(calibrationData) {
  if (!calibrationData) {
    return null;
  }

  try {
    const data = typeof calibrationData === 'string'
      ? JSON.parse(calibrationData)
      : calibrationData;
    return data && typeof data === 'object' ? data : null;
  } catch {
    return null;
  }
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function positiveNumber(value) {
  const number = finiteNumber(value);
  return number !== null && number > 0 ? number : null;
}

export function createSeeSoProvider({
  sdk = null,
  moduleLoader,
  modulePath = DEFAULT_SEESO_MODULE_PATH,
  licenseKey,
  calibrationData = null,
  userId = DEFAULT_SEESO_USER_ID,
  monitorSizeInch = 14,
  faceDistanceCm = 50,
  windowRef = globalThis.window ?? {},
  navigatorRef = globalThis.navigator ?? {},
  onGaze,
  onFaceQuality,
} = {}) {
  let resolvedSdk = sdk;
  let tracker = null;
  let stream = null;
  let gazeCallback = null;
  let startToken = 0;
  let stopRequested = false;

  async function getSdk() {
    if (!resolvedSdk) {
      resolvedSdk = await loadSeeSoSdk({ moduleLoader, modulePath });
    }

    return resolvedSdk;
  }

  function emitUnavailableFaceQuality(reason = 'provider-seeso-face-quality-unmapped') {
    onFaceQuality?.({
      available: false,
      reason,
    });
  }

  async function assertLicenseKey() {
    if (!String(licenseKey || '').trim()) {
      throw new Error('Eyedid SeeSo license key is required.');
    }
  }

  function assertRuntimeEnvironment() {
    if (!shouldCheckBrowserRuntime(windowRef)) {
      return;
    }

    if (!hasSharedArrayBuffer(windowRef) || windowRef?.crossOriginIsolated === false) {
      throw new Error(
        'Eyedid SeeSo requires SharedArrayBuffer on a cross-origin isolated page. Restart with `npm run serve` and open http://localhost:5179 so COOP/COEP headers are present.',
      );
    }
  }

  function isCurrentStart(token, nextTracker) {
    return token === startToken && !stopRequested && tracker === nextTracker;
  }

  function cancelStartupIfNeeded(nextTracker, nextStream = null) {
    getTracks(nextStream).forEach((track) => track.stop?.());

    if (tracker === nextTracker) {
      nextTracker?.stopTracking?.();
      nextTracker?.deinitialize?.();
      tracker = null;
    }
  }

  function assertCurrentStart(token, nextTracker, nextStream = null) {
    if (isCurrentStart(token, nextTracker)) {
      return;
    }

    cancelStartupIfNeeded(nextTracker, nextStream);
    throw new Error('Eyedid SeeSo startup was cancelled.');
  }

  function getDefaultCameraX() {
    return (
      positiveNumber(windowRef?.screen?.width) ||
      positiveNumber(windowRef?.outerWidth) ||
      positiveNumber(windowRef?.innerWidth) ||
      0
    ) / 2;
  }

  function configureTrackerGeometry(nextTracker, calibrationSettings = null) {
    const monitorInch = positiveNumber(calibrationSettings?.monitorInch) ?? monitorSizeInch;
    const faceDistance = positiveNumber(calibrationSettings?.faceDistance) ?? faceDistanceCm;
    const cameraX = finiteNumber(calibrationSettings?.cameraX) ?? getDefaultCameraX();
    const isCameraOnTop = typeof calibrationSettings?.isCameraOnTop === 'boolean'
      ? calibrationSettings.isCameraOnTop
      : true;

    nextTracker.setMonitorSize?.(monitorInch);
    nextTracker.setFaceDistance?.(faceDistance);
    nextTracker.setCameraPosition?.(cameraX, isCameraOnTop);
  }

  return {
    providerId: 'seeso',
    usesHostedCalibration: true,
    async start() {
      await assertLicenseKey();
      assertRuntimeEnvironment();
      const { SeeSo, TrackingState, InitializationErrorType } = await getSdk();
      const okCode = InitializationErrorType?.ERROR_NONE ?? 0;
      const token = startToken + 1;

      startToken = token;
      stopRequested = false;
      const nextTracker = new SeeSo();
      tracker = nextTracker;

      const initCode = await nextTracker.initialize(licenseKey);
      assertCurrentStart(token, nextTracker);
      if (initCode !== okCode) {
        throw new Error(describeSeeSoInitializationError(initCode));
      }

      const calibrationSettings = parseCalibrationSettings(calibrationData);
      configureTrackerGeometry(nextTracker, calibrationSettings);

      gazeCallback = (gazeInfo) => {
        if (
          !isSuccessfulGaze(gazeInfo, TrackingState) ||
          !Number.isFinite(gazeInfo?.x) ||
          !Number.isFinite(gazeInfo?.y)
        ) {
          return;
        }

        onGaze?.({
          x: gazeInfo.x,
          y: gazeInfo.y,
          visible: true,
          source: 'webcam',
        });
      };
      nextTracker.addGazeCallback?.(gazeCallback);

      nextTracker.addFaceCallback?.(() => {
        emitUnavailableFaceQuality();
      });

      const nextStream = await navigatorRef.mediaDevices.getUserMedia({ video: true });
      assertCurrentStart(token, nextTracker, nextStream);
      stream = nextStream;

      if (calibrationData) {
        await nextTracker.setCalibrationData?.(calibrationData);
        assertCurrentStart(token, nextTracker);
      }

      if (nextTracker.startTracking?.(stream) === false) {
        throw new Error('Eyedid SeeSo tracking could not start.');
      }
      assertCurrentStart(token, nextTracker);

      emitUnavailableFaceQuality();
    },
    async resetCalibration() {
      calibrationData = null;
    },
    recordCalibrationPoint() {},
    async openCalibrationPage({
      redirectUrl,
      calibrationPointCount = 5,
      userId: nextUserId = userId,
      calibrationUserId = nextUserId,
    } = {}) {
      await assertLicenseKey();
      const { SeeSo } = await getSdk();
      SeeSo.openCalibrationPage(
        licenseKey,
        calibrationUserId || DEFAULT_SEESO_USER_ID,
        redirectUrl,
        calibrationPointCount,
      );
    },
    async setCalibrationData(nextCalibrationData) {
      calibrationData = nextCalibrationData;
      await tracker?.setCalibrationData?.(nextCalibrationData);
    },
    stop() {
      stopRequested = true;
      startToken += 1;
      if (tracker && gazeCallback) {
        tracker.removeGazeCallback?.(gazeCallback);
      }
      tracker?.stopTracking?.();
      getTracks(stream).forEach((track) => track.stop?.());
      tracker?.deinitialize?.();
      tracker = null;
      stream = null;
      gazeCallback = null;
    },
  };
}
