const DEFAULT_SEESO_MODULE_PATH = '../../../node_modules/seeso/dist/seeso.min.js';
const DEFAULT_SEESO_USER_ID = 'aoi-prototype-user';
const DEFAULT_TRACKING_SUCCESS = 0;
const SEESO_INITIALIZATION_ERRORS = new Map([
  [1, {
    name: 'ERROR_INIT',
    message: 'Runtime SDK không thể khởi tạo. Trên Web, nguyên nhân thường là thiếu SharedArrayBuffer hoặc thiếu header cách ly cross-origin.',
  }],
  [2, {
    name: 'ERROR_CAMERA_PERMISSION',
    message: 'Quyền camera bị từ chối hoặc không thể mở camera.',
  }],
  [3, {
    name: 'AUTH_INVALID_KEY',
    message: 'Khóa bộ theo dõi lưu trữ không hợp lệ.',
  }],
  [4, {
    name: 'AUTH_INVALID_ENV_USED_DEV_IN_PROD',
    message: 'Khóa bộ theo dõi phát triển đang được dùng trong môi trường production.',
  }],
  [5, {
    name: 'AUTH_INVALID_ENV_USED_PROD_IN_DEV',
    message: 'Khóa bộ theo dõi production đang được dùng trong môi trường phát triển.',
  }],
  [8, {
    name: 'AUTH_EXCEEDED_FREE_TIER',
    message: 'Đã vượt quá giới hạn miễn phí của khóa bộ theo dõi này.',
  }],
  [13, {
    name: 'AUTH_CANNOT_FIND_HOST',
    message: 'SDK không thể kết nối máy chủ xác thực bộ theo dõi. Hãy kiểm tra mạng.',
  }],
  [15, {
    name: 'AUTH_INVALID_KEY_FORMAT',
    message: 'Định dạng khóa bộ theo dõi không hợp lệ.',
  }],
  [16, {
    name: 'AUTH_EXPIRED_KEY',
    message: 'Khóa bộ theo dõi đã hết hạn.',
  }],
]);

export function parseSeeSoCalibrationDataFromUrl(urlString) {
  try {
    const rawUrl = String(urlString);
    const directMatch = rawUrl.match(/[?&]calibrationData=([^&#]*)/);
    if (directMatch) {
      return decodeURIComponent(directMatch[1]);
    }

    const url = new URL(rawUrl);
    const modeValue = url.searchParams.get('mode') || '';
    const embeddedMatch = modeValue.match(/[?&]calibrationData=([^&#]*)/);
    if (embeddedMatch) {
      return decodeURIComponent(embeddedMatch[1]);
    }

    return null;
  } catch {
    return null;
  }
}

export function buildSeeSoRedirectUrl(urlString) {
  const url = new URL(urlString);
  const modeValue = url.searchParams.get('mode') || '';
  const embeddedQueryIndex = modeValue.indexOf('?');
  if (embeddedQueryIndex >= 0) {
    url.searchParams.set('mode', modeValue.slice(0, embeddedQueryIndex));
  }
  url.searchParams.set('gazeProvider', 'seeso');
  url.searchParams.delete('calibrationData');
  return url;
}

export function describeSeeSoInitializationError(code) {
  const numericCode = Number(code);
  const knownError = SEESO_INITIALIZATION_ERRORS.get(numericCode);
  const label = knownError ? `${knownError.name} ${numericCode}` : String(code);
  const guidance = knownError?.message ?? 'SDK trả về lỗi khởi tạo không xác định.';

  return `Khởi tạo bộ theo dõi ánh nhìn lưu trữ thất bại (${label}). ${guidance}`;
}

async function loadSeeSoSdk({
  moduleLoader = (path) => import(path),
  modulePath = DEFAULT_SEESO_MODULE_PATH,
} = {}) {
  const module = await moduleLoader(modulePath);
  const SeeSo = module.default ?? module.SeeSo ?? module.Seeso;

  if (typeof SeeSo !== 'function') {
    throw new Error('Module SDK bộ theo dõi ánh nhìn lưu trữ không xuất lớp theo dõi.');
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
      throw new Error('Cần có khóa bộ theo dõi ánh nhìn lưu trữ.');
    }
  }

  function assertRuntimeEnvironment() {
    if (!shouldCheckBrowserRuntime(windowRef)) {
      return;
    }

    if (!hasSharedArrayBuffer(windowRef) || windowRef?.crossOriginIsolated === false) {
      throw new Error(
        'Theo dõi ánh nhìn lưu trữ cần SharedArrayBuffer trên trang đã cách ly cross-origin. Hãy khởi động lại bằng `npm run serve` và mở http://localhost:5179 để có header COOP/COEP.',
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
    throw new Error('Khởi động bộ theo dõi ánh nhìn lưu trữ đã bị hủy.');
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
        throw new Error('Không thể bắt đầu theo dõi ánh nhìn lưu trữ.');
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
