const DEFAULT_SEESO_MODULE_PATH = '../../../vendor/seeso/seeso.min.js';
const DEFAULT_SEESO_USER_ID = 'aoi-prototype-user';
const DEFAULT_TRACKING_SUCCESS = 0;
const SEESO_CALIBRATION_SERVICE_URL = 'https://calibration.seeso.io/#/service';
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

function getHashModeValue(hash) {
  const hashValue = String(hash || '').replace(/^#/, '');
  if (!hashValue) {
    return '';
  }

  return new URLSearchParams(hashValue).get('mode') || '';
}

export function buildSeeSoRedirectUrl(urlString, { includeProvider = true, modePlacement = 'search' } = {}) {
  const url = new URL(urlString);
  const modeValue = url.searchParams.get('mode') || getHashModeValue(url.hash);
  const embeddedQueryIndex = modeValue.indexOf('?');
  const cleanModeValue = embeddedQueryIndex >= 0
    ? modeValue.slice(0, embeddedQueryIndex)
    : modeValue;
  if (embeddedQueryIndex >= 0) {
    url.searchParams.set('mode', cleanModeValue);
  }
  url.searchParams.delete('calibrationData');
  if (modePlacement === 'hash' && cleanModeValue) {
    url.searchParams.delete('mode');
    url.hash = new URLSearchParams({ mode: cleanModeValue }).toString();
  }
  if (includeProvider) {
    url.searchParams.set('gazeProvider', 'seeso');
  } else {
    url.searchParams.delete('gazeProvider');
  }
  return url;
}

export function buildSeeSoCalibrationPageUrl({
  licenseKey,
  userId = DEFAULT_SEESO_USER_ID,
  redirectUrl,
  calibrationPointCount = 5,
  monitorSizeInch = null,
  faceDistanceCm = null,
} = {}) {
  const params = [
    ['licenseKey', licenseKey],
    ['userId', userId || DEFAULT_SEESO_USER_ID],
    ['redirectUrl', redirectUrl],
    ['selectCalibrationPoint', String(calibrationPointCount)],
  ];
  const monitorInch = positiveNumber(monitorSizeInch);
  const faceDistance = positiveNumber(faceDistanceCm);
  if (monitorInch !== null) {
    params.push(['monitorInch', String(monitorInch)]);
  }
  if (faceDistance !== null) {
    params.push(['faceDistance', String(faceDistance)]);
  }
  const query = params
    .map(([key, value]) => (
      key === 'redirectUrl'
        ? `${key}=${value}`
        : `${key}=${encodeURIComponent(value ?? '')}`
    ))
    .join('&');

  return `${SEESO_CALIBRATION_SERVICE_URL}?${query}`;
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

function getWindowScreenLeft(windowRef) {
  return finiteNumber(windowRef?.screenX) ?? finiteNumber(windowRef?.screenLeft);
}

function getWindowScreenTop(windowRef) {
  return finiteNumber(windowRef?.screenY) ?? finiteNumber(windowRef?.screenTop);
}

function convertMonitorGazeToViewport(gazeInfo, windowRef) {
  return {
    x: gazeInfo.x - (getWindowScreenLeft(windowRef) ?? 0),
    y: gazeInfo.y - (getWindowScreenTop(windowRef) ?? 0),
  };
}

function getAbsoluteWindowCenterX(windowRef) {
  const screenLeft = getWindowScreenLeft(windowRef);
  const viewportWidth = positiveNumber(windowRef?.innerWidth) ?? positiveNumber(windowRef?.outerWidth);

  if (screenLeft === null || viewportWidth === null) {
    return null;
  }

  return screenLeft + viewportWidth / 2;
}

function getDefaultCameraXForWindow(windowRef) {
  const absoluteWindowCenterX = getAbsoluteWindowCenterX(windowRef);
  if (absoluteWindowCenterX !== null) {
    return absoluteWindowCenterX;
  }

  return (
    positiveNumber(windowRef?.outerWidth) ||
    positiveNumber(windowRef?.innerWidth) ||
    positiveNumber(windowRef?.screen?.width) ||
    0
  ) / 2;
}

function shouldNormalizeHostedDefaultCameraX(cameraX, windowRef) {
  const screenLeft = getWindowScreenLeft(windowRef);
  const innerWidth = positiveNumber(windowRef?.innerWidth);

  if (screenLeft === null || Math.abs(screenLeft) < 1 || innerWidth === null) {
    return false;
  }

  const hostedDefaultCameraX = innerWidth / 2;
  const tolerancePx = Math.max(2, innerWidth * 0.01);
  return Math.abs(cameraX - hostedDefaultCameraX) <= tolerancePx;
}

function normalizeSeeSoCalibrationDataForWindow(calibrationData, windowRef) {
  if (!calibrationData) {
    return calibrationData;
  }

  try {
    const isStringPayload = typeof calibrationData === 'string';
    const data = isStringPayload ? JSON.parse(calibrationData) : calibrationData;
    if (!data || typeof data !== 'object') {
      return calibrationData;
    }

    const cameraX = finiteNumber(data.cameraX);
    if (cameraX === null || !shouldNormalizeHostedDefaultCameraX(cameraX, windowRef)) {
      return calibrationData;
    }

    const normalizedData = {
      ...data,
      cameraX: getDefaultCameraXForWindow(windowRef),
    };

    return isStringPayload ? JSON.stringify(normalizedData) : normalizedData;
  } catch {
    return calibrationData;
  }
}

export function createSeeSoProvider({
  sdk = null,
  moduleLoader,
  modulePath = DEFAULT_SEESO_MODULE_PATH,
  licenseKey,
  calibrationData = null,
  userId = DEFAULT_SEESO_USER_ID,
  monitorSizeInch = null,
  faceDistanceCm = null,
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
    return getDefaultCameraXForWindow(windowRef);
  }

  function configureTrackerGeometry(nextTracker, calibrationSettings = null) {
    const monitorInch = positiveNumber(calibrationSettings?.monitorInch) ?? monitorSizeInch;
    const faceDistance = positiveNumber(calibrationSettings?.faceDistance) ?? faceDistanceCm;
    const cameraX = finiteNumber(calibrationSettings?.cameraX) ?? getDefaultCameraX();
    const isCameraOnTop = typeof calibrationSettings?.isCameraOnTop === 'boolean'
      ? calibrationSettings.isCameraOnTop
      : true;

    if (monitorInch !== null) {
      nextTracker.setMonitorSize?.(monitorInch);
    }
    if (faceDistance !== null) {
      nextTracker.setFaceDistance?.(faceDistance);
    }
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

      calibrationData = normalizeSeeSoCalibrationDataForWindow(calibrationData, windowRef);
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

        const viewportGaze = convertMonitorGazeToViewport(gazeInfo, windowRef);
        onGaze?.({
          x: viewportGaze.x,
          y: viewportGaze.y,
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
      monitorSizeInch: nextMonitorSizeInch = monitorSizeInch,
      faceDistanceCm: nextFaceDistanceCm = faceDistanceCm,
    } = {}) {
      await assertLicenseKey();
      windowRef.location?.replace?.(buildSeeSoCalibrationPageUrl({
        licenseKey,
        userId: calibrationUserId,
        redirectUrl,
        calibrationPointCount,
        monitorSizeInch: nextMonitorSizeInch,
        faceDistanceCm: nextFaceDistanceCm,
      }));
    },
    async setCalibrationData(nextCalibrationData) {
      calibrationData = normalizeSeeSoCalibrationDataForWindow(nextCalibrationData, windowRef);
      await tracker?.setCalibrationData?.(calibrationData);
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
