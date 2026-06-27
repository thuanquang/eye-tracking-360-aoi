import {
  classifyAoisWithUncertainty,
  hitTestAois,
  normalizeYaw,
  panoramaPointToScreen,
  resolveAoisAtTime,
  screenPointToVideoPoint,
  screenPointToYawPitch,
  screenUncertaintyToYawPitch,
} from '../aois/aoiMath.js?v=aoi-active-window-1';
import {
  createAoiStabilityState,
  updateAoiStability,
} from '../aois/aoiStability.js';
import { buildNamedAoiMetrics } from '../recording/analysisMetrics.js?v=ui-modes-1';
import { buildAoiStatsViewModel } from '../recording/aoiStatsViewModel.js';
import { buildAoiStatsCsv } from '../recording/csvExport.js?v=aoi-stats-csv-1';
import { buildRecordingSample } from '../recording/sampleBuilder.js?v=recording-export-1';
import {
  createSampleScheduler,
  shouldRecordSample,
} from '../recording/sampleScheduler.js?v=sample-scheduler-1';
import {
  buildExportPayload,
  buildExportSummary as createExportSummary,
  buildProjectPackage as createProjectPackage,
  buildVideoPackageMetadata as createVideoPackageMetadata,
} from '../recording/recordingExport.js?v=recording-export-2';
import {
  buildMergedHeatmapExport,
  readHeatmapExportFiles,
  readMergedHeatmapPackageFile,
} from '../recording/heatmapMerge.js';
import { buildMergedHeatmapOverlayPoints } from '../recording/heatmapOverlay.js';
import {
  getHeatmapRenderDimensions,
  normalizeHeatmapBins,
} from '../recording/heatmapRender.js';
import {
  findReviewSampleIndex,
  getReviewTimeWindow,
  prepareReviewSamples,
} from '../recording/replay.js?v=recording-replay-1';
import { normalizeAoiId } from '../aois/aoiGeneration.js?v=viewer-yaw-1';
import {
  extractAoisFromJson,
  extractProjectMetadataFromJson,
  isValidAoi,
  isValidPolygonPoints,
} from '../aois/aoiImport.js?v=aoi-schema-1';
import { filterGeneratedSceneBackgroundAois } from '../aois/generatedAoiFilter.js?v=generated-filter-1';
import {
  buildAoiOverlayModels,
  createAoiOverlayRedrawGate,
  resolveOverlayAoisAtTime,
} from '../aois/aoiOverlay.js?v=aoi-overlay-1';
import { getEffectiveAnalysisPadding } from '../aoiShapes.js?v=polygon-padding-2';
import {
  getNextCameraFromDrag,
  shouldAllowCameraDrag,
} from '../viewer/cameraControls.js';
import {
  getContainedMediaRect,
  getCurrentProjection as resolveCurrentProjection,
  getCurrentStereoLayout as resolveCurrentStereoLayout,
  getProjectionTextureTransform,
  normalizeStereoLayout,
  normalizeVideoProjection,
} from '../viewer/projection.js?v=nguyen-hue-360-1';
import {
  applyViewportCalibration,
  distanceBetweenPoints,
  estimateLocalAccuracyErrorPx,
  isGazeInsideViewport,
  isValidationFresh,
  resolveGazeUpdate,
  shouldCaptureFreshGazeSample,
  shouldContinueTargetSampleCapture,
  summarizeTargetSamples,
  updateLiveGazeQuality,
} from '../gaze/gazeQuality.js';
import {
  shouldRecordGazeStreamDrop,
  summarizeGazeStreamQuality,
  updateGazeStreamStats,
} from '../gaze/qualityMonitor.js';
import {
  compareFacePoseToBaseline,
  normalizeFaceQualitySummary,
} from '../gaze/faceQuality.js?v=face-quality-2';
import { getValidationPolicy } from '../gaze/validationPolicy.js';
import { recordTargetCaptureRejection } from '../gaze/validationRetryPolicy.js';
import {
  ACCURACY_REFINEMENT_POINTS,
  VALIDATION_POINTS,
  getCalibrationProfile,
  getCalibrationProfileMetadata,
  getCalibrationSamplesPerPoint,
} from '../gaze/calibrationTargets.js';
import { evaluateAccuracyCheck } from '../gaze/accuracyValidation.js';
import {
  summarizeDiagnosticTarget,
  summarizeRawGazeDiagnostic,
} from '../gaze/rawGazeDiagnostics.js';
import {
  DEFAULT_VALIDATION_MAX_AGE_MS,
  GAZE_SMOOTHING,
  GAZE_TIMING,
  LIVE_QUALITY,
  POLYGON_KEYFRAME_EDIT_EPSILON_SEC,
  RAW_GAZE_DIAGNOSTIC,
  RECORDING_SAMPLE_INTERVAL_MS,
  REVIEW_GAZE_EDGE_PADDING_PX,
  REVIEW_LOOP_GRACE_SEC,
  SVG_NS,
  TARGET_CAPTURE,
} from './constants.js';
import {
  buildStudyAssetFetchPath,
  getDeploymentConfig,
  getDeploymentSeeSoLicenseKey,
  submitValidationResult,
} from './deploymentConfig.js';
import {
  createDefaultAois,
  createDefaultGaze,
  createInitialAppState,
  createInitialVideoInfo,
} from './state.js';
import {
  STUDY_VIDEOS,
  findStudyVideoById,
  getGeneratedAoiPathForStudyVideo,
  getDefaultStudyVideo,
  validateAoiVideoCompatibility,
  videoInfoFromStudyVideo,
} from './studyVideos.js?v=nguyen-hue-updated-angle-1';
import { queryAppDom } from './dom.js';
import { createMouseProvider } from '../gaze/providers/mouseProvider.js?v=gaze-providers-1';
import {
  buildSeeSoRedirectUrl,
  createSeeSoProvider,
  parseSeeSoCalibrationDataFromUrl,
} from '../gaze/providers/seesoProvider.js?v=gaze-providers-1';
import { createWebGazerProvider } from '../gaze/providers/webgazerProvider.js?v=gaze-providers-1';

export function createAppController({
  document,
  window,
  THREE,
}) {
  let activeAois = createDefaultAois();
  let aoiSource = 'default';
  let generatedAoiLoadId = 0;
  let registeredProjectMetadata = {};
  let sourceVideoInfo = createInitialVideoInfo();
  let selectedStudyVideo = getDefaultStudyVideo();
  let activeStatsSampleSource = 'live';
  let analyticsMode = null;
  let heatmapOverlaySignature = '';
  let webcamProvider = null;
  let activeGazeProviderId = null;
  let webcamStartPromise = null;
  let webcamStartProviderId = null;
  let selectedGazeProviderId = 'webgazer';
  let seeSoLicenseKeyValue = '';
  let shouldAutoStartSeeSoGazeAfterCalibrationReturn = false;
  let aoiOverlayVersion = 0;
  let participantRecordingStartedAtSec = null;
  let mergedHeatmapExport = null;
  let activeMergedHeatmapView = null;
  let heatmapMergeLoadId = 0;
  let mergedHeatmapPackageLoadId = 0;
  let mergedHeatmapImportToken = 0;

  let recordingSampleScheduler = createSampleScheduler({ intervalMs: RECORDING_SAMPLE_INTERVAL_MS });
  const GAZE_SMOOTHING_ALPHA = GAZE_SMOOTHING.alpha;
  const GAZE_FAST_SMOOTHING_ALPHA = GAZE_SMOOTHING.fastAlpha;
  const GAZE_FAST_SMOOTHING_DISTANCE_PX = GAZE_SMOOTHING.fastDistancePx;
  const MAX_GAZE_JUMP_PX = GAZE_SMOOTHING.maxJumpPx;
  const GAZE_BOUNDS_MARGIN_PX = GAZE_SMOOTHING.boundsMarginPx;
  const RAW_GAZE_BOUNDS_MARGIN_RATIO = GAZE_SMOOTHING.rawBoundsMarginRatio;
  const FRESH_GAZE_MAX_AGE_MS = GAZE_TIMING.freshGazeMaxAgeMs;
  const LIVE_GAZE_STALE_MS = GAZE_TIMING.liveGazeStaleMs;
  const LIVE_GAZE_HOLD_MS = GAZE_TIMING.liveGazeHoldMs;
  const TARGET_MAX_DISPERSION_PX = TARGET_CAPTURE.maxDispersionPx;
  const CALIBRATION_SAMPLES_PER_POINT = TARGET_CAPTURE.calibrationSamplesPerPoint;
  const VALIDATION_SAMPLES_PER_POINT = TARGET_CAPTURE.validationSamplesPerPoint;
  const TARGET_SETTLE_DELAY_MS = GAZE_TIMING.targetSettleDelayMs;
  const TARGET_SAMPLE_DELAY_MS = GAZE_TIMING.targetSampleDelayMs;
  const MIN_VALIDATION_SAMPLES_PER_TARGET = Math.max(4, Math.floor(VALIDATION_SAMPLES_PER_POINT * 0.6));
  const VALIDATION_CAPTURE_MAX_DURATION_MS = TARGET_SAMPLE_DELAY_MS * VALIDATION_SAMPLES_PER_POINT * 2;
  const MIN_ACCEPTED_REFINEMENT_TARGETS = TARGET_CAPTURE.minAcceptedRefinementTargets;
  const MIN_ACCEPTED_VALIDATION_TARGETS = TARGET_CAPTURE.minAcceptedValidationTargets;
  const VALIDATION_MAX_ATTEMPTS_PER_TARGET = TARGET_CAPTURE.validationMaxAttemptsPerTarget;
  const LIVE_QUALITY_MAX_EVENTS = LIVE_QUALITY.maxEvents;
  const LIVE_QUALITY_MIN_EVENTS = LIVE_QUALITY.minEvents;
  const LIVE_QUALITY_MAX_BAD_RATE = LIVE_QUALITY.maxBadRate;
  const LIVE_QUALITY_MAX_CONSECUTIVE_BAD = LIVE_QUALITY.maxConsecutiveBad;
  const FACE_QUALITY_MAX_CONSECUTIVE_FAILURES = 3;
  const GAZE_PROVIDER_STORAGE_KEY = 'aoi.gazeProvider';
  const SEESO_LICENSE_KEY_STORAGE_KEY = 'aoi.seesoLicenseKey';
  const SEESO_EMBEDDED_LICENSE_KEY = '';
  const SEESO_CALIBRATION_DATA_STORAGE_KEY = 'aoi.seesoCalibrationData';
  const SEESO_CALIBRATION_USER_ID_STORAGE_KEY = 'aoi.seesoCalibrationUserId';
  const SEESO_CALIBRATION_RETURN_MODE_STORAGE_KEY = 'aoi.seesoCalibrationReturnMode';
  const SEESO_MONITOR_SIZE_STORAGE_KEY = 'aoi.seesoMonitorSizeInch';
  const SEESO_FACE_DISTANCE_STORAGE_KEY = 'aoi.seesoFaceDistanceCm';
  const PARTICIPANT_RECORDING_LIMIT_SEC = 30;
  const PARTICIPANT_EXPORT_SUCCESS_MESSAGE = 'K\u1ebft qu\u1ea3 \u0111\u00e3 \u0111\u01b0\u1ee3c g\u1eedi l\u00ean th\u00e0nh c\u00f4ng';
  const DEFAULT_VALIDATION_MONITOR_SIZE_INCH = 15.6;
  const DEFAULT_VALIDATION_FACE_DISTANCE_CM = 60;
  const PARTICIPANT_DRAFT_STORAGE_KEY = 'aoi.participantDraft';
  const PARTICIPANT_SESSION_STORAGE_KEY = 'aoi.participantSession';
  const SEESO_CALIBRATION_POINT_COUNT = 5;

  const dom = queryAppDom(document);
  const {
    appShell,
    viewer,
    viewerSection,
    viewerNotice,
    participantRecordingCountdown,
    aoiOverlay,
    gazeDot,
    sourceVideo,
    miniMap,
    playVideoButton,
    resetViewButton,
    mouseModeButton,
    webcamModeButton,
    gazeProviderSelect,
    gazeEngineStatus,
    adminSeeSoMonitorSizeInput,
    adminSeeSoFaceDistanceInput,
    calibrateButton,
    accuracyButton,
    rawGazeDiagnosticButton,
    rawGazeDiagnosticStatus,
    calibrationProfileSelect,
    validationPolicySelect,
    studyVideoSelect,
    aoiFileInput,
    projectionSelect,
    stereoLayoutSelect,
    manualAoiLabelInput,
    manualAoiSizeInput,
    manualAoiColorInput,
    addManualAoiButton,
    drawPolygonAoiButton,
    finishPolygonAoiButton,
    cancelPolygonAoiButton,
    manualAoiStatus,
    selectedAoiPanel,
    selectedAoiLabelInput,
    selectedAoiPaddingInput,
    selectedAoiColorInput,
    saveSelectedAoiButton,
    deleteSelectedAoiButton,
    recordingFileInput,
    heatmapMergeFileInput,
    mergedHeatmapPackageFileInput,
    heatmapMergeStatus,
    mergedHeatmapGroupSelect,
    mergedHeatmapVariantSelect,
    mergedHeatmapTypeSelect,
    viewMergedHeatmapButton,
    clearMergedHeatmapViewButton,
    exportMergedHeatmapJsonButton,
    exportMergedHeatmapImageButton,
    recordButton,
    reviewButton,
    clearButton,
    exportButton,
    exportStatsCsvButton,
    exitAnalyticsButton,
    refreshStatsButton,
    analyticsClearButton,
    analyticsExportButton,
    analyticsExportStatsCsvButton,
    aoiStatsSummary,
    aoiStatsCards,
    aoiStatsDetails,
    aoiStatsTable,
    gazeHeatmapOverlay,
    heatmapRuler,
    heatmapRulerMin,
    heatmapRulerMax,
    sampleCount,
    modeLabel,
    webcamStatusLabel,
    accuracyStatusLabel,
    aoiSourceLabel,
    screenReadout,
    cameraReadout,
    panoramaReadout,
    hitReadout,
    gazeQualityReadout,
    aoiList,
    controlPanel,
    participantPanel,
    adminModeLink,
    participantStudyVideoSelect,
    participantIdInput,
    participantNameInput,
    participantAgeInput,
    participantConsentInput,
    seeSoMonitorSizeInput,
    seeSoFaceDistanceInput,
    participantStartButton,
    participantSessionPanel,
    participantCalibrateButton,
    participantAccuracyButton,
    participantRecordButton,
    participantResultPanel,
    participantResultSummary,
    participantExportCsvButton,
    participantExportJsonButton,
    participantExportHeatmapButton,
    participantUploadStatus,
    participantFlowSteps,
    adminFlowSteps,
    validationTestPanel,
    validationTestStatus,
    validationSeeSoMonitorSizeInput,
    validationSeeSoFaceDistanceInput,
    validationTestCalibrateButton,
    validationTestAccuracyButton,
    validationStatsPopup,
    validationStatsSummary,
    validationStatsMean,
    validationStatsMedian,
    validationStatsP90,
    validationStatsMax,
    validationStatsStability,
    validationStatsTargetCount,
    validationStatsCloseButton,
    calibrationOverlay,
    calibrationTarget,
    calibrationProgress,
    calibrationDescription,
    cancelCalibrationButton,
  } = dom;

  const initialViewerNoticeText = viewerNotice.textContent;
  const state = createInitialAppState();
  let activeCalibrationProfile = null;

  function resetAoiStability() {
    state.aoiStability = createAoiStabilityState();
    state.lastAoiStabilityAt = 0;
  }

  const aoiOverlayRedrawGate = createAoiOverlayRedrawGate({ minIntervalMs: 50 });
  const miniMapRedrawGate = createAoiOverlayRedrawGate({ minIntervalMs: 50 });
  let textureTransformSignature = '';
  const mouseProvider = createMouseProvider({
    viewer,
    onGaze: (gaze) => {
      if (state.mode !== 'mouse') {
        return;
      }

      state.gaze = gaze;
      registerGazeStreamEvent({
        atMs: performance.now(),
        accepted: true,
        onScreen: true,
      });
    },
  });

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1100);
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  viewer.appendChild(renderer.domElement);

  const geometry = new THREE.SphereGeometry(500, 64, 40);
  geometry.scale(-1, 1, 1);
  const videoTexture = new THREE.VideoTexture(sourceVideo);
  videoTexture.colorSpace = THREE.SRGBColorSpace;
  videoTexture.needsUpdate = true;
  const material = new THREE.MeshBasicMaterial({ map: videoTexture });
  const sphere = new THREE.Mesh(geometry, material);
  scene.add(sphere);
  const flatVideoPlane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
  flatVideoPlane.position.z = -500;
  flatVideoPlane.visible = false;
  scene.add(flatVideoPlane);

  function formatDegrees(value) {
    return `${value.toFixed(1)} deg`;
  }

  function delay(ms) {
    return new Promise((resolve) => {
      window.setTimeout(resolve, ms);
    });
  }

  function setNotice(message, visible = true) {
    viewerNotice.textContent = message;
    viewerNotice.classList.toggle('is-hidden', !visible);
  }

  function isViewerNoticeShowingWorkflowMessage() {
    return (
      !viewerNotice.classList.contains('is-hidden') &&
      viewerNotice.textContent !== initialViewerNoticeText
    );
  }

  function getCurrentProjection() {
    return resolveCurrentProjection({
      controlValue: projectionSelect?.value,
      metadataProjection: sourceVideoInfo.projection,
    });
  }

  function getCurrentStereoLayout() {
    return resolveCurrentStereoLayout({
      controlValue: stereoLayoutSelect?.value,
      metadataStereoLayout: sourceVideoInfo.stereoLayout,
    });
  }

  function syncSourceVideoMetadataFromControls() {
    sourceVideoInfo = {
      ...sourceVideoInfo,
      projection: getCurrentProjection(),
      stereoLayout: getCurrentStereoLayout(),
    };
  }

  function syncSelectedCalibrationProfileState() {
    state.selectedCalibrationProfile = getCalibrationProfileMetadata(calibrationProfileSelect.value);
    return state.selectedCalibrationProfile;
  }

  function syncSelectedValidationPolicyState() {
    const policy = getValidationPolicy(validationPolicySelect.value);

    state.selectedValidationPolicyId = policy.id;
    setSelectValueIfOptionExists(validationPolicySelect, policy.id);
    return policy;
  }

  function freezeSelectedCalibrationProfileForCalibration() {
    const selectedProfile = syncSelectedCalibrationProfileState();
    activeCalibrationProfile = getCalibrationProfile(selectedProfile.id);
    state.calibrationProfile = getCalibrationProfileMetadata(activeCalibrationProfile.id);
    return activeCalibrationProfile;
  }

  function freezeSelectedValidationPolicyForAccuracy() {
    const policy = syncSelectedValidationPolicyState();
    state.activeValidationPolicyId = policy.id;
    return policy;
  }

  function getActiveCalibrationProfile() {
    return activeCalibrationProfile
      ?? getCalibrationProfile(state.selectedCalibrationProfile?.id ?? calibrationProfileSelect.value);
  }

  function getActiveCalibrationSamplesPerPoint() {
    return getCalibrationSamplesPerPoint(
      getActiveCalibrationProfile().id,
      CALIBRATION_SAMPLES_PER_POINT,
    );
  }

  function setCalibrationProfileSelectLocked(isLocked) {
    calibrationProfileSelect.disabled = isLocked;
  }

  function setValidationPolicySelectLocked(isLocked) {
    validationPolicySelect.disabled = isLocked;
  }

  function hasSelectOption(select, value) {
    if (!select) {
      return false;
    }

    return Array.from(select.options).some((option) => option.value === value);
  }

  function setSelectValueIfOptionExists(select, value) {
    if (hasSelectOption(select, value)) {
      select.value = value;
    }
  }

  function getLocalStorageValue(key) {
    try {
      return window.localStorage?.getItem(key) ?? '';
    } catch {
      return '';
    }
  }

  function setLocalStorageValue(key, value) {
    try {
      if (value === null || value === undefined || value === '') {
        window.localStorage?.removeItem(key);
        return;
      }

      window.localStorage?.setItem(key, String(value));
    } catch {
      // Local storage is optional; private browsing and locked-down embeds can block it.
    }
  }

  function getSessionStorageValue(key) {
    try {
      return window.sessionStorage?.getItem(key) ?? '';
    } catch {
      return '';
    }
  }

  function setSessionStorageValue(key, value) {
    try {
      if (value === null || value === undefined || value === '') {
        window.sessionStorage?.removeItem(key);
        return;
      }

      window.sessionStorage?.setItem(key, String(value));
    } catch {
      // Participant flow still works without session storage; the user will re-enter details.
    }
  }

  function parseStoredJson(value) {
    if (!value) {
      return null;
    }

    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      return null;
    }
  }

  function getSelectedGazeProviderId() {
    return selectedGazeProviderId;
  }

  function isSeeSoProviderSelected() {
    return getSelectedGazeProviderId() === 'seeso';
  }

  function normalizeGazeProviderId(providerId) {
    return providerId === 'seeso' ? 'seeso' : 'webgazer';
  }

  function setGazeProviderControlValue(providerId) {
    selectedGazeProviderId = normalizeGazeProviderId(providerId);
    setSelectValueIfOptionExists(gazeProviderSelect, selectedGazeProviderId);
    syncAdminGazeSetupControls();
    syncParticipantGazeSetupControls();
  }

  function persistSelectedGazeProvider(providerId = getSelectedGazeProviderId()) {
    setGazeProviderControlValue(providerId);
    setLocalStorageValue(GAZE_PROVIDER_STORAGE_KEY, getSelectedGazeProviderId());
  }

  function getSeeSoLicenseKey() {
    return (SEESO_EMBEDDED_LICENSE_KEY || getDeploymentSeeSoLicenseKey() || seeSoLicenseKeyValue).trim();
  }

  function setSeeSoLicenseKeyControlValue(value) {
    seeSoLicenseKeyValue = String(value ?? '');
    syncAdminGazeSetupControls();
    syncParticipantGazeSetupControls();
    syncValidationTestControls();
  }

  function persistSeeSoLicenseKey(event = null) {
    setSeeSoLicenseKeyControlValue(event?.target?.value ?? seeSoLicenseKeyValue);
    setLocalStorageValue(SEESO_LICENSE_KEY_STORAGE_KEY, getSeeSoLicenseKey());
    syncParticipantSessionControls();
    syncValidationTestControls();
  }

  function parsePositiveInputValue(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
  }

  function getSeeSoGeometryInputs() {
    return [
      [adminSeeSoMonitorSizeInput, adminSeeSoFaceDistanceInput],
      [seeSoMonitorSizeInput, seeSoFaceDistanceInput],
      [validationSeeSoMonitorSizeInput, validationSeeSoFaceDistanceInput],
    ];
  }

  function setSeeSoGeometryControlValues({ monitorSizeInch = '', faceDistanceCm = '' } = {}) {
    getSeeSoGeometryInputs().forEach(([monitorInput, distanceInput]) => {
      monitorInput.value = monitorSizeInch;
      distanceInput.value = faceDistanceCm;
    });
  }

  function getSeeSoGeometrySettings() {
    const monitorSizeInch = parsePositiveInputValue(seeSoMonitorSizeInput.value)
      ?? parsePositiveInputValue(adminSeeSoMonitorSizeInput.value)
      ?? parsePositiveInputValue(validationSeeSoMonitorSizeInput.value);
    const faceDistanceCm = parsePositiveInputValue(seeSoFaceDistanceInput.value)
      ?? parsePositiveInputValue(adminSeeSoFaceDistanceInput.value)
      ?? parsePositiveInputValue(validationSeeSoFaceDistanceInput.value);

    if (state.appMode === 'validation') {
      return {
        monitorSizeInch: monitorSizeInch ?? DEFAULT_VALIDATION_MONITOR_SIZE_INCH,
        faceDistanceCm: faceDistanceCm ?? DEFAULT_VALIDATION_FACE_DISTANCE_CM,
        complete: true,
      };
    }

    return {
      monitorSizeInch,
      faceDistanceCm,
      complete: monitorSizeInch !== null && faceDistanceCm !== null,
    };
  }

  function persistSeeSoGeometrySettings(event = null) {
    const input = event?.target;
    const current = getSeeSoGeometrySettings();
    const monitorSizeInch = input && /MonitorSize/.test(input.id)
      ? parsePositiveInputValue(input.value)
      : current.monitorSizeInch;
    const faceDistanceCm = input && /FaceDistance/.test(input.id)
      ? parsePositiveInputValue(input.value)
      : current.faceDistanceCm;

    if (monitorSizeInch !== null) {
      setLocalStorageValue(SEESO_MONITOR_SIZE_STORAGE_KEY, String(monitorSizeInch));
    }
    if (faceDistanceCm !== null) {
      setLocalStorageValue(SEESO_FACE_DISTANCE_STORAGE_KEY, String(faceDistanceCm));
    }

    setSeeSoGeometryControlValues({
      monitorSizeInch: monitorSizeInch ?? '',
      faceDistanceCm: faceDistanceCm ?? '',
    });
    syncAdminGazeSetupControls();
    updateParticipantStartState();
    syncParticipantSessionControls();
    syncValidationTestControls();
  }

  function requireSeeSoGeometrySettings() {
    const settings = getSeeSoGeometrySettings();
    if (settings.complete) {
      return settings;
    }

    setNotice('Nhập kích thước màn hình và khoảng cách mặt trước khi hiệu chỉnh camera.', true);
    syncAdminGazeSetupControls();
    syncParticipantSessionControls();
    syncValidationTestControls();
    return null;
  }

  function getSeeSoCalibrationDataFromUrl() {
    return parseSeeSoCalibrationDataFromUrl(window.location.href);
  }

  function persistSeeSoCalibrationDataFromUrl() {
    const calibrationData = getSeeSoCalibrationDataFromUrl();
    if (!calibrationData) {
      return null;
    }

    setLocalStorageValue(SEESO_CALIBRATION_DATA_STORAGE_KEY, calibrationData);

    try {
      const cleanedUrl = buildSeeSoRedirectUrl(window.location.href);
      const calibrationReturnMode = getSessionStorageValue(SEESO_CALIBRATION_RETURN_MODE_STORAGE_KEY);
      if (!cleanedUrl.searchParams.has('mode') && ['admin', 'participant', 'validation'].includes(calibrationReturnMode)) {
        cleanedUrl.searchParams.set('mode', calibrationReturnMode);
      }
      window.history?.replaceState?.(null, '', cleanedUrl.toString());
    } catch {
      // A clean address bar is nice-to-have; the stored calibration is the important part.
    }

    return calibrationData;
  }

  function getSeeSoCalibrationData() {
    return getSeeSoCalibrationDataFromUrl()
      ?? getLocalStorageValue(SEESO_CALIBRATION_DATA_STORAGE_KEY)
      ?? '';
  }

  function getHostedCalibrationReturnNotice(mode = state.appMode || getRequestedAppMode()) {
    if (mode === 'validation') {
      return 'Dữ liệu hiệu chỉnh camera đã trả về. Đang bắt đầu ánh nhìn cho kiểm tra độ chính xác.';
    }

    if (mode === 'participant') {
      return 'Dữ liệu hiệu chỉnh camera đã trả về. Đang bắt đầu ánh nhìn cho phiên người tham gia.';
    }

    return 'Dữ liệu hiệu chỉnh camera đã trả về. Đang bắt đầu ánh nhìn.';
  }

  function clearStoredSeeSoCalibrationData() {
    setLocalStorageValue(SEESO_CALIBRATION_DATA_STORAGE_KEY, '');
    syncParticipantGazeSetupControls();
  }

  function createSeeSoCalibrationUserId() {
    const nextUserId = `aoi-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setLocalStorageValue(SEESO_CALIBRATION_USER_ID_STORAGE_KEY, nextUserId);
    return nextUserId;
  }

  function getSeeSoCalibrationUserId() {
    return getLocalStorageValue(SEESO_CALIBRATION_USER_ID_STORAGE_KEY)
      || createSeeSoCalibrationUserId();
  }

  function initializeGazeProviderControls() {
    setSeeSoLicenseKeyControlValue(getLocalStorageValue(SEESO_LICENSE_KEY_STORAGE_KEY));
    setSeeSoGeometryControlValues({
      monitorSizeInch: getLocalStorageValue(SEESO_MONITOR_SIZE_STORAGE_KEY),
      faceDistanceCm: getLocalStorageValue(SEESO_FACE_DISTANCE_STORAGE_KEY),
    });

    const params = new URLSearchParams(window.location.search);
    const requestedProvider = params.get('gazeProvider') === 'seeso'
      ? 'seeso'
      : getLocalStorageValue(GAZE_PROVIDER_STORAGE_KEY);
    setGazeProviderControlValue(requestedProvider);

    const returnedCalibrationData = persistSeeSoCalibrationDataFromUrl();
    if (returnedCalibrationData && isSeeSoProviderSelected()) {
      shouldAutoStartSeeSoGazeAfterCalibrationReturn = true;
      state.webcamCalibrationTrained = true;
      setAccuracySummary(null);
      setWebcamStatus('calibrated');
      setNotice(getHostedCalibrationReturnNotice(), false);
    }
  }

  function stopWebcamProviderForSwitch() {
    webcamStartPromise = null;
    webcamStartProviderId = null;
    webcamProvider?.stop?.();
    webcamProvider = null;
    activeGazeProviderId = null;
    state.webcamStarted = false;
    state.webcamCalibrationTrained = false;
    state.gaze = createDefaultGaze();
    state.rawPageGaze = null;
    state.rawViewerGaze = null;
    state.rawGazeAt = 0;
    state.rawGazeDiagnostic = {
      active: false,
      index: 0,
      targets: [],
      latestSummary: null,
    };
    state.gazeDropReason = null;
    state.droppedGazeSamples = 0;
    state.gazeStreamStats = null;
    setRawDiagnosticStatus(null);
    clearAccuracyRefinement();
    resetFaceQualityValidationState();
  }

  function handleGazeProviderChange(event = null) {
    persistSelectedGazeProvider(event?.target?.value ?? getSelectedGazeProviderId());
    stopWebcamProviderForSwitch();
    setWebcamStatus('idle');
    setNotice(`Đã chọn ${getSelectedGazeProviderId() === 'seeso' ? 'bộ theo dõi ánh nhìn lưu trữ' : 'WebGazer'}. Bắt đầu ánh nhìn webcam để ghi mẫu webcam.`, false);
    syncParticipantSessionControls();

    if (state.mode === 'webcam' && state.appMode !== 'participant') {
      void setWebcamMode();
    }
  }

  function applyVideoMetadataControls(video = {}) {
    if (video.projection) {
      setSelectValueIfOptionExists(projectionSelect, normalizeVideoProjection(video.projection));
    }

    if (video.stereoLayout) {
      const stereoLayout = hasSelectOption(stereoLayoutSelect, video.stereoLayout)
        ? video.stereoLayout
        : normalizeStereoLayout(video.stereoLayout);
      setSelectValueIfOptionExists(stereoLayoutSelect, stereoLayout);
    }

    syncSourceVideoMetadataFromControls();
  }

  function syncViewerProjectionState() {
    viewer.classList.toggle('is-flat-video', getCurrentProjection() === 'flat');
    syncProjectionMesh();
    updateCamera();
  }

  function setStudyVideo(videoId, { clearAois = true } = {}) {
    const video = findStudyVideoById(videoId) || getDefaultStudyVideo();
    selectedStudyVideo = video;
    sourceVideoInfo = videoInfoFromStudyVideo(video);
    studyVideoSelect.value = video.id;
    participantStudyVideoSelect.value = video.id;
    sourceVideo.src = sourceVideoInfo.path;
    if (Number.isFinite(sourceVideoInfo.initialTimeSec) && sourceVideoInfo.initialTimeSec > 0) {
      sourceVideo.addEventListener('loadedmetadata', () => {
        const duration = Number.isFinite(sourceVideo.duration)
          ? sourceVideo.duration
          : sourceVideoInfo.initialTimeSec;
        sourceVideo.currentTime = Math.min(sourceVideoInfo.initialTimeSec, Math.max(0, duration - 0.001));
      }, { once: true });
    }
    sourceVideo.load();
    applyVideoMetadataControls(sourceVideoInfo);
    projectionSelect.disabled = true;
    stereoLayoutSelect.disabled = true;
    syncViewerProjectionState();
    playVideoButton.textContent = 'Phát';

    if (clearAois) {
      activeAois = [];
      resetAoiStability();
      invalidateAoiOverlay();
      aoiSource = 'none';
      registeredProjectMetadata = { video: { ...sourceVideoInfo } };
      state.selectedAoiId = null;
      setManualAnnotationIdle();
      renderAoiList();
      syncParticipantSessionControls();
      loadGeneratedAoisForStudyVideo(video);
    }

    setNotice(`Đã chọn video nghiên cứu: ${video.label}`);
  }

  function handleStudyVideoChange() {
    setStudyVideo(studyVideoSelect.value);
  }

  function handleParticipantStudyVideoChange() {
    setStudyVideo(participantStudyVideoSelect.value);
    persistParticipantDraft();
    persistParticipantSessionState();
    updateParticipantStartState();
  }

  function getRequestedAppMode() {
    const params = new URLSearchParams(window.location.search);
    const hashParams = new URLSearchParams(String(window.location.hash || '').replace(/^#/, ''));
    const hashMode = String(hashParams.get('mode') || '').split('?')[0];
    if (!params.has('mode')) {
      if (hashMode === 'admin' || hashMode === 'participant' || hashMode === 'validation') {
        return hashMode;
      }

      const calibrationReturnMode = getSessionStorageValue(SEESO_CALIBRATION_RETURN_MODE_STORAGE_KEY);
      if (params.has('calibrationData') && ['admin', 'participant', 'validation'].includes(calibrationReturnMode)) {
        return calibrationReturnMode;
      }

      return 'select';
    }

    const mode = String(params.get('mode') || '').split('?')[0];
    if (mode === 'participant' || mode === 'validation') {
      return mode;
    }

    return 'admin';
  }

  function setParticipantStage() {}

  function setParticipantUploadStatus(status, fileName = '') {
    const statusText = participantUploadStatus.querySelector('[data-upload-status-text]') || participantUploadStatus;
    participantUploadStatus.classList.remove('is-uploading', 'is-uploaded', 'is-fallback', 'is-downloaded');

    if (!status) {
      participantUploadStatus.hidden = true;
      statusText.textContent = '';
      participantExportCsvButton.removeAttribute('aria-busy');
      return;
    }

    participantUploadStatus.hidden = false;
    participantUploadStatus.classList.add(`is-${status}`);
    participantExportCsvButton.setAttribute('aria-busy', status === 'uploading' ? 'true' : 'false');

    if (status === 'uploading') {
      statusText.textContent = 'Đang gửi kết quả lên R2...';
    } else if (status === 'uploaded') {
      statusText.textContent = fileName
        ? `Đã gửi lên R2: ${fileName}`
        : 'Đã gửi kết quả lên R2.';
    } else if (status === 'fallback') {
      statusText.textContent = 'Không gửi được lên R2. Đang tải JSON xuống máy này.';
    } else if (status === 'downloaded') {
      statusText.textContent = PARTICIPANT_EXPORT_SUCCESS_MESSAGE;
    }
  }

  function collectParticipantMetadata() {
    return {
      id: participantIdInput.value.trim(),
      name: participantNameInput.value.trim(),
      age: Number(participantAgeInput.value),
      consent: participantConsentInput.checked,
    };
  }

  function collectParticipantDraft() {
    return {
      ...collectParticipantMetadata(),
      studyVideoId: selectedStudyVideo.id,
    };
  }

  function applyParticipantMetadataToInputs(metadata = {}) {
    participantIdInput.value = typeof metadata.id === 'string' ? metadata.id : '';
    participantNameInput.value = typeof metadata.name === 'string' ? metadata.name : '';
    participantAgeInput.value = Number.isFinite(Number(metadata.age)) ? String(metadata.age) : '';
    participantConsentInput.checked = Boolean(metadata.consent);
  }

  function persistParticipantDraft() {
    setSessionStorageValue(PARTICIPANT_DRAFT_STORAGE_KEY, JSON.stringify(collectParticipantDraft()));
  }

  function persistParticipantSessionState() {
    if (!state.participant.startedAt) {
      setSessionStorageValue(PARTICIPANT_SESSION_STORAGE_KEY, '');
      return;
    }

    setSessionStorageValue(PARTICIPANT_SESSION_STORAGE_KEY, JSON.stringify({
      ...state.participant,
      studyVideoId: selectedStudyVideo.id,
    }));
  }

  function isParticipantMetadataValid(metadata) {
    return (
      metadata.id.length > 0 &&
      metadata.name.length > 0 &&
      Number.isFinite(metadata.age) &&
      metadata.age > 0 &&
      metadata.age < 120 &&
      metadata.consent
    );
  }

  function restoreParticipantStudyVideo(videoId) {
    if (!videoId || !findStudyVideoById(videoId)) {
      return;
    }

    setStudyVideo(videoId, { clearAois: true });
  }

  function restoreParticipantState() {
    const draft = parseStoredJson(getSessionStorageValue(PARTICIPANT_DRAFT_STORAGE_KEY));
    if (draft) {
      applyParticipantMetadataToInputs(draft);
    }

    const session = parseStoredJson(getSessionStorageValue(PARTICIPANT_SESSION_STORAGE_KEY));
    if (
      session?.startedAt &&
      isParticipantMetadataValid({
        id: String(session.id ?? ''),
        name: String(session.name ?? ''),
        age: Number(session.age),
        consent: Boolean(session.consent),
      })
    ) {
      state.participant = {
        id: String(session.id),
        name: String(session.name),
        age: Number(session.age),
        consent: Boolean(session.consent),
        startedAt: String(session.startedAt),
        studyVideoId: typeof session.studyVideoId === 'string'
          ? session.studyVideoId
          : (typeof draft?.studyVideoId === 'string' ? draft.studyVideoId : selectedStudyVideo.id),
      };
      applyParticipantMetadataToInputs(state.participant);
    }

    restoreParticipantStudyVideo(
      typeof state.participant.studyVideoId === 'string'
        ? state.participant.studyVideoId
        : draft?.studyVideoId,
    );
  }

  function updateParticipantStartState() {
    if (state.appMode !== 'participant') {
      return;
    }

    const metadata = collectParticipantMetadata();
    const requiresGeometry = getSelectedGazeProviderId() === 'seeso';
    participantStartButton.disabled = (
      !isParticipantMetadataValid(metadata) ||
      (requiresGeometry && !getSeeSoGeometrySettings().complete)
    );
  }

  function handleParticipantMetadataChange() {
    persistParticipantDraft();
    updateParticipantStartState();
  }

  function renderParticipantResultPanel() {
    const hasResults = state.appMode === 'participant' && state.samples.length > 0 && hasLoadedStudyAois();

    participantResultPanel.hidden = !hasResults;
    participantExportCsvButton.disabled = !hasResults;
    participantExportJsonButton.disabled = !hasResults;
    participantExportHeatmapButton.disabled = !hasResults;

    if (!hasResults) {
      participantResultSummary.replaceChildren();
      return;
    }

    const { namedAoiMetrics } = buildCurrentNamedAoiMetrics(state.samples);
    const viewModel = buildAoiStatsViewModel({
      namedAoiMetrics,
      sampleCount: state.samples.length,
    });
    const topAoi = viewModel.cards[0];
    const items = [
      ...viewModel.summaryItems.slice(0, 3).map((item) => (
        createStatsBlock('participant-result-metric', item.label, item.value)
      )),
    ];

    if (topAoi) {
      items.push(createStatsBlock('participant-result-metric', 'AOI top', topAoi.label));
      items.push(createStatsBlock('participant-result-metric', topAoi.primaryLabel, topAoi.primaryValue));
    }

    participantResultSummary.replaceChildren(...items);
  }

  function syncAdminGazeSetupControls() {
    const isSeeSo = isSeeSoProviderSelected();
    const hasSeeSoKey = Boolean(getSeeSoLicenseKey());
    const hasSeeSoCalibration = Boolean(getSeeSoCalibrationData());
    const hasSeeSoGeometry = getSeeSoGeometrySettings().complete;
    const hasProviderCalibration = isSeeSo
      ? hasSeeSoCalibration || state.webcamCalibrationTrained
      : state.webcamCalibrationTrained;
    const canRunAccuracy = hasProviderCalibration && (!isSeeSo || (hasSeeSoKey && hasSeeSoGeometry));
    const canOpenCalibration = !isSeeSo || (hasSeeSoKey && hasSeeSoGeometry);

    if (!isSeeSo) {
      gazeEngineStatus.textContent = state.webcamCalibrationTrained
        ? 'WebGazer đã hiệu chuẩn'
        : 'Đã chọn WebGazer';
      calibrateButton.textContent = 'Hiệu chuẩn webcam';
      accuracyButton.textContent = 'Kiểm tra độ chính xác';
    } else {
      calibrateButton.textContent = hasSeeSoCalibration
        ? 'Hiệu chỉnh lại camera'
        : 'Hiệu chỉnh camera';
      accuracyButton.textContent = 'Bắt đầu ánh nhìn + kiểm tra độ chính xác';

      if (!hasSeeSoKey) {
        gazeEngineStatus.textContent = 'Thiếu khóa bộ theo dõi trong mã';
      } else if (!hasSeeSoGeometry) {
        gazeEngineStatus.textContent = 'Nhập kích thước màn hình và khoảng cách mặt';
      } else if (hasProviderCalibration) {
        gazeEngineStatus.textContent = 'Hiệu chỉnh camera đã sẵn sàng';
      } else {
        gazeEngineStatus.textContent = 'Bộ theo dõi sẵn sàng hiệu chuẩn';
      }
    }

    calibrateButton.disabled = !canOpenCalibration;
    accuracyButton.disabled = !canRunAccuracy;
    recordButton.disabled = false;

    calibrateButton.classList.toggle('primary', !state.isRecording && canOpenCalibration && !hasProviderCalibration);
    accuracyButton.classList.toggle('primary', !state.isRecording && canRunAccuracy && !state.accuracyValidated);
    recordButton.classList.toggle('primary', !state.isRecording);
  }

  function syncParticipantGazeSetupControls() {
    const providerId = getSelectedGazeProviderId();
    const isSeeSo = providerId === 'seeso';
    const hasSeeSoCalibration = Boolean(getSeeSoCalibrationData());

    if (!isSeeSo) {
      participantCalibrateButton.textContent = 'Hiệu chuẩn webcam';
      return;
    }

    participantCalibrateButton.textContent = hasSeeSoCalibration
      ? 'Hiệu chỉnh lại camera'
      : 'Hiệu chỉnh camera';
  }

  function setParticipantFlowStep(step) {
    participantFlowSteps.forEach((element) => {
      const isActive = element.dataset.flowStep === step;
      element.classList.toggle('is-active', isActive);
      element.classList.toggle('is-complete', !isActive && (
        (step === 'calibration' && element.dataset.flowStep === 'setup') ||
        (step === 'recording' && ['setup', 'calibration'].includes(element.dataset.flowStep)) ||
        (step === 'export' && element.dataset.flowStep !== 'export')
      ));
    });
  }

  function setAdminWorkflowStep(targetId = 'adminSetupPanel') {
    adminFlowSteps.forEach((element) => {
      const isActive = element.hash === `#${targetId}`;
      element.classList.toggle('is-active', isActive);
      if (isActive) {
        element.setAttribute('aria-current', 'step');
      } else {
        element.removeAttribute('aria-current');
      }
    });
  }

  function syncAdminWorkflowStep() {
    let currentStep = null;
    adminFlowSteps.forEach((element) => {
      const section = document.querySelector(element.hash);
      if (section && section.getBoundingClientRect().top <= 72) {
        currentStep = section;
      }
    });

    setAdminWorkflowStep(currentStep?.id || 'adminSetupPanel');
  }

  function syncParticipantSessionControls() {
    const isParticipant = state.appMode === 'participant';
    const isStarted = Boolean(state.participant.startedAt);
    const providerId = getSelectedGazeProviderId();
    const isSeeSo = providerId === 'seeso';
    const hasSeeSoKey = Boolean(getSeeSoLicenseKey());
    const hasSeeSoCalibration = Boolean(getSeeSoCalibrationData());
    const hasSeeSoGeometry = getSeeSoGeometrySettings().complete;
    const hasProviderCalibration = isSeeSo
      ? hasSeeSoCalibration || state.webcamCalibrationTrained
      : state.webcamCalibrationTrained;

    appShell.classList.toggle('is-participant-started', isParticipant && isStarted);
    appShell.classList.toggle('is-participant-recording-focus', state.appMode === 'participant' && state.isRecording);
    participantSessionPanel.hidden = !isParticipant || !isStarted;
    syncParticipantGazeSetupControls();
    renderParticipantResultPanel();

    if (!isParticipant) {
      participantRecordingCountdown.hidden = true;
      return;
    }

    if (!isStarted) {
      setParticipantFlowStep('setup');
      return;
    }

    participantRecordButton.textContent = state.isRecording ? 'Dừng ghi' : 'Bắt đầu ghi';
    participantAccuracyButton.hidden = true;
    participantAccuracyButton.disabled = true;
    participantAccuracyButton.classList.remove('primary');
    participantCalibrateButton.classList.toggle(
      'primary',
      !state.isRecording && !hasProviderCalibration && (!isSeeSo || (hasSeeSoKey && hasSeeSoGeometry)),
    );
    participantRecordButton.classList.toggle('primary', !state.isRecording && canRecordCurrentMode());
    participantCalibrateButton.disabled = state.isRecording || (isSeeSo && (!hasSeeSoKey || !hasSeeSoGeometry));
    participantRecordButton.disabled = !state.isRecording && (!canRecordCurrentMode() || !hasLoadedStudyAois());

    if (state.isRecording) {
      setParticipantFlowStep('recording');
      setParticipantStage('Đang ghi mẫu');
    } else if (state.samples.length > 0) {
      setParticipantFlowStep('export');
      setParticipantStage('Bản ghi sẵn sàng xuất');
    } else if (canRecordCurrentMode() && hasLoadedStudyAois()) {
      setParticipantFlowStep('recording');
      setParticipantStage('Sẵn sàng: bắt đầu ghi');
    } else if (isSeeSo && !hasSeeSoKey) {
      setParticipantFlowStep('calibration');
      setParticipantStage('Thiếu khóa bộ theo dõi');
    } else if (isSeeSo && !hasSeeSoGeometry) {
      setParticipantFlowStep('setup');
      setParticipantStage('Nhập kích thước màn hình và khoảng cách mặt');
    } else if (isSeeSo && !hasProviderCalibration) {
      setParticipantFlowStep('calibration');
      setParticipantStage('Sẵn sàng: hiệu chỉnh camera');
    } else if (!isSeeSo && !hasProviderCalibration) {
      setParticipantFlowStep('calibration');
      setParticipantStage('Sẵn sàng: hiệu chuẩn WebGazer');
    } else if (state.webcamStatus === 'calibrated' || hasProviderCalibration) {
      setParticipantFlowStep('recording');
      setParticipantStage('Đang tải AOI trước khi ghi');
    } else {
      setParticipantFlowStep('calibration');
    }
  }

  function syncValidationTestControls() {
    const isValidationTest = state.appMode === 'validation';
    const isAccuracyTargetActive = isValidationTest && state.targetMode === 'accuracy' && !calibrationOverlay.hidden;
    const hasSeeSoKey = Boolean(getSeeSoLicenseKey());
    const hasSeeSoGeometry = getSeeSoGeometrySettings().complete;
    const hasSeeSoCalibration = Boolean(getSeeSoCalibrationData()) || state.webcamCalibrationTrained;

    appShell.classList.toggle('is-accuracy-check-active', isAccuracyTargetActive);
    appShell.classList.toggle('is-validation-recording-focus', isAccuracyTargetActive);
    validationTestPanel.hidden = !isValidationTest;
    validationTestCalibrateButton.disabled = !hasSeeSoKey || !hasSeeSoGeometry;
    validationTestAccuracyButton.disabled = (
      !hasSeeSoKey ||
      !hasSeeSoGeometry ||
      !hasSeeSoCalibration ||
      state.isRecording ||
      state.webcamStatus === 'validating'
    );
    validationTestCalibrateButton.textContent = hasSeeSoCalibration
      ? 'Hiệu chỉnh lại camera'
      : 'Hiệu chỉnh camera';
    validationTestAccuracyButton.classList.toggle(
      'primary',
      hasSeeSoKey && hasSeeSoGeometry && hasSeeSoCalibration && !state.accuracyValidated,
    );

    if (!isValidationTest) {
      return;
    }

    if (!hasSeeSoKey) {
      validationTestStatus.textContent = 'Thiếu khóa bộ theo dõi trong mã';
    } else if (!hasSeeSoGeometry) {
      validationTestStatus.textContent = 'Nhập kích thước màn hình và khoảng cách mặt';
    } else if (state.webcamStatus === 'validating') {
      validationTestStatus.textContent = 'Đang kiểm tra độ chính xác';
    } else if (state.accuracyValidated) {
      validationTestStatus.textContent = 'Kiểm tra độ chính xác hoàn tất';
    } else if (hasSeeSoCalibration) {
      validationTestStatus.textContent = 'Màn hình trống đã sẵn sàng';
    } else {
      validationTestStatus.textContent = 'Sẵn sàng hiệu chuẩn';
    }
  }

  function showValidationBlankScreen() {
    if (state.appMode !== 'validation') {
      return;
    }

    calibrationOverlay.hidden = true;
    setTargetCapturing(false);
    setNotice('', false);
    syncValidationTestControls();
  }

  function applyAppMode(mode = getRequestedAppMode()) {
    state.appMode = mode;
    const isParticipant = mode === 'participant';
    const isValidationTest = mode === 'validation';
    const isModeSelect = mode === 'select';

    appShell.classList.toggle('is-mode-select', isModeSelect);
    appShell.classList.toggle('is-participant-mode', isParticipant);
    appShell.classList.toggle('is-validation-test', isValidationTest);
    appShell.classList.toggle('is-admin-mode', mode === 'admin');
    participantPanel.hidden = !isParticipant;
    validationTestPanel.hidden = !isValidationTest;
    controlPanel.hidden = isParticipant || isValidationTest || isModeSelect;
    viewerSection.hidden = isModeSelect;
    adminModeLink.classList.toggle('is-active', mode === 'admin');

    if (isValidationTest) {
      setGazeProviderControlValue('seeso');
      selectWebcamMode();
      showValidationBlankScreen();
      syncValidationTestControls();
      return;
    }

    if (isParticipant) {
      setGazeProviderControlValue('seeso');
      updateParticipantStartState();
      if (state.participant.startedAt) {
        setNotice('Đã khôi phục phiên người tham gia. Tiếp tục hiệu chuẩn, kiểm tra độ chính xác hoặc ghi.', true);
      } else {
        setParticipantStage('Nhập thông tin');
        setNotice('Nhập thông tin người tham gia, sau đó bắt đầu phiên.', true);
      }
      syncParticipantSessionControls();
    }

    if (isModeSelect) {
      setNotice('Chọn chế độ Quản trị hoặc Người tham gia để bắt đầu.', true);
    }

    syncValidationTestControls();
  }

  async function requestParticipantFullscreen() {
    if (!document.fullscreenEnabled || document.fullscreenElement) {
      return;
    }

    try {
      await appShell.requestFullscreen();
    } catch (error) {
      setNotice('Chưa bật toàn màn hình. Tiếp tục trong cửa sổ trình duyệt hoặc dùng điều khiển toàn màn hình của trình duyệt.', true);
    }
  }

  async function startParticipantSession() {
    const metadata = collectParticipantMetadata();

    if (!isParticipantMetadataValid(metadata)) {
      updateParticipantStartState();
      return;
    }

    state.participant = {
      ...metadata,
      studyVideoId: selectedStudyVideo.id,
      startedAt: new Date().toISOString(),
    };
    persistParticipantDraft();
    persistParticipantSessionState();
    setGazeProviderControlValue('seeso');
    selectWebcamMode();
    const setupMessage = isSeeSoProviderSelected()
      ? 'Phiên người tham gia đã sẵn sàng. Hiệu chỉnh camera, rồi bắt đầu ghi khi sẵn sàng.'
      : 'Phiên người tham gia đã sẵn sàng. Hiệu chuẩn webcam, rồi bắt đầu ghi khi sẵn sàng.';
    setParticipantStage('Sẵn sàng: hiệu chỉnh camera');
    setNotice(setupMessage, true);
    syncParticipantSessionControls();
    resize();
    await requestParticipantFullscreen();
  }

  async function autoStartGazeAfterCalibrationReturn() {
    if (!shouldAutoStartSeeSoGazeAfterCalibrationReturn) {
      return;
    }

    shouldAutoStartSeeSoGazeAfterCalibrationReturn = false;

    if ((state.appMode !== 'participant' && state.appMode !== 'validation') || !isSeeSoProviderSelected()) {
      return;
    }

    if (state.appMode === 'participant' && !state.participant.startedAt) {
      return;
    }

    if (state.appMode === 'participant') {
      setParticipantStage('Starting tracker gaze');
    }

    setWebcamStatus('starting');
    setNotice(getHostedCalibrationReturnNotice(state.appMode), true);
    await setWebcamMode();
    syncParticipantSessionControls();
    syncValidationTestControls();
  }

  function getExportParticipantMetadata() {
    if (state.appMode !== 'participant' || !state.participant.startedAt) {
      return null;
    }

    return {
      ...state.participant,
      studyVideoId: selectedStudyVideo.id,
    };
  }

  function getAoiSpace(aoi) {
    return aoi?.space === 'video' ? 'video' : 'panorama';
  }

  function getAoiBoundsLabel(aoi) {
    if (aoi.shape === 'polygon') {
      const pointCount = Array.isArray(aoi.points) ? aoi.points.length : 0;
      const spaceLabel = getAoiSpace(aoi) === 'video' ? 'video' : 'panorama';
      return `${pointCount} ${spaceLabel} polygon points`;
    }

    return getAoiSpace(aoi) === 'video'
      ? `x ${aoi.xMin} to ${aoi.xMax}, y ${aoi.yMin} to ${aoi.yMax}`
      : `yaw ${aoi.yawMin} to ${aoi.yawMax}, pitch ${aoi.pitchMin} to ${aoi.pitchMax}`;
  }

  function focusAoiListButton(aoiId) {
    const button = Array.from(aoiList.querySelectorAll('.aoi-list-button'))
      .find((candidate) => candidate.dataset.aoiId === aoiId);

    button?.focus({ preventScroll: true });
  }

  function getColorInputValue(color) {
    return /^#[0-9a-f]{6}$/i.test(color || '') ? color : '#ffd166';
  }

  function normalizeAnalysisPaddingPx(value) {
    const padding = Number(value);

    return Number.isFinite(padding) ? Math.max(0, Math.round(padding)) : 0;
  }

  function positiveLayoutNumber(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
  }

  function getViewerAnalysisDimensions() {
    const rect = viewer.getBoundingClientRect();
    if (getCurrentProjection() === 'flat') {
      const videoRect = getCurrentVideoRect(rect);
      return {
        width: positiveLayoutNumber(videoRect.width) || 1,
        height: positiveLayoutNumber(videoRect.height) || 1,
      };
    }

    const width = (
      positiveLayoutNumber(rect.width) ||
      positiveLayoutNumber(viewer.clientWidth) ||
      positiveLayoutNumber(sourceVideo.videoWidth) ||
      1
    );
    const height = (
      positiveLayoutNumber(rect.height) ||
      positiveLayoutNumber(viewer.clientHeight) ||
      positiveLayoutNumber(sourceVideo.videoHeight) ||
      1
    );

    return { width, height };
  }

  function getViewerScreenDimensions() {
    const rect = viewer.getBoundingClientRect();
    return {
      width: (
        positiveLayoutNumber(rect.width) ||
        positiveLayoutNumber(viewer.clientWidth) ||
        positiveLayoutNumber(sourceVideo.videoWidth) ||
        1
      ),
      height: (
        positiveLayoutNumber(rect.height) ||
        positiveLayoutNumber(viewer.clientHeight) ||
        positiveLayoutNumber(sourceVideo.videoHeight) ||
        1
      ),
    };
  }

  function getCurrentVideoRect(rect = viewer.getBoundingClientRect()) {
    if (getCurrentProjection() !== 'flat') {
      return {
        x: 0,
        y: 0,
        width: rect.width,
        height: rect.height,
      };
    }

    return getContainedMediaRect({
      containerWidth: rect.width,
      containerHeight: rect.height,
      mediaWidth: positiveLayoutNumber(sourceVideo.videoWidth) || rect.width,
      mediaHeight: positiveLayoutNumber(sourceVideo.videoHeight) || rect.height,
    });
  }

  function screenPointToContainedVideoPoint(screenPoint, videoRect, { clampToVideo = false } = {}) {
    const localX = screenPoint.x - videoRect.x;
    const localY = screenPoint.y - videoRect.y;
    const outside = (
      localX < 0 ||
      localY < 0 ||
      localX > videoRect.width ||
      localY > videoRect.height
    );

    if (outside && !clampToVideo) {
      return null;
    }

    return screenPointToVideoPoint({
      x: clampNumber(localX, 0, videoRect.width),
      y: clampNumber(localY, 0, videoRect.height),
      width: videoRect.width,
      height: videoRect.height,
    });
  }

  function videoPointToScreenPoint(point, videoRect) {
    return {
      x: videoRect.x + point.x * videoRect.width,
      y: videoRect.y + point.y * videoRect.height,
    };
  }

  function withEffectiveAoiAnalysisPadding(
    aoi,
    dimensions = getViewerAnalysisDimensions(),
    { forceFromPx = false } = {},
  ) {
    if (!aoi || typeof aoi !== 'object') {
      return aoi;
    }

    const hasPaddingPx = Number.isFinite(Number(aoi.analysisPaddingPx));
    const hasPadding = Number.isFinite(Number(aoi.analysisPadding));

    if (!hasPaddingPx && !hasPadding) {
      return { ...aoi };
    }

    const sourceAoi = forceFromPx && hasPaddingPx
      ? { ...aoi, analysisPadding: undefined }
      : aoi;

    return {
      ...aoi,
      analysisPadding: getEffectiveAnalysisPadding(sourceAoi, dimensions),
    };
  }

  function withEffectiveAoisAnalysisPadding(
    aois,
    dimensions = getViewerAnalysisDimensions(),
    options,
  ) {
    return Array.isArray(aois)
      ? aois.map((aoi) => withEffectiveAoiAnalysisPadding(aoi, dimensions, options))
      : [];
  }

  function resolveAoisForAnalysis(aois, timeSec = 0, dimensions = getViewerAnalysisDimensions()) {
    return withEffectiveAoisAnalysisPadding(resolveAoisAtTime(aois, timeSec), dimensions);
  }

  function getActiveAoiById(aoiId) {
    return activeAois.find((aoi) => aoi.id === aoiId);
  }

  function cloneAoiPoints(points) {
    return (points || []).map((point) => ({ ...point }));
  }

  function syncSelectedAoiPanel() {
    const selectedAoi = getActiveAoiById(state.selectedAoiId);

    if (!selectedAoi) {
      selectedAoiPanel.hidden = true;
      selectedAoiLabelInput.value = '';
      selectedAoiPaddingInput.value = '0';
      selectedAoiColorInput.value = '#ffd166';
      return;
    }

    selectedAoiPanel.hidden = false;
    selectedAoiLabelInput.value = selectedAoi.label || '';
    selectedAoiPaddingInput.value = String(normalizeAnalysisPaddingPx(selectedAoi.analysisPaddingPx));
    selectedAoiColorInput.value = getColorInputValue(selectedAoi.color);
  }

  function getRenderableAois() {
    const dimensions = getViewerAnalysisDimensions();

    if (state.reviewActive && state.reviewSamples.length) {
      const sampleIndex = findReviewSampleIndex(state.reviewSamples, sourceVideo.currentTime || 0);
      const sample = state.reviewSamples[sampleIndex >= 0 ? sampleIndex : 0];

      if (Array.isArray(sample?.activeAois) && sample.activeAois.length) {
        return withEffectiveAoisAnalysisPadding(sample.activeAois, dimensions);
      }

      return resolveAoisForAnalysis(activeAois, sample?.t || 0, dimensions);
    }

    return resolveAoisForAnalysis(activeAois, sourceVideo.currentTime || 0, dimensions);
  }

  function getOverlayRenderableAois() {
    if (state.reviewActive && state.reviewSamples.length) {
      const sampleIndex = findReviewSampleIndex(state.reviewSamples, sourceVideo.currentTime || 0);
      const sample = state.reviewSamples[sampleIndex >= 0 ? sampleIndex : 0];

      if (Array.isArray(sample?.activeAois) && sample.activeAois.length) {
        return resolveOverlayAoisAtTime(sample.activeAois, sample.t || 0);
      }

      return resolveOverlayAoisAtTime(activeAois, sample?.t || 0);
    }

    return resolveOverlayAoisAtTime(activeAois, sourceVideo.currentTime || 0);
  }

  function clampNumber(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function screenToAoiSpacePoint(screenPoint, space) {
    const rect = viewer.getBoundingClientRect();
    const x = clampNumber(screenPoint.x, 0, rect.width);
    const y = clampNumber(screenPoint.y, 0, rect.height);

    if (space === 'video') {
      const point = screenPointToContainedVideoPoint(
        { x, y },
        getCurrentVideoRect(rect),
        { clampToVideo: true },
      );

      return {
        x: Number((point.x).toFixed(6)),
        y: Number((point.y).toFixed(6)),
      };
    }

    const panorama = screenPointToYawPitch({
      x,
      y,
      width: rect.width,
      height: rect.height,
      cameraYaw: state.cameraYaw,
      cameraPitch: state.cameraPitch,
      fov: camera.fov,
    });

    return {
      yaw: Number(panorama.yaw.toFixed(6)),
      pitch: Number(panorama.pitch.toFixed(6)),
    };
  }

  function screenToCurrentAoiPoint(screenPoint) {
    return screenToAoiSpacePoint(
      screenPoint,
      state.manualAnnotation.space || (getCurrentProjection() === 'flat' ? 'video' : 'panorama'),
    );
  }

  function getDraftScreenPoints(rect) {
    const points = state.manualAnnotation.points || [];

    if ((state.manualAnnotation.space || (getCurrentProjection() === 'flat' ? 'video' : 'panorama')) === 'video') {
      const videoRect = getCurrentVideoRect(rect);
      return points.map((point) => videoPointToScreenPoint(point, videoRect));
    }

    return points
      .map((point) => panoramaPointToScreen({
        yaw: point.yaw,
        pitch: point.pitch,
        width: rect.width,
        height: rect.height,
        cameraYaw: state.cameraYaw,
        cameraPitch: state.cameraPitch,
        fov: camera.fov,
      }))
      .filter((point) => point.visible);
  }

  function appendAoiOverlayPolygon(fragment, aoi, points, color) {
    if (!points || points.length < 3) {
      return;
    }

    const shape = document.createElementNS(SVG_NS, 'polygon');
    shape.setAttribute('class', 'aoi-overlay-shape');
    shape.setAttribute('points', points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' '));
    shape.setAttribute('fill', color);
    shape.setAttribute('fill-opacity', '0.16');
    shape.setAttribute('stroke', color);
    shape.dataset.aoiId = aoi.id;
    fragment.appendChild(shape);
  }

  function appendAoiVertexHandle(fragment, point, index, aoiId = '') {
    if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)) {
      return;
    }

    const handle = document.createElementNS(SVG_NS, 'circle');
    handle.setAttribute('class', 'aoi-vertex-handle');
    handle.setAttribute('cx', String(point.x));
    handle.setAttribute('cy', String(point.y));
    handle.setAttribute('r', '5');
    handle.dataset.vertexIndex = String(index);
    if (aoiId) {
      handle.dataset.aoiId = aoiId;
    }
    fragment.appendChild(handle);
  }

  function appendDraftPolygon(fragment, rect) {
    if (state.manualAnnotation.mode !== 'drawing') {
      return;
    }

    const points = getDraftScreenPoints(rect);
    appendAoiOverlayPolygon(fragment, { id: 'draft-polygon' }, points, manualAoiColorInput.value || '#ffd166');
    points.forEach((point, index) => {
      appendAoiVertexHandle(fragment, point, index);
    });
  }

  function getPolygonHandleScreenPoints(aoi, rect) {
    const points = aoi.points || [];

    if (getAoiSpace(aoi) === 'video') {
      const videoRect = getCurrentVideoRect(rect);
      return points.map((point, index) => ({
        ...videoPointToScreenPoint(point, videoRect),
        vertexIndex: index,
      }));
    }

    return points
      .map((point, index) => ({
        ...panoramaPointToScreen({
          yaw: point.yaw,
          pitch: point.pitch,
          width: rect.width,
          height: rect.height,
          cameraYaw: state.cameraYaw,
          cameraPitch: state.cameraPitch,
          fov: camera.fov,
        }),
        vertexIndex: index,
      }))
      .filter((point) => point.visible);
  }

  function appendSelectedPolygonHandles(fragment, rect) {
    if (state.manualAnnotation.mode !== 'editing' || !state.selectedAoiId) {
      return;
    }

    const selectedAoi = getRenderableAois().find((aoi) => aoi.id === state.selectedAoiId);
    if (selectedAoi?.shape !== 'polygon') {
      return;
    }

    if (!canEditPolygonVerticesAtCurrentTime(selectedAoi)) {
      setDynamicPolygonKeyframeEditMessage();
      return;
    }

    if (manualAoiStatus.textContent.includes('keyframe')) {
      manualAoiStatus.textContent = 'Kéo các đỉnh đa giác để tinh chỉnh AOI đã chọn.';
    }

    getPolygonHandleScreenPoints(selectedAoi, rect).forEach((point) => {
      appendAoiVertexHandle(fragment, point, point.vertexIndex, selectedAoi.id);
    });
  }

  function invalidateAoiOverlay() {
    aoiOverlayVersion += 1;
  }

  function buildAoiOverlaySignature(rect, videoRect) {
    const dynamicTimeBucket = activeAois.some((aoi) => (
      Array.isArray(aoi.keyframes) && aoi.keyframes.length
    ))
      ? Math.round((sourceVideo.currentTime || 0) * 10)
      : 0;
    const draftPointCount = Array.isArray(state.manualAnnotation.points)
      ? state.manualAnnotation.points.length
      : 0;

    return [
      aoiOverlayVersion,
      Math.round(rect.width),
      Math.round(rect.height),
      Math.round((videoRect.x || 0) * 10),
      Math.round((videoRect.y || 0) * 10),
      Math.round(videoRect.width * 10),
      Math.round(videoRect.height * 10),
      Math.round(state.cameraYaw * 10),
      Math.round(state.cameraPitch * 10),
      Math.round(camera.fov * 10),
      dynamicTimeBucket,
      state.selectedAoiId || '',
      state.manualAnnotation.mode,
      state.manualAnnotation.dragIndex ?? '',
      draftPointCount,
    ].join('|');
  }

  function drawAoiOverlay({
    nowMs = performance.now(),
    force = true,
    dragMode = false,
    minRedrawIntervalMs,
  } = {}) {
    const rect = viewer.getBoundingClientRect();

    if (!rect.width || !rect.height) {
      aoiOverlay.replaceChildren();
      return;
    }

    const videoRect = getCurrentVideoRect(rect);
    const signature = buildAoiOverlaySignature(rect, videoRect);

    if (!aoiOverlayRedrawGate.shouldRedraw({
      signature,
      nowMs,
      force,
      minIntervalMs: minRedrawIntervalMs,
    })) {
      return;
    }

    const renderableAois = getOverlayRenderableAois();

    aoiOverlay.setAttribute('viewBox', `0 0 ${rect.width} ${rect.height}`);
    aoiOverlay.setAttribute('width', String(rect.width));
    aoiOverlay.setAttribute('height', String(rect.height));

    const fragment = document.createDocumentFragment();

    const models = buildAoiOverlayModels({
      aois: renderableAois,
      rect,
      videoRect,
      camera: { yaw: state.cameraYaw, pitch: state.cameraPitch, fov: camera.fov },
      supportsColor: (color) => window.CSS?.supports('color', color),
      dragMode,
    });

    models.forEach((model) => {
      const shape = document.createElementNS(SVG_NS, 'polygon');
      shape.setAttribute('class', 'aoi-overlay-shape');
      shape.setAttribute('points', model.points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' '));
      shape.setAttribute('fill', model.color);
      shape.setAttribute('fill-opacity', String(model.fillOpacity ?? 0.16));
      shape.setAttribute('stroke', model.color);
      shape.dataset.aoiId = model.id;
      fragment.appendChild(shape);

      if (model.labelPoint) {
        const label = document.createElementNS(SVG_NS, 'text');
        label.setAttribute('class', 'aoi-overlay-label');
        label.setAttribute('x', String(model.labelPoint.x));
        label.setAttribute('y', String(model.labelPoint.y));
        label.textContent = model.label;
        fragment.appendChild(label);
      }
    });

    appendSelectedPolygonHandles(fragment, rect);
    appendDraftPolygon(fragment, rect);
    aoiOverlay.replaceChildren(fragment);
  }

  function renderAoiList({ focusAoiId = null } = {}) {
    aoiSourceLabel.textContent = aoiSource;
    if (state.selectedAoiId && !getActiveAoiById(state.selectedAoiId)) {
      state.selectedAoiId = null;
    }

    const items = activeAois.map((aoi) => {
      const bounds = getAoiBoundsLabel(aoi);
      const dynamicLabel = Array.isArray(aoi.keyframes) && aoi.keyframes.length ? ' (dynamic)' : '';
      const selected = aoi.id === state.selectedAoiId;
      const item = document.createElement('li');
      const button = document.createElement('button');
      const swatch = document.createElement('span');
      const content = document.createElement('span');
      const label = document.createElement('strong');
      const boundsLabel = document.createElement('span');

      item.classList.toggle('is-selected', selected);
      button.type = 'button';
      button.className = 'aoi-list-button';
      button.dataset.aoiId = aoi.id;
      button.setAttribute('aria-pressed', String(selected));
      swatch.className = 'swatch';
      swatch.setAttribute('aria-hidden', 'true');
      swatch.style.background = aoi.color;
      label.textContent = `${aoi.label}${dynamicLabel}`;
      boundsLabel.textContent = bounds;
      content.append(label, boundsLabel);
      button.append(swatch, content);
      item.append(button);

      return item;
    });

    aoiList.replaceChildren(...items);
    renderAoiStatsPanel();
    syncSelectedAoiPanel();
    if (focusAoiId) {
      focusAoiListButton(focusAoiId);
    }
  }

  function registerAois(aois, source, { preserveManualAnnotation = false } = {}) {
    const loadedAois = filterGeneratedSceneBackgroundAois(extractAoisFromJson(aois));
    const projectMetadata = extractProjectMetadataFromJson(aois);

    if (!loadedAois.length || !loadedAois.every(isValidAoi)) {
      throw new Error('AOI JSON phải chứa ít nhất một định nghĩa AOI hợp lệ.');
    }

    validateAoiVideoCompatibility({
      selectedVideo: selectedStudyVideo,
      metadataVideo: projectMetadata.video,
    });

    activeAois = withEffectiveAoisAnalysisPadding(loadedAois, getViewerAnalysisDimensions());
    resetAoiStability();
    invalidateAoiOverlay();
    aoiSource = source;
    registeredProjectMetadata = projectMetadata;
    state.selectedAoiId = null;
    applyVideoMetadataControls(registeredProjectMetadata.video || {});
    if (!preserveManualAnnotation) {
      setManualAnnotationIdle();
    }
    renderAoiList();
    syncParticipantSessionControls();
  }

  async function loadGeneratedAoisForStudyVideo(video) {
    const aoiPath = getGeneratedAoiPathForStudyVideo(video);
    const loadId = ++generatedAoiLoadId;

    if (!aoiPath) {
      return;
    }

    aoiSource = `loading ${aoiPath}`;
    renderAoiList();

    try {
      const response = await fetch(buildStudyAssetFetchPath(aoiPath), { cache: 'no-store' });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      if (loadId !== generatedAoiLoadId || selectedStudyVideo.id !== video.id) {
        return;
      }

      registerAois(await response.json(), aoiPath, {
        preserveManualAnnotation: state.manualAnnotation.mode === 'drawing',
      });
      setNotice(`Đã tải AOI tạo sẵn cho ${video.label}.`, false);
    } catch (error) {
      if (loadId !== generatedAoiLoadId || selectedStudyVideo.id !== video.id) {
        return;
      }

      activeAois = [];
      resetAoiStability();
      invalidateAoiOverlay();
      aoiSource = 'none';
      registeredProjectMetadata = { video: { ...sourceVideoInfo } };
      state.selectedAoiId = null;
      setManualAnnotationIdle();
      renderAoiList();
      setNotice(`Không thể tải AOI tạo sẵn cho ${video.label}: ${error.message}`);
    }
  }

  async function loadAoiFile(event) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    try {
      generatedAoiLoadId += 1;
      registerAois(JSON.parse(await file.text()), file.name);
      setNotice(`Đã tải AOI JSON: ${file.name}`, false);
    } catch (error) {
      setNotice(`Không thể tải AOI JSON: ${error.message}`);
    } finally {
      event.target.value = '';
    }
  }

  function stopReviewMode() {
    state.reviewActive = false;
    state.reviewIndex = 0;
    reviewButton.textContent = 'Xem lại bản ghi';
  }

  function registerRecording(json, source) {
    const samples = prepareReviewSamples(json);

    if (!samples.length) {
      throw new Error('JSON bản ghi không có mẫu ánh nhìn hợp lệ.');
    }

    if (Array.isArray(json.aois) && json.aois.length > 0) {
      registerAois(json, json.project?.aois?.source || source);
    }

    if (json.video && typeof json.video === 'object') {
      registeredProjectMetadata = {
        ...registeredProjectMetadata,
        video: { ...json.video },
      };
    }

    state.reviewSamples = samples;
    state.reviewSource = source;
    state.reviewActive = false;
    state.reviewIndex = 0;
    activeStatsSampleSource = 'review';
    reviewButton.disabled = false;
    sampleCount.textContent = String(samples.length);
    enterAnalyticsMode('review');
  }

  async function loadRecordingFile(event) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    try {
      generatedAoiLoadId += 1;
      registerRecording(JSON.parse(await file.text()), file.name);
      setNotice(`Đã tải JSON bản ghi: ${file.name}. Nhấp Xem lại bản ghi để phát lại mẫu bộ theo dõi.`, true);
    } catch (error) {
      setNotice(`Không thể tải JSON bản ghi: ${error.message}`);
    } finally {
      event.target.value = '';
    }
  }

  function getMergedHeatmapGroups() {
    return Array.isArray(mergedHeatmapExport?.groups) ? mergedHeatmapExport.groups : [];
  }

  function getSelectedMergedHeatmapGroup() {
    const groups = getMergedHeatmapGroups();

    return groups.find((group) => group.groupKey === mergedHeatmapGroupSelect.value) ?? null;
  }

  function getSelectedMergedHeatmap() {
    const group = getSelectedMergedHeatmapGroup();
    const variant = mergedHeatmapVariantSelect.value;
    const type = mergedHeatmapTypeSelect.value;

    if (!group?.summary?.heatmaps) {
      return null;
    }

    return group.summary.heatmaps.variants?.[variant]?.[type]
      ?? group.summary.heatmaps?.[type]
      ?? null;
  }

  const MERGED_HEATMAP_VARIANT_FALLBACKS = ['trusted', 'likely', 'possible'];
  const MERGED_HEATMAP_TYPE_FALLBACKS = ['panorama', 'screen'];

  function uniquePreferredMergedHeatmapValues(currentValue, fallbackValues) {
    return [currentValue, ...fallbackValues].filter((value, index, values) => (
      value && values.indexOf(value) === index
    ));
  }

  function getAvailableMergedHeatmapPath(group = getSelectedMergedHeatmapGroup()) {
    const heatmaps = group?.summary?.heatmaps;

    if (!heatmaps) {
      return null;
    }

    const currentVariant = mergedHeatmapVariantSelect.value;
    const currentType = mergedHeatmapTypeSelect.value;
    const currentHeatmap = heatmaps.variants?.[currentVariant]?.[currentType]
      ?? heatmaps?.[currentType]
      ?? null;

    if (currentHeatmap) {
      return {
        variant: currentVariant,
        type: currentType,
        heatmap: currentHeatmap,
      };
    }

    const variantPreference = uniquePreferredMergedHeatmapValues(
      currentVariant,
      MERGED_HEATMAP_VARIANT_FALLBACKS,
    );
    const typePreference = uniquePreferredMergedHeatmapValues(
      currentType,
      MERGED_HEATMAP_TYPE_FALLBACKS,
    );

    for (const variant of variantPreference) {
      for (const type of typePreference) {
        const heatmap = heatmaps.variants?.[variant]?.[type] ?? null;

        if (heatmap) {
          return { variant, type, heatmap };
        }
      }
    }

    for (const type of typePreference) {
      const heatmap = heatmaps?.[type] ?? null;

      if (heatmap) {
        return {
          variant: currentVariant || variantPreference[0] || MERGED_HEATMAP_VARIANT_FALLBACKS[0],
          type,
          heatmap,
        };
      }
    }

    return null;
  }

  function selectAvailableMergedHeatmapPath() {
    const path = getAvailableMergedHeatmapPath();

    if (!path) {
      return null;
    }

    mergedHeatmapVariantSelect.value = path.variant;
    mergedHeatmapTypeSelect.value = path.type;
    return path.heatmap;
  }

  function createMergedHeatmapGroupOption(group) {
    const option = document.createElement('option');
    const sourceCount = Number.isFinite(group.sourceCount) ? group.sourceCount : 0;
    const videoName = group.video?.name || group.groupKey || 'heatmap';

    option.value = group.groupKey;
    option.textContent = `${videoName} (${sourceCount} file)`;
    return option;
  }

  function createMergedHeatmapViewState() {
    const group = getSelectedMergedHeatmapGroup();
    const heatmap = getSelectedMergedHeatmap();

    if (!group || !heatmap) {
      return null;
    }

    return {
      groupKey: group.groupKey,
      variant: mergedHeatmapVariantSelect.value,
      type: mergedHeatmapTypeSelect.value,
      group,
      heatmap,
    };
  }

  function syncMergedHeatmapVideoContext(group) {
    const matchingStudyVideo = findStudyVideoById(group?.video?.id);

    if (matchingStudyVideo) {
      const expectedVideoInfo = videoInfoFromStudyVideo(matchingStudyVideo);
      const shouldLoadStudyVideo = (
        selectedStudyVideo.id !== matchingStudyVideo.id ||
        sourceVideoInfo.kind !== expectedVideoInfo.kind ||
        sourceVideoInfo.id !== expectedVideoInfo.id ||
        sourceVideoInfo.path !== expectedVideoInfo.path ||
        getCurrentProjection() !== normalizeVideoProjection(expectedVideoInfo.projection) ||
        getCurrentStereoLayout() !== normalizeStereoLayout(expectedVideoInfo.stereoLayout)
      );

      if (shouldLoadStudyVideo) {
        setStudyVideo(group.video.id, { clearAois: false });
      } else {
        syncViewerProjectionState();
      }
      return true;
    }

    if (group?.video?.projection || group?.video?.stereoLayout) {
      applyVideoMetadataControls(group.video);
      syncViewerProjectionState();
    }

    return false;
  }

  function hasMergedHeatmapVideoMetadata(group) {
    return Boolean(
      group?.video?.id ||
      group?.video?.name ||
      group?.video?.src ||
      group?.video?.projection ||
      group?.video?.stereoLayout
    );
  }

  function getMergedHeatmapOverlaySignature() {
    const dimensions = getViewerScreenDimensions();
    const view = activeMergedHeatmapView;

    return [
      'merged',
      view?.groupKey ?? '',
      view?.group?.video?.id ?? '',
      view?.variant ?? '',
      view?.type ?? '',
      view?.heatmap?.type ?? '',
      getCurrentProjection(),
      state.cameraYaw.toFixed(3),
      state.cameraPitch.toFixed(3),
      camera.fov.toFixed(3),
      Math.round(dimensions.width),
      Math.round(dimensions.height),
    ].join('|');
  }

  function drawMergedHeatmapOverlay() {
    const ctx = gazeHeatmapOverlay.getContext('2d');
    if (!ctx) {
      return;
    }

    if (!activeMergedHeatmapView?.heatmap) {
      clearGazeHeatmapOverlay();
      return;
    }

    const dimensions = syncGazeHeatmapOverlaySize();
    const { width, height, pixelRatio } = dimensions;
    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const points = buildMergedHeatmapOverlayPoints({
      heatmap: activeMergedHeatmapView.heatmap,
      dimensions,
      projectPanoramaPoint: ({ yaw, pitch }) => {
        const projected = panoramaPointToScreen({
          yaw,
          pitch,
          width: dimensions.width,
          height: dimensions.height,
          cameraYaw: state.cameraYaw,
          cameraPitch: state.cameraPitch,
          fov: camera.fov,
        });

        return projected;
      },
    });

    activeMergedHeatmapView.pointCount = points.length;
    drawHeatmapPoints(ctx, points, dimensions);
  }

  function redrawMergedHeatmapOverlay({ force = false } = {}) {
    if (!activeMergedHeatmapView) {
      return;
    }

    const signature = getMergedHeatmapOverlaySignature();
    if (!force && signature === heatmapOverlaySignature) {
      return;
    }

    heatmapOverlaySignature = signature;
    drawMergedHeatmapOverlay();
  }

  function redrawHeatmapOverlay({ force = false } = {}) {
    if (activeMergedHeatmapView) {
      redrawMergedHeatmapOverlay({ force });
      return;
    }

    redrawAnalyticsHeatmapOverlay({ force });
  }

  function viewSelectedMergedHeatmap({ auto = false } = {}) {
    selectAvailableMergedHeatmapPath();
    const viewState = createMergedHeatmapViewState();

    if (!viewState) {
      if (!auto) {
        setNotice('Chọn heatmap tổng hợp lệ để xem.', true);
      }
      clearActiveMergedHeatmapView();
      syncMergedHeatmapControls();
      return;
    }

    const hasMatchingStudyVideo = syncMergedHeatmapVideoContext(viewState.group);
    const shouldWarnMissingVideo = !hasMatchingStudyVideo && hasMergedHeatmapVideoMetadata(viewState.group);
    exitAnalyticsMode({ clearOverlay: false });
    activeMergedHeatmapView = viewState;
    appShell.classList.add('is-merged-heatmap-view');
    redrawMergedHeatmapOverlay({ force: true });
    syncMergedHeatmapControls({ refreshActiveView: false });
    setNotice(
      `Đã hiển thị heatmap tổng.${shouldWarnMissingVideo ? ' Hãy tải đúng video nền nếu heatmap tổng đến từ video cục bộ.' : ''}`,
      true,
    );
  }

  function clearMergedHeatmapView() {
    clearActiveMergedHeatmapView();
    syncMergedHeatmapControls();
  }

  function clearActiveMergedHeatmapView() {
    activeMergedHeatmapView = null;
    appShell.classList.remove('is-merged-heatmap-view');
    clearGazeHeatmapOverlay();
  }

  function refreshActiveMergedHeatmapView(selectedHeatmap) {
    if (!activeMergedHeatmapView) {
      return;
    }

    if (!selectedHeatmap) {
      clearActiveMergedHeatmapView();
      return;
    }

    activeMergedHeatmapView = createMergedHeatmapViewState();
    if (!activeMergedHeatmapView) {
      clearActiveMergedHeatmapView();
      return;
    }

    syncMergedHeatmapVideoContext(activeMergedHeatmapView.group);
    appShell.classList.add('is-merged-heatmap-view');
    redrawMergedHeatmapOverlay({ force: true });
  }

  function syncMergedHeatmapControls({ refreshActiveView = true } = {}) {
    const groups = getMergedHeatmapGroups();
    const previousGroupKey = mergedHeatmapGroupSelect.value;
    const hasGroups = groups.length > 0;

    mergedHeatmapGroupSelect.replaceChildren(...groups.map(createMergedHeatmapGroupOption));
    if (groups.some((group) => group.groupKey === previousGroupKey)) {
      mergedHeatmapGroupSelect.value = previousGroupKey;
    }

    const selectedGroup = getSelectedMergedHeatmapGroup();
    if (!selectedGroup && hasGroups) {
      mergedHeatmapGroupSelect.value = groups[0].groupKey;
    }

    const selectedHeatmap = selectAvailableMergedHeatmapPath();
    if (refreshActiveView) {
      refreshActiveMergedHeatmapView(selectedHeatmap);
    }

    mergedHeatmapGroupSelect.disabled = !hasGroups;
    mergedHeatmapVariantSelect.disabled = !hasGroups;
    mergedHeatmapTypeSelect.disabled = !hasGroups;
    viewMergedHeatmapButton.disabled = !selectedHeatmap;
    clearMergedHeatmapViewButton.disabled = !activeMergedHeatmapView;
    exportMergedHeatmapJsonButton.disabled = !hasGroups;
    exportMergedHeatmapImageButton.disabled = !selectedHeatmap;

    if (!mergedHeatmapExport) {
      heatmapMergeStatus.textContent = 'Chưa tải JSON heatmap.';
      return;
    }

    heatmapMergeStatus.textContent = `Đã tải ${mergedHeatmapExport.sourceFileCount} file, ${mergedHeatmapExport.groupCount} nhóm, bỏ qua ${mergedHeatmapExport.skipped.length}.`;
  }

  async function loadHeatmapMergeFiles(event) {
    const files = Array.from(event.target.files || []);
    const loadId = ++heatmapMergeLoadId;
    const importToken = ++mergedHeatmapImportToken;

    try {
      if (!files.length) {
        return;
      }

      const { entries, skipped, sourceFileCount } = await readHeatmapExportFiles(files);

      if (loadId !== heatmapMergeLoadId) {
        return;
      }
      if (importToken !== mergedHeatmapImportToken) {
        return;
      }

      mergedHeatmapExport = buildMergedHeatmapExport(entries, {
        skipped,
        sourceFileCount,
      });
      syncMergedHeatmapControls();
      setNotice(`Đã gộp heatmap: ${mergedHeatmapExport.sourceFileCount} file, ${mergedHeatmapExport.groupCount} nhóm, bỏ qua ${mergedHeatmapExport.skipped.length}.`, true);
    } catch (error) {
      if (loadId !== heatmapMergeLoadId) {
        return;
      }
      if (importToken !== mergedHeatmapImportToken) {
        return;
      }

      mergedHeatmapExport = null;
      syncMergedHeatmapControls();
      setNotice(`Không thể gộp heatmap JSON: ${error.message}`, true);
    } finally {
      event.target.value = '';
    }
  }

  async function loadMergedHeatmapPackageFile(event) {
    const file = event.target.files?.[0];
    const loadId = ++mergedHeatmapPackageLoadId;
    const importToken = ++mergedHeatmapImportToken;

    try {
      if (!file) {
        return;
      }

      const { payload } = await readMergedHeatmapPackageFile(file);

      if (loadId !== mergedHeatmapPackageLoadId) {
        return;
      }
      if (importToken !== mergedHeatmapImportToken) {
        return;
      }

      mergedHeatmapExport = payload;
      syncMergedHeatmapControls({ refreshActiveView: false });
      setNotice(`Đã tải JSON heatmap tổng: ${payload.groupCount} nhóm.`, true);
      viewSelectedMergedHeatmap({ auto: true });
    } catch (error) {
      if (loadId !== mergedHeatmapPackageLoadId) {
        return;
      }
      if (importToken !== mergedHeatmapImportToken) {
        return;
      }

      clearMergedHeatmapView();
      mergedHeatmapExport = null;
      syncMergedHeatmapControls();
      setNotice(`Không thể tải JSON heatmap tổng: ${error.message}`, true);
    } finally {
      event.target.value = '';
    }
  }

  function resize() {
    const rect = viewer.getBoundingClientRect();
    renderer.setSize(rect.width, rect.height, false);
    camera.aspect = rect.width / rect.height;
    camera.updateProjectionMatrix();
    syncProjectionMesh(rect);
    redrawHeatmapOverlay();
  }

  function updateCamera() {
    camera.rotation.order = 'YXZ';
    if (getCurrentProjection() === 'flat') {
      camera.rotation.y = 0;
      camera.rotation.x = 0;
      redrawHeatmapOverlay();
      return;
    }

    camera.rotation.y = THREE.MathUtils.degToRad(state.cameraYaw);
    camera.rotation.x = THREE.MathUtils.degToRad(state.cameraPitch);
    redrawHeatmapOverlay();
  }

  function syncProjectionMesh(rect = viewer.getBoundingClientRect()) {
    const isFlat = getCurrentProjection() === 'flat';
    const transform = getProjectionTextureTransform({
      projection: getCurrentProjection(),
      stereoLayout: getCurrentStereoLayout(),
      eye: sourceVideoInfo.stereoEye || 'left',
    });
    const textureSignature = [
      material.map?.uuid || '',
      transform.offsetX,
      transform.offsetY,
      transform.repeatX,
      transform.repeatY,
    ].join('|');

    if (textureSignature !== textureTransformSignature && material.map) {
      material.map.offset.set(transform.offsetX, transform.offsetY);
      material.map.repeat.set(transform.repeatX, transform.repeatY);
      material.map.updateMatrix();
      material.map.needsUpdate = true;
      material.needsUpdate = true;
      textureTransformSignature = textureSignature;
    }
    sphere.visible = !isFlat;
    flatVideoPlane.visible = isFlat;

    if (!isFlat || !rect.width || !rect.height) {
      return;
    }

    const distance = 500;
    const videoRect = getCurrentVideoRect(rect);
    const viewHeight = 2 * distance * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    const viewWidth = viewHeight * camera.aspect;

    flatVideoPlane.position.set(
      viewWidth * ((videoRect.x + videoRect.width / 2) / rect.width - 0.5),
      -viewHeight * ((videoRect.y + videoRect.height / 2) / rect.height - 0.5),
      -distance,
    );
    flatVideoPlane.scale.set(
      viewWidth * (videoRect.width / rect.width),
      viewHeight * (videoRect.height / rect.height),
      1,
    );
  }

  function setWebcamStatus(status) {
    state.webcamStatus = status;
    webcamStatusLabel.textContent = status;
    syncAdminGazeSetupControls();
    syncParticipantSessionControls();
    syncValidationTestControls();
  }

  function blockWebGazerMouseTraining() {
    window.__aoiBlockWebGazerMouseTraining = true;
  }

  async function resetWebcamCalibrationData() {
    await webcamProvider?.resetCalibration();

    state.gaze = createDefaultGaze();
    state.webcamCalibrationTrained = false;
    state.rawPageGaze = null;
    state.rawViewerGaze = null;
    state.rawGazeAt = 0;
    state.rawGazeDiagnostic = {
      active: false,
      index: 0,
      targets: [],
      latestSummary: null,
    };
    setRawDiagnosticStatus(null);
    clearAccuracyRefinement();
    state.gazeDropReason = null;
    state.droppedGazeSamples = 0;
    state.gazeStreamStats = null;
  }

  function formatValidationPx(value) {
    return Number.isFinite(value) ? `${Math.round(value)} px` : '--';
  }

  function hideValidationStatsPopup() {
    validationStatsPopup.hidden = true;
  }

  function showValidationStatsPopup(evaluation, summary) {
    if (state.appMode !== 'validation') {
      return;
    }

    const hasStats = summary?.quality !== 'untested' && Number.isFinite(summary?.meanPx);
    const resultText = !hasStats
      ? 'Không đủ dữ liệu'
      : evaluation?.validationPassed
        ? 'Đạt yêu cầu'
        : 'Chưa đạt';

    validationStatsPopup.dataset.result = !hasStats
      ? 'untested'
      : evaluation?.validationPassed
        ? 'passed'
        : 'failed';
    validationStatsSummary.textContent = hasStats
      ? `${resultText}: lỗi trung bình ${formatValidationPx(summary.meanPx)}, P90 ${formatValidationPx(summary.p90Px)}.`
      : 'Không đủ dữ liệu ánh nhìn ổn định để tính độ chính xác. Hãy hiệu chỉnh camera và chạy lại.';
    validationStatsMean.textContent = formatValidationPx(summary?.meanPx);
    validationStatsMedian.textContent = formatValidationPx(summary?.medianPx);
    validationStatsP90.textContent = formatValidationPx(summary?.p90Px);
    validationStatsMax.textContent = formatValidationPx(summary?.maxPx);
    validationStatsStability.textContent = formatValidationPx(summary?.p90DispersionPx);
    validationStatsTargetCount.textContent = Number.isFinite(summary?.count)
      ? `${summary.count}`
      : '--';
    validationStatsPopup.hidden = false;
    validationStatsCloseButton.focus({ preventScroll: true });
  }

  function buildValidationResultPayload(evaluation, summary) {
    syncSelectedCalibrationProfileState();

    return {
      type: 'validation-result',
      exportedAt: new Date().toISOString(),
      appMode: state.appMode,
      project: buildProjectPackage(),
      video: buildVideoPackageMetadata(),
      validation: {
        id: 'validation-test',
        passed: Boolean(evaluation?.validationPassed),
        reason: evaluation?.reason ?? null,
        selectedValidationPolicyId: state.selectedValidationPolicyId ?? evaluation?.validationPolicyId ?? 'prototype',
        validationPolicyId: evaluation?.validationPolicyId ?? null,
        policyPassed: evaluation?.policyPassed ?? null,
        policyFailures: Array.isArray(evaluation?.policyFailures)
          ? evaluation.policyFailures.map((failure) => ({ ...failure }))
          : [],
        summary: summary ? structuredClone(summary) : null,
        accuracySummary: evaluation?.accuracySummary ? structuredClone(evaluation.accuracySummary) : null,
        validationSummary: evaluation?.validationSummary ? structuredClone(evaluation.validationSummary) : null,
        correctedValidationSummary: evaluation?.correctedValidationSummary
          ? structuredClone(evaluation.correctedValidationSummary)
          : null,
        refinementSummary: evaluation?.refinement?.correctedSummary
          ? structuredClone(evaluation.refinement.correctedSummary)
          : null,
        gazeStreamQuality: state.validationGazeStreamQuality
          ? structuredClone(state.validationGazeStreamQuality)
          : null,
        refinementSamples: structuredClone(state.accuracySamples),
        validationSamples: structuredClone(state.validationSamples),
      },
    };
  }

  async function submitValidationTestResult(evaluation, summary) {
    if (state.appMode !== 'validation') {
      return;
    }

    try {
      const result = await submitValidationResult(buildValidationResultPayload(evaluation, summary), {
        config: getDeploymentConfig(window),
        fetchFn: window.fetch.bind(window),
      });

      if (result.ok) {
        validationStatsPopup.dataset.uploaded = 'true';
        validationStatsPopup.dataset.uploadFileName = result.fileName;
      } else if (!result.skipped) {
        validationStatsPopup.dataset.uploaded = 'false';
      }
    } catch {
      validationStatsPopup.dataset.uploaded = 'false';
    }
  }

  function setAccuracySummary(summary) {
    if (!summary || summary.quality === 'untested') {
      accuracyStatusLabel.textContent = 'chưa kiểm tra';
      syncAdminGazeSetupControls();
      syncParticipantSessionControls();
      syncValidationTestControls();
      return;
    }

    if (state.accuracyValidated && state.correctedAccuracySummary) {
      accuracyStatusLabel.textContent = `validated ${Math.round(state.correctedAccuracySummary.meanPx)}px`;
      syncAdminGazeSetupControls();
      syncParticipantSessionControls();
      syncValidationTestControls();
      return;
    }

    accuracyStatusLabel.textContent = `${summary.quality} ${Math.round(summary.meanPx)}px`;
    syncAdminGazeSetupControls();
    syncParticipantSessionControls();
    syncValidationTestControls();
  }

  function getCurrentUncertaintyPx(point = null) {
    if (state.mode !== 'webcam' || !state.accuracyValidated || !state.correctedAccuracySummary) {
      return 0;
    }

    const globalP90Uncertainty = Math.max(
      state.correctedAccuracySummary.meanPx || 0,
      state.correctedAccuracySummary.medianPx || 0,
      state.correctedAccuracySummary.p90Px || 0,
      state.correctedAccuracySummary.p90DispersionPx || 0,
    );
    const globalFloorUncertainty = Math.max(
      state.correctedAccuracySummary.meanPx || 0,
      state.correctedAccuracySummary.medianPx || 0,
      state.correctedAccuracySummary.p90DispersionPx || 0,
    );

    if (!state.localAccuracyErrorModel || !point) {
      return globalP90Uncertainty;
    }

    return estimateLocalAccuracyErrorPx(point, state.localAccuracyErrorModel, globalFloorUncertainty);
  }

  function clearAccuracyRefinement() {
    state.gazeCorrection = null;
    state.refinementAccuracySummary = null;
    state.accuracySummary = null;
    state.correctedAccuracySummary = null;
    state.localAccuracyErrorModel = null;
    state.accuracySamples = [];
    state.validationSamples = [];
    state.accuracyTargetRejectCounts = [];
    state.accuracyValidated = false;
    state.accuracyValidatedAt = null;
    state.accuracyInvalidationReason = null;
    state.validationPolicyId = null;
    state.policyPassed = null;
    state.policyFailures = [];
    state.activeValidationPolicyId = null;
    state.validationGazeStreamStats = null;
    state.validationGazeStreamQuality = null;
    state.liveGazeQuality = null;
    resetFaceQualityValidationState();
    setAccuracySummary(null);
  }

  function handleResize() {
    resize();
  }

  function setMouseMode() {
    stopReviewMode();
    state.mode = 'mouse';
    state.gaze = createDefaultGaze({ source: 'mouse' });
    mouseModeButton.classList.add('is-active');
    webcamModeButton.classList.remove('is-active');
    modeLabel.textContent = 'chuột';
    syncAdminGazeSetupControls();
  }

  function selectWebcamMode() {
    stopReviewMode();
    state.mode = 'webcam';
    state.gaze = createDefaultGaze();
    mouseModeButton.classList.remove('is-active');
    webcamModeButton.classList.add('is-active');
    modeLabel.textContent = 'webcam';
    syncAdminGazeSetupControls();
  }

  function resetLiveGazeQuality() {
    state.liveGazeQuality = null;
  }

  function resetLiveGazeFilterState() {
    state.gaze = createDefaultGaze();
    state.lastAcceptedGazeAt = 0;
    state.gazeDropReason = null;
  }

  function resetFaceQualityValidationState() {
    state.faceQualityBaseline = null;
    state.faceQualityInvalidations = [];
    state.faceQualityConsecutiveFailures = 0;
  }

  function getFaceQualityRuntimeMetadata() {
    return {
      available: state.faceQualityAvailable,
      unavailableReason: state.faceQualityUnavailableReason,
      baseline: state.faceQualityBaseline,
      invalidations: state.faceQualityInvalidations.map((invalidation) => ({
        ...invalidation,
        reasons: Array.isArray(invalidation.reasons) ? [...invalidation.reasons] : [],
      })),
    };
  }

  function hasActiveAccuracyValidation() {
    return state.targetMode === 'accuracy' && !calibrationOverlay.hidden;
  }

  function getLiveGazeUpdateOptions() {
    if (hasActiveAccuracyValidation()) {
      return {
        alpha: 1,
        maxJumpPx: Number.POSITIVE_INFINITY,
        adaptiveSmoothing: false,
        adaptiveSmoothingOptions: {},
      };
    }

    return {
      alpha: GAZE_SMOOTHING_ALPHA,
      maxJumpPx: MAX_GAZE_JUMP_PX,
      adaptiveSmoothing: true,
      adaptiveSmoothingOptions: {
        maxAlpha: GAZE_FAST_SMOOTHING_ALPHA,
        fastDistancePx: GAZE_FAST_SMOOTHING_DISTANCE_PX,
      },
    };
  }

  function buildGazeStreamEvent(event) {
    return {
      atMs: event.atMs ?? performance.now(),
      accepted: event.accepted,
      reason: event.reason,
      onScreen: event.onScreen ?? null,
    };
  }

  function registerGazeStreamEvent(event) {
    const isAccuracyRun = hasActiveAccuracyValidation();
    const isRecordingRun = state.isRecording && !state.reviewActive;

    if (!isRecordingRun && !isAccuracyRun) {
      return;
    }

    const streamEvent = buildGazeStreamEvent(event);

    if (isRecordingRun) {
      state.gazeStreamStats = updateGazeStreamStats(state.gazeStreamStats, streamEvent);
    }

    if (isAccuracyRun) {
      state.validationGazeStreamStats = updateGazeStreamStats(state.validationGazeStreamStats, streamEvent);
    }
  }

  function registerBoundedGazeStreamDrop({ atMs, reason, onScreen = null }) {
    const stats = hasActiveAccuracyValidation()
      ? state.validationGazeStreamStats
      : state.gazeStreamStats;

    if (!shouldRecordGazeStreamDrop(stats, { atMs, reason }, LIVE_GAZE_STALE_MS)) {
      return;
    }

    registerGazeStreamEvent({
      atMs,
      accepted: false,
      reason,
      onScreen,
    });
  }

  function getCurrentGazeStreamQuality() {
    return summarizeGazeStreamQuality(state.gazeStreamStats);
  }

  function getCurrentValidationGazeStreamQuality() {
    return summarizeGazeStreamQuality(state.validationGazeStreamStats);
  }

  function applyAccuracyPolicyState(evaluation) {
    state.validationPolicyId = evaluation.validationPolicyId;
    state.policyPassed = evaluation.policyPassed;
    state.policyFailures = Array.isArray(evaluation.policyFailures)
      ? evaluation.policyFailures
      : [];
  }

  function formatPolicyMetric(metric) {
    return {
      meanPx: 'mean',
      p90Px: 'p90',
      maxPx: 'worst target',
      p90DispersionPx: 'capture p90',
      maxDispersionPx: 'capture worst',
      effectiveHz: 'stream Hz',
      dataIntegrityPercent: 'data integrity',
    }[metric] || metric;
  }

  function formatPolicyValue(value, metric) {
    if (!Number.isFinite(value)) {
      return 'missing';
    }

    return metric === 'dataIntegrityPercent'
      ? `${Math.round(value)}%`
      : String(Math.round(value));
  }

  function formatPolicyFailure(failure) {
    return `${formatPolicyMetric(failure.metric)} ${formatPolicyValue(failure.actual, failure.metric)} ${failure.comparator} ${formatPolicyValue(failure.limit, failure.metric)}`;
  }

  function formatPolicyFailureNotice(evaluation) {
    const policyLabel = evaluation.validationPolicyId === 'research'
      ? 'Research policy'
      : 'Validation policy';
    const details = (evaluation.policyFailures || [])
      .filter((failure) => failure.metric !== 'validation')
      .map(formatPolicyFailure)
      .join(', ');

    return details
      ? `${policyLabel} không đạt: ${details}. Hãy hiệu chuẩn lại để khôi phục độ chính xác webcam đáng tin cậy.`
      : `${policyLabel} không đạt. Hãy hiệu chuẩn lại để khôi phục độ chính xác webcam đáng tin cậy.`;
  }

  function resetRecordingSampleScheduler() {
    recordingSampleScheduler = createSampleScheduler({ intervalMs: RECORDING_SAMPLE_INTERVAL_MS });
  }

  function stopActiveRecordingForTargetMode() {
    if (!state.isRecording) {
      return false;
    }

    state.isRecording = false;
    resetRecordingSampleScheduler();
    recordButton.textContent = 'Bắt đầu ghi';
    recordButton.classList.add('primary');
    syncParticipantSessionControls();
    return true;
  }

  function invalidateAccuracyForLiveGazeQuality(reason) {
    if (!state.accuracyValidated) {
      return;
    }

    state.accuracyValidated = false;
    state.accuracyValidatedAt = null;
    state.accuracyInvalidationReason = reason;
    state.gazeCorrection = null;
    state.localAccuracyErrorModel = null;
    accuracyStatusLabel.textContent = 'cần kiểm tra lại';

    if (state.isRecording) {
      state.isRecording = false;
      resetRecordingSampleScheduler();
      recordButton.textContent = 'Bắt đầu ghi';
      recordButton.classList.add('primary');
    }

    setNotice('Theo dõi webcam trở nên không ổn định. Có thể ghi lại, nhưng độ chính xác webcam khi xuất sẽ chưa được xác thực cho đến khi Kiểm tra độ chính xác đạt.', true);
  }

  function invalidateAccuracyForSetupChange(reason) {
    if (!state.accuracyValidated) {
      return;
    }

    state.accuracyValidated = false;
    state.accuracyValidatedAt = null;
    state.accuracyInvalidationReason = reason;
    state.gazeCorrection = null;
    state.localAccuracyErrorModel = null;
    accuracyStatusLabel.textContent = 'cần kiểm tra lại';

    if (state.isRecording) {
      state.isRecording = false;
      resetRecordingSampleScheduler();
      recordButton.textContent = 'Bắt đầu ghi';
      recordButton.classList.add('primary');
    }

    setNotice('Thiết lập webcam có thể đã thay đổi. Có thể ghi lại, nhưng độ chính xác webcam khi xuất sẽ chưa được xác thực cho đến khi Kiểm tra độ chính xác đạt.', true);
  }

  function getValidationMaxAgeMs() {
    const override = Number(window.__aoiValidationMaxAgeMs);
    return Number.isFinite(override) && override > 0
      ? override
      : DEFAULT_VALIDATION_MAX_AGE_MS;
  }

  function invalidateExpiredAccuracy(now = performance.now()) {
    if (
      state.mode !== 'webcam' ||
      !state.accuracyValidated ||
      isValidationFresh({
        validatedAt: state.accuracyValidatedAt,
        now,
        maxAgeMs: getValidationMaxAgeMs(),
      })
    ) {
      return;
    }

    invalidateAccuracyForSetupChange('validation-expired');
    setNotice('Kiểm tra độ chính xác webcam đã hết hạn. Có thể ghi lại, nhưng độ chính xác webcam khi xuất sẽ chưa được xác thực cho đến khi Kiểm tra độ chính xác đạt.', true);
  }

  function handleWindowFocusLoss() {
    if (state.mode === 'webcam') {
      invalidateAccuracyForSetupChange('window-focus-lost');
    }
  }

  function handleVisibilityChange() {
    if (document.hidden && state.mode === 'webcam') {
      invalidateAccuracyForSetupChange('page-hidden');
    }
  }

  function registerLiveGazeQualityEvent(event) {
    if (
      state.mode !== 'webcam' ||
      !state.accuracyValidated ||
      !state.isRecording ||
      !calibrationOverlay.hidden
    ) {
      return;
    }

    state.liveGazeQuality = updateLiveGazeQuality(state.liveGazeQuality, event, {
      maxEvents: LIVE_QUALITY_MAX_EVENTS,
      minEvents: LIVE_QUALITY_MIN_EVENTS,
      maxBadRate: LIVE_QUALITY_MAX_BAD_RATE,
      maxConsecutiveBad: LIVE_QUALITY_MAX_CONSECUTIVE_BAD,
    });

    if (state.liveGazeQuality.unreliable) {
      invalidateAccuracyForLiveGazeQuality(state.liveGazeQuality.reason);
    }
  }

  function recordFaceQualityInvalidation(drift) {
    state.faceQualityInvalidations.push({
      atMs: performance.now(),
      reason: 'face-pose-drift',
      reasons: [...drift.reasons],
      centerShift: drift.centerShift ?? null,
      scaleChange: drift.scaleChange ?? null,
    });
  }

  function registerFacePoseQuality(summary) {
    if (
      state.mode !== 'webcam' ||
      !state.accuracyValidated ||
      !state.isRecording ||
      !state.faceQualityAvailable ||
      !state.faceQualityBaseline
    ) {
      return;
    }

    const drift = compareFacePoseToBaseline(summary, state.faceQualityBaseline);

    if (drift.accepted) {
      state.faceQualityConsecutiveFailures = 0;
      return;
    }

    state.faceQualityConsecutiveFailures += 1;

    if (state.faceQualityConsecutiveFailures < FACE_QUALITY_MAX_CONSECUTIVE_FAILURES) {
      return;
    }

    recordFaceQualityInvalidation(drift);
    invalidateAccuracyForSetupChange('face-pose-drift');
  }

  function handleFaceQuality(quality = {}) {
    if (quality.available === false) {
      state.faceQualityAvailable = false;
      state.faceQualityUnavailableReason = quality.reason || 'provider-face-quality-unavailable';
      state.currentFaceQuality = null;
      state.faceQualityConsecutiveFailures = 0;
      return;
    }

    const currentSummary = normalizeFaceQualitySummary(quality.summary)
      ?? normalizeFaceQualitySummary(quality.box)
      ?? normalizeFaceQualitySummary(quality.faceBox)
      ?? normalizeFaceQualitySummary(quality);

    state.faceQualityAvailable = true;
    state.faceQualityUnavailableReason = null;
    state.currentFaceQuality = currentSummary;
    registerFacePoseQuality(state.currentFaceQuality);
  }

  function captureFaceQualityBaseline() {
    if (!state.faceQualityAvailable || !state.currentFaceQuality) {
      state.faceQualityBaseline = null;
      state.faceQualityConsecutiveFailures = 0;
      return;
    }

    state.faceQualityBaseline = { ...state.currentFaceQuality };
    state.faceQualityConsecutiveFailures = 0;
  }

  function canHoldLastWebcamGaze(now = performance.now()) {
    if (hasActiveAccuracyValidation()) {
      return false;
    }

    return (
      state.mode === 'webcam' &&
      state.gaze.visible &&
      state.gaze.source === 'webcam' &&
      Number.isFinite(state.lastAcceptedGazeAt) &&
      state.lastAcceptedGazeAt > 0 &&
      now - state.lastAcceptedGazeAt <= LIVE_GAZE_HOLD_MS
    );
  }

  function holdLastWebcamGaze(reason) {
    state.gaze = {
      ...state.gaze,
      visible: true,
      held: true,
    };
    state.gazeDropReason = `${reason}-held`;
  }

  function processWebcamGaze(data) {
    const rect = viewer.getBoundingClientRect();
    const now = performance.now();
    const pageGaze = {
      x: data.x,
      y: data.y,
      visible: true,
      source: 'webcam',
    };
    const rawViewerGaze = {
      x: data.x - rect.left,
      y: data.y - rect.top,
      visible: true,
      source: 'webcam',
    };

    state.rawPageGaze = pageGaze;
    state.rawViewerGaze = rawViewerGaze;
    state.rawGazeAt = now;

    const viewport = {
      width: rect.width,
      height: rect.height,
    };
    const viewerGaze = applyViewportCalibration(rawViewerGaze, state.gazeCorrection, viewport);
    const rawOnScreen = isGazeInsideViewport(rawViewerGaze, viewport);
    const rawBoundsMargin = Math.max(rect.width, rect.height) * RAW_GAZE_BOUNDS_MARGIN_RATIO;

    if (!isGazeInsideViewport(rawViewerGaze, viewport, rawBoundsMargin)) {
      state.droppedGazeSamples += 1;
      if (canHoldLastWebcamGaze(now)) {
        registerGazeStreamEvent({
          atMs: now,
          accepted: false,
          reason: 'raw-out-of-bounds-held',
          onScreen: rawOnScreen,
        });
        holdLastWebcamGaze('raw-out-of-bounds');
        return;
      }

      state.gaze = createDefaultGaze();
      state.gazeDropReason = 'raw-out-of-bounds';
      registerGazeStreamEvent({
        atMs: now,
        accepted: false,
        reason: 'raw-out-of-bounds',
        onScreen: rawOnScreen,
      });
      registerLiveGazeQualityEvent({ accepted: false, reason: 'raw-out-of-bounds' });
      return;
    }

    const previousWebcamGaze = state.gaze.visible && state.gaze.source === 'webcam' ? state.gaze : null;
    const liveGazeUpdateOptions = getLiveGazeUpdateOptions();
    const update = resolveGazeUpdate({
      previous: previousWebcamGaze,
      next: viewerGaze,
      viewport,
      boundsMarginPx: GAZE_BOUNDS_MARGIN_PX,
      ...liveGazeUpdateOptions,
    });

    if (!update.accepted) {
      state.droppedGazeSamples += 1;
      if (canHoldLastWebcamGaze(now)) {
        state.gaze = update.gaze.visible ? update.gaze : state.gaze;
        registerGazeStreamEvent({
          atMs: now,
          accepted: false,
          reason: `${update.reason}-held`,
          onScreen: rawOnScreen,
        });
        holdLastWebcamGaze(update.reason);
        return;
      }

      state.gaze = update.gaze;
      state.gazeDropReason = update.reason;
      registerGazeStreamEvent({
        atMs: now,
        accepted: false,
        reason: update.reason,
        onScreen: rawOnScreen,
      });
      registerLiveGazeQualityEvent({ accepted: false, reason: update.reason });
      return;
    }

    state.gaze = update.gaze;
    state.lastAcceptedGazeAt = now;
    state.gazeDropReason = null;
    registerGazeStreamEvent({
      atMs: now,
      accepted: true,
      onScreen: rawOnScreen,
    });
    registerLiveGazeQualityEvent({ accepted: true, reason: null });
  }

  async function startWebcamGazeProvider(providerId) {
    if (state.webcamStarted || webcamProvider) {
      stopWebcamProviderForSwitch();
    }

    if (providerId === 'webgazer' && !window.webgazer) {
      setNotice('WebGazer chưa tải được. Kiểm tra kết nối internet hoặc dùng chế độ ánh nhìn bằng chuột.');
      setWebcamStatus('unloaded');
      return false;
    }

    if (providerId === 'seeso' && !getSeeSoLicenseKey()) {
      setNotice('Thiếu khóa bộ theo dõi ánh nhìn lưu trữ trong cấu hình ứng dụng.');
      setWebcamStatus('no key');
      return false;
    }

    setWebcamStatus('starting');

    let provider = null;

    try {
      const providerCallbacks = {
        onGaze: (data) => {
          if (state.mode !== 'webcam') {
            return;
          }

          processWebcamGaze(data);
        },
        onFaceQuality: handleFaceQuality,
      };

      if (providerId === 'seeso') {
        const calibrationData = getSeeSoCalibrationData();
        const geometrySettings = requireSeeSoGeometrySettings();
        if (!geometrySettings) {
          setWebcamStatus('idle');
          return false;
        }
        provider = createSeeSoProvider({
          licenseKey: getSeeSoLicenseKey(),
          calibrationData,
          monitorSizeInch: geometrySettings.monitorSizeInch,
          faceDistanceCm: geometrySettings.faceDistanceCm,
          windowRef: window,
          navigatorRef: window.navigator,
          ...providerCallbacks,
        });
        state.webcamCalibrationTrained = Boolean(calibrationData);
      } else {
        provider = createWebGazerProvider({
          webgazer: window.webgazer,
          ...providerCallbacks,
        });
      }

      webcamProvider = provider;
      await provider.start();

      if (webcamProvider !== provider || getSelectedGazeProviderId() !== providerId) {
        provider.stop?.();
        if (webcamProvider === provider) {
          webcamProvider = null;
          activeGazeProviderId = null;
          state.webcamStarted = false;
        }
        return false;
      }

      state.webcamStarted = true;
      activeGazeProviderId = providerId;
      if (providerId === 'webgazer') {
        blockWebGazerMouseTraining();
      }
      setWebcamStatus(state.webcamCalibrationTrained ? 'calibrated' : 'active');
      return true;
    } catch (error) {
      if (webcamProvider === provider) {
        provider?.stop?.();
        webcamProvider = null;
        activeGazeProviderId = null;
        state.webcamStarted = false;
        state.webcamCalibrationTrained = false;
        setNotice(`Không thể bắt đầu ánh nhìn webcam: ${error.message}`);
        setWebcamStatus('blocked');
      }
      return false;
    }
  }

  async function ensureWebcamGaze() {
    const providerId = getSelectedGazeProviderId();

    if (state.webcamStarted && activeGazeProviderId === providerId) {
      return true;
    }

    if (webcamStartPromise && webcamStartProviderId === providerId) {
      return webcamStartPromise;
    }

    if (webcamStartPromise) {
      const previousStartPromise = webcamStartPromise;
      stopWebcamProviderForSwitch();
      await previousStartPromise.catch(() => false);
    }

    const startPromise = startWebcamGazeProvider(providerId);
    webcamStartPromise = startPromise;
    webcamStartProviderId = providerId;

    try {
      return await startPromise;
    } finally {
      if (webcamStartPromise === startPromise) {
        webcamStartPromise = null;
        webcamStartProviderId = null;
      }
    }
  }

  async function setWebcamMode() {
    selectWebcamMode();
    setNotice('Đang bắt đầu ánh nhìn webcam. Trình duyệt có thể cần quyền camera và hiệu chuẩn.');

    const started = await ensureWebcamGaze();
    if (started) {
      const providerName = activeGazeProviderId === 'seeso' ? 'bộ theo dõi ánh nhìn lưu trữ' : 'WebGazer';
      const calibrationMessage = state.webcamCalibrationTrained
        ? 'Chạy xác thực độ chính xác khi cần độ chính xác webcam đáng tin cậy.'
        : 'Hãy hiệu chuẩn để dữ liệu AOI hữu dụng hơn.';
      setNotice(`Ánh nhìn webcam ${providerName} đang hoạt động. ${calibrationMessage}`, false);
    }
  }

  function targetPointsForMode() {
    return state.targetMode === 'accuracy'
      ? VALIDATION_POINTS
      : getActiveCalibrationProfile().calibrationPoints;
  }

  function positionTargetOverlay() {
    const points = targetPointsForMode();
    const index = state.targetMode === 'accuracy' ? state.accuracyIndex : state.calibrationIndex;
    const point = points[index];
    const label = state.targetMode === 'accuracy' ? 'Accuracy target' : 'Target';

    if (!point) {
      if (state.targetMode === 'calibration') {
        activeCalibrationProfile = null;
        state.calibrationProfile = null;
      } else if (state.targetMode === 'accuracy') {
        state.activeValidationPolicyId = null;
        state.validationGazeStreamStats = null;
        state.validationGazeStreamQuality = null;
      }

      calibrationOverlay.hidden = true;
      setTargetCapturing(false);
      setCalibrationProfileSelectLocked(false);
      setValidationPolicySelectLocked(false);
      setWebcamStatus(state.webcamStarted ? 'active' : 'idle');
      setNotice('Chuỗi mục tiêu đã thay đổi. Hãy bắt đầu hiệu chuẩn lại.', true);
      void restoreVideoAfterTargetMode();
      return;
    }

    const cardVerticalPosition = point.y < 50 ? 'bottom' : 'top';
    const cardHorizontalPosition = point.x < 50 ? 'right' : 'left';

    calibrationTarget.style.setProperty('--target-x', `${point.x}%`);
    calibrationTarget.style.setProperty('--target-y', `${point.y}%`);
    calibrationOverlay.dataset.cardPosition = `${cardVerticalPosition}-${cardHorizontalPosition}`;
    calibrationProgress.textContent = `${label} ${index + 1} of ${points.length}`;
    calibrationDescription.textContent = state.targetMode === 'accuracy'
      ? 'Look at the target, then click it to measure current gaze error.'
      : 'Look at the target and click once. Hold your gaze while samples are captured.';
  }

  function setTargetCapturing(isCapturing, message) {
    state.targetCaptureInProgress = isCapturing;
    calibrationTarget.disabled = isCapturing;
    calibrationTarget.classList.toggle('is-capturing', isCapturing);

    if (message) {
      calibrationDescription.textContent = message;
    }
  }

  function pauseVideoForTargetMode() {
    state.resumeVideoAfterTargetMode = !sourceVideo.paused;

    if (state.resumeVideoAfterTargetMode) {
      sourceVideo.pause();
      playVideoButton.textContent = 'Phát';
    }
  }

  async function restoreVideoAfterTargetMode() {
    const shouldResume = state.resumeVideoAfterTargetMode;
    state.resumeVideoAfterTargetMode = false;

    if (!shouldResume) {
      return;
    }

    try {
      await sourceVideo.play();
      playVideoButton.textContent = 'Tạm dừng';
    } catch (error) {
      setNotice(`Video không thể tiếp tục sau hiệu chuẩn: ${error.message}`);
    }
  }

  function getRawDiagnosticTargetPoint() {
    return RAW_GAZE_DIAGNOSTIC.targets[state.rawGazeDiagnostic.index];
  }

  function setRawDiagnosticModeActive(active) {
    viewer.classList.toggle('is-raw-diagnostic', active);
  }

  function setRawDiagnosticStatus(summary = null) {
    if (!summary) {
      rawGazeDiagnosticStatus.textContent = 'Chưa chạy chẩn đoán ánh nhìn thô.';
      return;
    }

    rawGazeDiagnosticStatus.textContent = `${summary.quality}: dao động p90 ${Math.round(summary.p90JitterPx)}px, lệch p90 ${Math.round(summary.p90BiasPx)}px, Hz ${Math.round(summary.effectiveHz)}.`;
  }

  function positionRawDiagnosticTarget() {
    const point = getRawDiagnosticTargetPoint();
    const cardVerticalPosition = point.y < 50 ? 'bottom' : 'top';
    const cardHorizontalPosition = point.x < 50 ? 'right' : 'left';

    calibrationTarget.style.setProperty('--target-x', `${point.x}%`);
    calibrationTarget.style.setProperty('--target-y', `${point.y}%`);
    calibrationOverlay.dataset.cardPosition = `${cardVerticalPosition}-${cardHorizontalPosition}`;
    calibrationProgress.textContent = `Ánh nhìn thô ${state.rawGazeDiagnostic.index + 1}/${RAW_GAZE_DIAGNOSTIC.targets.length}`;
    calibrationDescription.textContent = 'Nhìn vào mục tiêu, rồi nhấp vào nó. Thao tác này đo nhiễu ánh nhìn webcam thô trước khi ứng dụng hiệu chỉnh.';
  }

  async function startRawGazeDiagnostic() {
    stopActiveRecordingForTargetMode();
    await setWebcamMode();

    if (!state.webcamStarted) {
      return;
    }

    if (!state.webcamCalibrationTrained) {
      state.rawGazeDiagnostic = {
        active: false,
        index: 0,
        targets: [],
        latestSummary: null,
      };
      setRawDiagnosticStatus(null);
      setWebcamStatus('active');
      setNotice('Hãy hiệu chuẩn webcam trước khi chạy Chẩn đoán ánh nhìn thô. Ánh nhìn webcam cần hiệu chuẩn trước khi phát con trỏ thô dùng được.', true);
      return;
    }

    state.targetMode = 'raw-diagnostic';
    state.rawGazeDiagnostic = {
      active: true,
      index: 0,
      targets: [],
      latestSummary: null,
    };
    pauseVideoForTargetMode();
    setRawDiagnosticModeActive(true);
    setCalibrationProfileSelectLocked(true);
    setValidationPolicySelectLocked(true);
    calibrationOverlay.hidden = false;
    setWebcamStatus('diagnosing');
    setRawDiagnosticStatus(null);
    positionRawDiagnosticTarget();
  }

  async function captureRawDiagnosticPoint() {
    if (state.targetCaptureInProgress) {
      return;
    }

    setTargetCapturing(true, 'Measuring raw gaze noise. Keep looking at the target.');
    const rect = calibrationTarget.getBoundingClientRect();
    const viewerRect = viewer.getBoundingClientRect();
    const target = {
      x: rect.left + rect.width / 2 - viewerRect.left,
      y: rect.top + rect.height / 2 - viewerRect.top,
    };
    const samples = [];
    const startedAt = performance.now();

    await delay(RAW_GAZE_DIAGNOSTIC.settleDelayMs);

    for (let index = 0; index < RAW_GAZE_DIAGNOSTIC.samplesPerTarget; index += 1) {
      const rawGaze = getFreshRawViewerGaze();
      if (rawGaze) {
        samples.push({
          x: rawGaze.x,
          y: rawGaze.y,
          atMs: performance.now() - startedAt,
        });
      }
      await delay(RAW_GAZE_DIAGNOSTIC.sampleDelayMs);
    }

    if (!samples.length) {
      setTargetCapturing(false);
      setNotice('Đang chờ ánh nhìn webcam thô. Giữ khuôn mặt trong khung hình đến khi con trỏ xuất hiện, rồi nhấp lại mục tiêu.', true);
      return;
    }

    const durationMs = performance.now() - startedAt;
    state.rawGazeDiagnostic.targets.push(summarizeDiagnosticTarget({
      target,
      samples,
      durationMs,
      expectedSampleCount: RAW_GAZE_DIAGNOSTIC.samplesPerTarget,
    }));
    state.rawGazeDiagnostic.index += 1;
    setTargetCapturing(false);

    if (state.rawGazeDiagnostic.index >= RAW_GAZE_DIAGNOSTIC.targets.length) {
      const summary = summarizeRawGazeDiagnostic({
        targets: state.rawGazeDiagnostic.targets,
      });
      state.rawGazeDiagnostic.latestSummary = summary;
      state.rawGazeDiagnostic.active = false;
      calibrationOverlay.hidden = true;
      setRawDiagnosticModeActive(false);
      setCalibrationProfileSelectLocked(false);
      setValidationPolicySelectLocked(false);
      setWebcamStatus('calibrated');
      setRawDiagnosticStatus(summary);
      setNotice(summary.reason, summary.quality !== 'good');
      await restoreVideoAfterTargetMode();
      return;
    }

    positionRawDiagnosticTarget();
  }

  async function startSeeSoHostedCalibration() {
    persistSeeSoLicenseKey();

    if (!getSeeSoLicenseKey()) {
      setNotice('Thiếu khóa bộ theo dõi ánh nhìn lưu trữ trong cấu hình ứng dụng.');
      setWebcamStatus('no key');
      return;
    }

    const geometrySettings = requireSeeSoGeometrySettings();
    if (!geometrySettings) {
      return;
    }

    clearStoredSeeSoCalibrationData();
    state.webcamCalibrationTrained = false;
    clearAccuracyRefinement();
    setSessionStorageValue(SEESO_CALIBRATION_RETURN_MODE_STORAGE_KEY, state.appMode || getRequestedAppMode());
    persistParticipantDraft();
    persistParticipantSessionState();

    const redirectUrl = buildSeeSoRedirectUrl(window.location.href, {
      includeProvider: false,
      modePlacement: 'hash',
    }).toString();
    const calibrationUserId = createSeeSoCalibrationUserId();
    setNotice('Đang mở hiệu chỉnh camera. Quay lại đây sau khi hoàn tất.', false);
    try {
      const calibrationProvider = webcamProvider?.openCalibrationPage
        ? webcamProvider
        : createSeeSoProvider({
          licenseKey: getSeeSoLicenseKey(),
          monitorSizeInch: geometrySettings.monitorSizeInch,
          faceDistanceCm: geometrySettings.faceDistanceCm,
          windowRef: window,
          navigatorRef: window.navigator,
          onGaze: () => {},
        });
      await calibrationProvider.openCalibrationPage({
        redirectUrl,
        calibrationPointCount: SEESO_CALIBRATION_POINT_COUNT,
        monitorSizeInch: geometrySettings.monitorSizeInch,
        faceDistanceCm: geometrySettings.faceDistanceCm,
        userId: calibrationUserId,
      });
    } catch (error) {
      setNotice(`Không thể mở hiệu chỉnh camera: ${error.message}`);
    }
  }

  async function startCalibration() {
    stopActiveRecordingForTargetMode();

    if (isSeeSoProviderSelected()) {
      await startSeeSoHostedCalibration();
      return;
    }

    await setWebcamMode();

    if (!state.webcamStarted) {
      return;
    }

    await resetWebcamCalibrationData();
    freezeSelectedCalibrationProfileForCalibration();
    state.targetMode = 'calibration';
    state.calibrationIndex = 0;
    pauseVideoForTargetMode();
    setCalibrationProfileSelectLocked(true);
    calibrationOverlay.hidden = false;
    setWebcamStatus('calibrating');
    positionTargetOverlay();
  }

  function cancelCalibration() {
    if (state.targetMode === 'calibration') {
      activeCalibrationProfile = null;
      state.calibrationProfile = null;
    } else if (state.targetMode === 'accuracy') {
      state.activeValidationPolicyId = null;
      state.validationGazeStreamStats = null;
      state.validationGazeStreamQuality = null;
      resetFaceQualityValidationState();
    } else if (state.targetMode === 'raw-diagnostic') {
      state.rawGazeDiagnostic.active = false;
      setRawDiagnosticModeActive(false);
    }

    calibrationOverlay.hidden = true;
    setTargetCapturing(false);
    setCalibrationProfileSelectLocked(false);
    setValidationPolicySelectLocked(false);
    setWebcamStatus(state.webcamStarted ? 'active' : 'idle');
    void restoreVideoAfterTargetMode();
  }

  async function captureCalibrationPoint() {
    blockWebGazerMouseTraining();

    if (state.targetCaptureInProgress) {
      return;
    }

    if (!webcamProvider?.recordCalibrationPoint) {
      setWebcamStatus('no api');
      return;
    }

    setTargetCapturing(true, 'Capturing now. Keep looking at the target.');
    const rect = calibrationTarget.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const calibrationTargetCount = getActiveCalibrationProfile().calibrationPoints.length;
    const calibrationSamplesPerPoint = getActiveCalibrationSamplesPerPoint();

    calibrationProgress.textContent = `Target ${state.calibrationIndex + 1} of ${calibrationTargetCount} - hold steady`;
    await delay(TARGET_SETTLE_DELAY_MS);

    for (let sample = 0; sample < calibrationSamplesPerPoint; sample += 1) {
      calibrationProgress.textContent = `Target ${state.calibrationIndex + 1} of ${calibrationTargetCount} - training ${sample + 1}`;
      webcamProvider.recordCalibrationPoint({ x, y });
      await delay(TARGET_SAMPLE_DELAY_MS);
    }

    setTargetCapturing(false);
    state.calibrationIndex += 1;

    if (state.calibrationIndex >= calibrationTargetCount) {
      state.webcamCalibrationTrained = true;
      calibrationOverlay.hidden = true;
      setCalibrationProfileSelectLocked(false);
      setValidationPolicySelectLocked(false);
      setWebcamStatus('calibrated');
      setNotice('Hiệu chuẩn webcam hoàn tất. Chạy Kiểm tra độ chính xác khi cần độ chính xác webcam đáng tin cậy.', false);
      await restoreVideoAfterTargetMode();
      return;
    }

    positionTargetOverlay();
  }

  async function startAccuracyCheck() {
    stopActiveRecordingForTargetMode();
    hideValidationStatsPopup();

    if (isSeeSoProviderSelected() && !getSeeSoCalibrationData()) {
      setNotice('Hãy hiệu chỉnh camera trước khi chạy xác thực độ chính xác.', true);
      syncParticipantSessionControls();
      return;
    }

    setWebcamStatus('validating');
    await setWebcamMode();

    if (!state.webcamStarted) {
      setWebcamStatus(state.webcamCalibrationTrained ? 'calibrated' : 'idle');
      return;
    }

    const validationPolicy = freezeSelectedValidationPolicyForAccuracy();

    state.targetMode = 'accuracy';
    state.accuracyIndex = 0;
    state.accuracySamples = [];
    state.validationSamples = [];
    state.accuracyTargetRejectCounts = [];
    state.accuracyValidated = false;
    state.accuracyValidatedAt = null;
    state.accuracyInvalidationReason = null;
    state.validationPolicyId = null;
    state.policyPassed = null;
    state.policyFailures = [];
    state.validationGazeStreamStats = null;
    state.validationGazeStreamQuality = null;
    resetLiveGazeQuality();
    resetFaceQualityValidationState();
    state.refinementAccuracySummary = null;
    state.accuracySummary = null;
    state.correctedAccuracySummary = null;
    state.localAccuracyErrorModel = null;
    pauseVideoForTargetMode();
    setCalibrationProfileSelectLocked(true);
    setValidationPolicySelectLocked(true);
    calibrationOverlay.hidden = false;
    setAccuracySummary(null);
    state.activeValidationPolicyId = validationPolicy.id;
    positionTargetOverlay();
  }

  async function abortAccuracyCheckForUnstableTarget(targetSampleSummary, rejection) {
    clearAccuracyRefinement();
    const validationPolicy = getValidationPolicy(state.activeValidationPolicyId);
    const summary = {
      quality: 'untested',
      reason: targetSampleSummary.reason,
      count: targetSampleSummary.count ?? 0,
      meanPx: null,
      medianPx: null,
      p90Px: null,
      maxPx: null,
      p90DispersionPx: targetSampleSummary.dispersionPx ?? null,
      maxDispersionPx: targetSampleSummary.dispersionPx ?? null,
    };
    const evaluation = {
      validationPassed: false,
      reason: targetSampleSummary.reason === 'unstable'
        ? 'unstable-target-aborted'
        : 'too-few-samples-aborted',
      validationPolicyId: validationPolicy.id,
      policyPassed: false,
      policyFailures: [{
        metric: 'validation',
        actual: targetSampleSummary.reason,
        limit: 'stable-target',
        comparator: '==',
      }],
      accuracySummary: summary,
    };
    state.gazeCorrection = null;
    state.refinementAccuracySummary = null;
    state.accuracySummary = summary;
    state.correctedAccuracySummary = null;
    state.localAccuracyErrorModel = null;
    state.accuracyValidated = false;
    state.accuracyValidatedAt = null;
    state.validationGazeStreamQuality = getCurrentValidationGazeStreamQuality();
    applyAccuracyPolicyState(evaluation);
    state.activeValidationPolicyId = null;
    calibrationOverlay.hidden = true;
    setCalibrationProfileSelectLocked(false);
    setValidationPolicySelectLocked(false);
    setWebcamStatus('calibrated');
    const reason = targetSampleSummary.reason === 'unstable'
      ? `Accuracy check stopped because target ${state.accuracyIndex + 1} stayed unstable after ${rejection.attempts} attempts.`
      : `Accuracy check stopped because target ${state.accuracyIndex + 1} did not produce enough fresh gaze samples after ${rejection.attempts} attempts.`;
    setAccuracySummary(evaluation.accuracySummary);
    showValidationStatsPopup(evaluation, evaluation.accuracySummary);
    await submitValidationTestResult(evaluation, evaluation.accuracySummary);
    setNotice(`${reason} Hãy hiệu chuẩn lại hoặc cải thiện độ ổn định bộ theo dõi để có độ chính xác webcam đáng tin cậy.`, true);
    await restoreVideoAfterTargetMode();
  }

  async function captureAccuracyPoint() {
    blockWebGazerMouseTraining();

    if (state.targetCaptureInProgress) {
      return;
    }

    setTargetCapturing(true, 'Measuring gaze error. Keep looking at the target.');
    const rect = calibrationTarget.getBoundingClientRect();
    const viewerRect = viewer.getBoundingClientRect();
    const viewport = {
      width: viewerRect.width,
      height: viewerRect.height,
    };
    const target = {
      x: rect.left + rect.width / 2 - viewerRect.left,
      y: rect.top + rect.height / 2 - viewerRect.top,
    };
    const rawBoundsMargin = Math.max(viewport.width, viewport.height) * RAW_GAZE_BOUNDS_MARGIN_RATIO;
    const gazeSamples = [];

    calibrationProgress.textContent = `Accuracy target ${state.accuracyIndex + 1} of ${VALIDATION_POINTS.length} - hold steady`;
    await delay(TARGET_SETTLE_DELAY_MS);

    const captureStartedAt = performance.now();
    let sampleSlots = 0;
    while (shouldContinueTargetSampleCapture({
      sampleSlots,
      acceptedSamples: gazeSamples.length,
      nominalSampleSlots: VALIDATION_SAMPLES_PER_POINT,
      minAcceptedSamples: MIN_VALIDATION_SAMPLES_PER_TARGET,
      elapsedMs: performance.now() - captureStartedAt,
      maxDurationMs: VALIDATION_CAPTURE_MAX_DURATION_MS,
    })) {
      if (shouldCaptureFreshGazeSample({
        gaze: state.rawViewerGaze,
        capturedAt: state.rawGazeAt,
        now: performance.now(),
        maxAgeMs: FRESH_GAZE_MAX_AGE_MS,
        viewport,
        boundsMarginPx: rawBoundsMargin,
      })) {
        gazeSamples.push({ x: state.rawViewerGaze.x, y: state.rawViewerGaze.y });
      }
      sampleSlots += 1;
      calibrationProgress.textContent = `Accuracy target ${state.accuracyIndex + 1} of ${VALIDATION_POINTS.length} - sample ${sampleSlots}`;
      await delay(TARGET_SAMPLE_DELAY_MS);
    }

    setTargetCapturing(false);

    const targetSampleSummary = summarizeTargetSamples(gazeSamples, {
      minSamples: MIN_VALIDATION_SAMPLES_PER_TARGET,
      maxDispersionPx: TARGET_MAX_DISPERSION_PX,
    });

    if (!targetSampleSummary.accepted) {
      const rejection = recordTargetCaptureRejection(
        state.accuracyTargetRejectCounts[state.accuracyIndex],
        { maxAttempts: VALIDATION_MAX_ATTEMPTS_PER_TARGET },
      );
      state.accuracyTargetRejectCounts[state.accuracyIndex] = rejection.attempts;

      if (rejection.shouldAbort) {
        await abortAccuracyCheckForUnstableTarget(targetSampleSummary, rejection);
        return;
      }

      positionTargetOverlay();
      const retryMessage = rejection.remainingAttempts === 1
        ? 'One retry left for this target.'
        : `${rejection.remainingAttempts} retries left for this target.`;
      calibrationDescription.textContent = targetSampleSummary.reason === 'unstable'
        ? `Gaze was too unstable. ${retryMessage}`
        : `Not enough fresh webcam gaze samples. ${retryMessage}`;
      return;
    }

    const sampleResult = {
      target,
      gaze: targetSampleSummary.gaze,
          sampleCount: targetSampleSummary.count,
          dispersionPx: targetSampleSummary.dispersionPx,
          errorPx: distanceBetweenPoints(target, targetSampleSummary.gaze),
          viewport,
        };

    if (state.accuracyIndex < ACCURACY_REFINEMENT_POINTS.length) {
      state.accuracySamples.push(sampleResult);
    } else {
      state.validationSamples.push(sampleResult);
    }

    state.accuracyIndex += 1;

    if (state.accuracyIndex >= VALIDATION_POINTS.length) {
      const validationGazeStreamQuality = getCurrentValidationGazeStreamQuality();
      const evaluation = evaluateAccuracyCheck({
        refinementSamples: state.accuracySamples,
        validationSamples: state.validationSamples,
        minAcceptedRefinementTargets: MIN_ACCEPTED_REFINEMENT_TARGETS,
        minAcceptedValidationTargets: MIN_ACCEPTED_VALIDATION_TARGETS,
        policy: getValidationPolicy(state.activeValidationPolicyId),
        streamQuality: validationGazeStreamQuality,
      });
      state.validationGazeStreamQuality = validationGazeStreamQuality;
      applyAccuracyPolicyState(evaluation);
      state.activeValidationPolicyId = null;

      if (evaluation.reason === 'too-few-targets') {
        state.gazeCorrection = null;
        state.refinementAccuracySummary = null;
        state.accuracySummary = evaluation.accuracySummary;
        state.correctedAccuracySummary = null;
        state.localAccuracyErrorModel = null;
        state.accuracyValidated = false;
        state.accuracyValidatedAt = null;
        calibrationOverlay.hidden = true;
        setCalibrationProfileSelectLocked(false);
        setValidationPolicySelectLocked(false);
        setWebcamStatus('calibrated');
        setAccuracySummary(evaluation.accuracySummary);
        showValidationStatsPopup(evaluation, evaluation.accuracySummary);
        await submitValidationTestResult(evaluation, evaluation.accuracySummary);
        setNotice('Kiểm tra độ chính xác không thu thập đủ dự đoán ánh nhìn mới và ổn định. Giữ khuôn mặt cố định, rồi chạy lại Kiểm tra độ chính xác.', true);
        await restoreVideoAfterTargetMode();
        return;
      }

      if (evaluation.reason === 'insufficient-coverage') {
        state.gazeCorrection = null;
        state.refinementAccuracySummary = null;
        state.accuracySummary = evaluation.accuracySummary;
        state.correctedAccuracySummary = null;
        state.localAccuracyErrorModel = null;
        state.accuracyValidated = false;
        state.accuracyValidatedAt = null;
        calibrationOverlay.hidden = true;
        setCalibrationProfileSelectLocked(false);
        setValidationPolicySelectLocked(false);
        setWebcamStatus('calibrated');
        setAccuracySummary(evaluation.accuracySummary);
        showValidationStatsPopup(evaluation, evaluation.accuracySummary);
        await submitValidationTestResult(evaluation, evaluation.accuracySummary);
        setNotice('Kiểm tra độ chính xác chưa bao phủ đủ trình phát. Giữ khuôn mặt cố định và thử lại tất cả mục tiêu để khôi phục độ chính xác webcam đáng tin cậy.', true);
        await restoreVideoAfterTargetMode();
        return;
      }

      const correctedValidationSummary = evaluation.correctedValidationSummary;

      state.gazeCorrection = evaluation.validationPassed ? evaluation.liveCalibration : null;
      resetLiveGazeFilterState();
      state.refinementAccuracySummary = evaluation.refinement.correctedSummary;
      state.accuracySummary = evaluation.validationSummary;
      state.correctedAccuracySummary = correctedValidationSummary;
      state.localAccuracyErrorModel = evaluation.localAccuracyErrorModel;
      state.accuracyValidated = evaluation.validationPassed;
      state.accuracyValidatedAt = evaluation.validationPassed ? performance.now() : null;
      state.accuracyInvalidationReason = null;
      if (evaluation.validationPassed) {
        captureFaceQualityBaseline();
      } else {
        resetFaceQualityValidationState();
      }
      resetLiveGazeQuality();
      calibrationOverlay.hidden = true;
      setCalibrationProfileSelectLocked(false);
      setValidationPolicySelectLocked(false);
      setWebcamStatus('calibrated');
      setAccuracySummary(correctedValidationSummary);
      showValidationStatsPopup(evaluation, correctedValidationSummary);
      await submitValidationTestResult(evaluation, correctedValidationSummary);
      if (correctedValidationSummary.quality === 'untested') {
        setNotice('Kiểm tra độ chính xác không thu thập được dự đoán ánh nhìn. Hãy hiệu chuẩn lại và giữ khuôn mặt ổn định trong khung hình.', true);
      } else {
        setNotice(
          evaluation.validationPassed
            ? `Accuracy validated independently: mean ${Math.round(correctedValidationSummary.meanPx)}px, p90 ${Math.round(correctedValidationSummary.p90Px || 0)}px, capture p90 ${Math.round(correctedValidationSummary.p90DispersionPx || 0)}px, worst target ${Math.round(correctedValidationSummary.maxPx || 0)}px.`
            : evaluation.reason === 'failed-validation-policy'
              ? formatPolicyFailureNotice(evaluation)
            : `Xác thực độ chính xác là ${correctedValidationSummary.quality}, lỗi trung bình ${Math.round(correctedValidationSummary.meanPx)}px, p90 khi thu ${Math.round(correctedValidationSummary.p90DispersionPx || 0)}px, mục tiêu tệ nhất ${Math.round(correctedValidationSummary.maxPx || 0)}px. Hãy hiệu chuẩn lại để khôi phục độ chính xác webcam đáng tin cậy.`,
          true,
        );
      }
      await restoreVideoAfterTargetMode();
      return;
    }

    positionTargetOverlay();
  }

  async function handleTargetClick() {
    if (state.targetMode === 'raw-diagnostic') {
      await captureRawDiagnosticPoint();
      return;
    }

    if (state.targetMode === 'accuracy') {
      await captureAccuracyPoint();
      return;
    }

    await captureCalibrationPoint();
  }

  function clampGazeToViewer(gaze) {
    const rect = viewer.getBoundingClientRect();
    const inside = gaze.x >= 0 && gaze.y >= 0 && gaze.x <= rect.width && gaze.y <= rect.height;

    if (!inside) {
      return { ...gaze, visible: false };
    }

    return gaze;
  }

  function getFreshRawViewerGaze(now = performance.now()) {
    return getRecentRawViewerGaze(now, FRESH_GAZE_MAX_AGE_MS);
  }

  function getRecentRawViewerGaze(now = performance.now(), maxAgeMs = FRESH_GAZE_MAX_AGE_MS) {
    if (
      Number.isFinite(state.rawViewerGaze?.x) &&
      Number.isFinite(state.rawViewerGaze?.y) &&
      state.rawGazeAt > 0 &&
      now - state.rawGazeAt <= maxAgeMs
    ) {
      return state.rawViewerGaze;
    }

    return null;
  }

  function renderRawDiagnosticCursor(now = performance.now()) {
    const rawGaze = getRecentRawViewerGaze(now, RAW_GAZE_DIAGNOSTIC.cursorHoldMs);

    if (!rawGaze) {
      screenReadout.textContent = 'đang chờ ánh nhìn webcam thô';
      panoramaReadout.textContent = '--';
      hitReadout.textContent = 'không có';
      gazeDot.style.transform = 'translate(-100px, -100px)';
      state.latestPoint = null;
      state.latestHits = [];
      state.latestAois = [];
      state.latestAoiClassification = null;
      state.latestUncertainty = null;
      return;
    }

    const gaze = clampGazeToViewer(rawGaze);
    if (!gaze.visible) {
      screenReadout.textContent = 'ánh nhìn webcam thô ngoài trình xem';
      panoramaReadout.textContent = '--';
      hitReadout.textContent = 'không có';
      gazeDot.style.transform = 'translate(-100px, -100px)';
      return;
    }

    gazeDot.style.transform = `translate(${gaze.x}px, ${gaze.y}px)`;
    screenReadout.textContent = `thô x ${Math.round(gaze.x)}, y ${Math.round(gaze.y)}`;
    panoramaReadout.textContent = '--';
    hitReadout.textContent = 'không có';
  }

  function clampToViewer(value, max) {
    return Math.min(max, Math.max(0, value));
  }

  function clampReviewScreen(screen, rect) {
    const maxX = Math.max(REVIEW_GAZE_EDGE_PADDING_PX, rect.width - REVIEW_GAZE_EDGE_PADDING_PX);
    const maxY = Math.max(REVIEW_GAZE_EDGE_PADDING_PX, rect.height - REVIEW_GAZE_EDGE_PADDING_PX);

    return {
      ...screen,
      x: Math.min(maxX, Math.max(REVIEW_GAZE_EDGE_PADDING_PX, screen.x)),
      y: Math.min(maxY, Math.max(REVIEW_GAZE_EDGE_PADDING_PX, screen.y)),
      visible: true,
    };
  }

  function syncReviewPlaybackWindow() {
    if (!state.reviewActive || !Number.isFinite(sourceVideo.currentTime)) {
      return;
    }

    const window = getReviewTimeWindow(state.reviewSamples);
    if (!window) {
      return;
    }

    const beforeStart = sourceVideo.currentTime < window.start - REVIEW_LOOP_GRACE_SEC;
    const pastEnd = sourceVideo.currentTime > window.end + REVIEW_LOOP_GRACE_SEC;

    if (beforeStart || pastEnd) {
      sourceVideo.currentTime = window.start;
    }
  }

  function getFallbackReviewScreen(sample, rect) {
    if (Number.isFinite(sample?.screen?.x) && Number.isFinite(sample?.screen?.y)) {
      return clampReviewScreen({
        x: clampToViewer(sample.screen.x, rect.width),
        y: clampToViewer(sample.screen.y, rect.height),
        visible: true,
      }, rect);
    }

    return clampReviewScreen({
      x: rect.width / 2,
      y: rect.height / 2,
      visible: true,
    }, rect);
  }

  function getCurrentReviewPanoramaPoint() {
    const rect = viewer.getBoundingClientRect();
    const sampleIndex = findReviewSampleIndex(state.reviewSamples, sourceVideo.currentTime || 0);

    if (sampleIndex < 0) {
      return null;
    }

    const sample = state.reviewSamples[sampleIndex];
    state.reviewIndex = sampleIndex;

    if (Number.isFinite(sample.camera?.yaw)) {
      state.cameraYaw = sample.camera.yaw;
    }

    if (Number.isFinite(sample.camera?.pitch)) {
      state.cameraPitch = sample.camera.pitch;
    }

    if (Number.isFinite(sample.camera?.fov) && sample.camera.fov > 0) {
      camera.fov = sample.camera.fov;
      camera.updateProjectionMatrix();
    }

    updateCamera();

    const projected = panoramaPointToScreen({
      yaw: sample.panorama.yaw,
      pitch: sample.panorama.pitch,
      width: rect.width,
      height: rect.height,
      cameraYaw: state.cameraYaw,
      cameraPitch: state.cameraPitch,
      fov: camera.fov,
    });
    const screen = clampReviewScreen(projected.visible
      ? projected
      : getFallbackReviewScreen(sample, rect), rect);

    state.gaze = {
      x: screen.x,
      y: screen.y,
      visible: screen.visible,
      source: 'review',
    };

    const viewport = {
      width: rect.width,
      height: rect.height,
    };
    const videoPoint = Number.isFinite(sample?.videoPoint?.x) && Number.isFinite(sample?.videoPoint?.y)
      ? sample.videoPoint
      : screenPointToVideoPoint({
        x: screen.x,
        y: screen.y,
        width: rect.width,
        height: rect.height,
      });

    return {
      gaze: state.gaze,
      timeSec: sample.t,
      aois: Array.isArray(sample.activeAois) && sample.activeAois.length
        ? withEffectiveAoisAnalysisPadding(sample.activeAois, viewport)
        : resolveAoisForAnalysis(activeAois, sample.t, viewport),
      viewport,
      point: sample.panorama,
      videoPoint,
    };
  }

  function getCurrentPanoramaPoint({ useOverlayAois = false } = {}) {
    if (state.reviewActive) {
      return getCurrentReviewPanoramaPoint();
    }

    const rect = viewer.getBoundingClientRect();
    const now = performance.now();
    const webcamGazeIsStale = (
      state.mode === 'webcam' &&
      state.rawGazeAt > 0 &&
      now - state.rawGazeAt > LIVE_GAZE_STALE_MS
    );

    if (webcamGazeIsStale) {
      if (canHoldLastWebcamGaze(now)) {
        registerBoundedGazeStreamDrop({ atMs: now, reason: 'stale-held' });
        holdLastWebcamGaze('stale');
      } else {
        registerBoundedGazeStreamDrop({ atMs: now, reason: 'stale' });
        state.gaze = { ...state.gaze, visible: false, held: false };
        state.gazeDropReason = 'stale';
        registerLiveGazeQualityEvent({ accepted: false, reason: 'stale' });
        return null;
      }
    }

    if (state.gaze.held && !canHoldLastWebcamGaze(now)) {
      registerBoundedGazeStreamDrop({ atMs: now, reason: 'stale' });
      state.gaze = { ...state.gaze, visible: false };
      state.gazeDropReason = 'stale';
      registerLiveGazeQualityEvent({ accepted: false, reason: 'stale' });
      return null;
    }

    if (!state.gaze.visible && state.mode === 'webcam') {
      return null;
    }

    const gaze = clampGazeToViewer(state.gaze.visible ? state.gaze : {
      x: rect.width / 2,
      y: rect.height / 2,
      visible: true,
      source: state.mode,
    });

    if (!gaze.visible) {
      return null;
    }

    const timeSec = sourceVideo.currentTime || 0;
    const projection = getCurrentProjection();
    const videoRect = getCurrentVideoRect(rect);
    const videoPoint = projection === 'flat'
      ? screenPointToContainedVideoPoint(gaze, videoRect)
      : screenPointToVideoPoint({
        x: gaze.x,
        y: gaze.y,
        width: rect.width,
        height: rect.height,
      });
    const analysisDimensions = projection === 'flat'
      ? { width: videoRect.width, height: videoRect.height }
      : { width: rect.width, height: rect.height };

    return {
      gaze,
      timeSec,
      aois: useOverlayAois
        ? resolveOverlayAoisAtTime(activeAois, timeSec)
        : resolveAoisForAnalysis(activeAois, timeSec, analysisDimensions),
      viewport: analysisDimensions,
      point: screenPointToYawPitch({
        x: gaze.x,
        y: gaze.y,
        width: rect.width,
        height: rect.height,
        cameraYaw: state.cameraYaw,
        cameraPitch: state.cameraPitch,
        fov: camera.fov,
      }),
      videoPoint,
    };
  }

  function classifyVideoAois(point, aois, viewport) {
    if (!point) {
      return {
        exactHits: [],
        likelyHits: [],
        possibleHits: [],
        ambiguousHits: [],
        uncertainty: { yawRadius: 0, pitchRadius: 0 },
      };
    }

    const exactHits = hitTestAois(point, aois, viewport);

    return {
      exactHits,
      likelyHits: exactHits,
      possibleHits: exactHits,
      ambiguousHits: [],
      uncertainty: { yawRadius: 0, pitchRadius: 0 },
    };
  }

  function formatAoiReadout(classification) {
    if (!classification) {
      return 'none';
    }

    if (classification.likelyHits.length) {
      return classification.likelyHits.map((hit) => hit.label).join(', ');
    }

    if (classification.exactHits.length) {
      return `ambiguous ${classification.exactHits.map((hit) => hit.label).join(', ')}`;
    }

    if (classification.possibleHits.length) {
      return `possible ${classification.possibleHits.map((hit) => hit.label).join(', ')}`;
    }

    return 'none';
  }

  function getCurrentRawDiagnosticQuality() {
    return state.rawGazeDiagnostic.latestSummary?.quality || 'good';
  }

  function updateCurrentAoiStability(classification, now = performance.now()) {
    const dtMs = state.lastAoiStabilityAt > 0 ? now - state.lastAoiStabilityAt : RECORDING_SAMPLE_INTERVAL_MS;
    state.lastAoiStabilityAt = now;
    state.aoiStability = updateAoiStability(state.aoiStability || createAoiStabilityState(), {
      classification,
      dtMs,
      uncertaintyPx: state.latestUncertainty?.px || 0,
      rawQuality: getCurrentRawDiagnosticQuality(),
    });
  }

  function updateGazeQualityReadout() {
    const rawDiagnostic = state.rawGazeDiagnostic.latestSummary;
    const held = state.gaze.held ? 'held' : 'live';
    const drop = state.gazeDropReason || 'ok';
    gazeQualityReadout.textContent = rawDiagnostic
      ? `${rawDiagnostic.quality}, ${held}, ${drop}, p90 jitter ${Math.round(rawDiagnostic.p90JitterPx)}px`
      : `${held}, ${drop}`;
  }

  function updateReadout({ skipAoiClassification = false } = {}) {
    cameraReadout.textContent = `yaw ${formatDegrees(state.cameraYaw)}, pitch ${formatDegrees(state.cameraPitch)}`;
    updateGazeQualityReadout();

    if (state.targetMode === 'raw-diagnostic' && !calibrationOverlay.hidden) {
      renderRawDiagnosticCursor();
      return;
    }

    if (skipAoiClassification) {
      return;
    }

    const current = getCurrentPanoramaPoint({ useOverlayAois: !state.isRecording });

    if (!current) {
      screenReadout.textContent = state.mode === 'webcam' && state.gazeDropReason === 'out-of-bounds'
        ? 'webcam gaze outside viewer'
        : state.mode === 'webcam' && state.gazeDropReason === 'raw-out-of-bounds'
          ? 'webcam face/gaze lost'
          : state.mode === 'webcam' && state.gazeDropReason === 'stale'
            ? 'webcam gaze stale'
            : state.mode === 'webcam' ? 'waiting for webcam gaze' : 'outside viewer';
      panoramaReadout.textContent = '--';
      hitReadout.textContent = 'không có';
      gazeDot.style.transform = 'translate(-100px, -100px)';
      state.latestPoint = null;
      state.latestHits = [];
      state.latestAois = [];
      state.latestAoiClassification = null;
      state.latestUncertainty = null;
      return;
    }

    const uncertaintyPx = getCurrentUncertaintyPx(current.gaze);
    const angularUncertainty = uncertaintyPx > 0
      ? screenUncertaintyToYawPitch({
        x: current.gaze.x,
        y: current.gaze.y,
        width: current.viewport.width,
        height: current.viewport.height,
        cameraYaw: state.cameraYaw,
        cameraPitch: state.cameraPitch,
        fov: camera.fov,
        radiusPx: uncertaintyPx,
      })
      : { yawRadius: 0, pitchRadius: 0 };
    const isFlatVideo = getCurrentProjection() === 'flat';
    const classification = isFlatVideo
      ? classifyVideoAois(current.videoPoint, current.aois, current.viewport)
      : classifyAoisWithUncertainty(current.point, current.aois, {
        ...angularUncertainty,
        viewport: current.viewport,
      });

    state.latestPoint = current.point;
    state.latestHits = classification.exactHits;
    state.latestAois = current.aois;
    state.latestAoiClassification = classification;
    state.latestUncertainty = {
      px: uncertaintyPx,
      ...angularUncertainty,
    };
    updateCurrentAoiStability(classification);

    gazeDot.style.transform = `translate(${current.gaze.x}px, ${current.gaze.y}px)`;
    screenReadout.textContent = `x ${Math.round(current.gaze.x)}, y ${Math.round(current.gaze.y)}`;
    panoramaReadout.textContent = isFlatVideo
      ? current.videoPoint
        ? `video x ${current.videoPoint.x.toFixed(3)}, y ${current.videoPoint.y.toFixed(3)}`
        : 'outside video frame'
      : `yaw ${formatDegrees(current.point.yaw)}, pitch ${formatDegrees(current.point.pitch)}`;
    hitReadout.textContent = formatAoiReadout(classification);
  }

  function drawYawRange(ctx, canvasWidth, canvasHeight, aoi) {
    const yawToX = (yaw) => ((normalizeYaw(yaw) + 180) / 360) * canvasWidth;
    const pitchToY = (pitch) => ((90 - pitch) / 180) * canvasHeight;
    const y = pitchToY(aoi.pitchMax);
    const height = pitchToY(aoi.pitchMin) - y;

    if (aoi.yawMin <= aoi.yawMax) {
      const x = yawToX(aoi.yawMin);
      ctx.fillRect(x, y, yawToX(aoi.yawMax) - x, height);
      ctx.strokeRect(x, y, yawToX(aoi.yawMax) - x, height);
      return;
    }

    const leftX = yawToX(aoi.yawMin);
    ctx.fillRect(leftX, y, canvasWidth - leftX, height);
    ctx.strokeRect(leftX, y, canvasWidth - leftX, height);
    ctx.fillRect(0, y, yawToX(aoi.yawMax), height);
    ctx.strokeRect(0, y, yawToX(aoi.yawMax), height);
  }

  function drawVideoRange(ctx, canvasWidth, canvasHeight, aoi) {
    const x = Math.min(aoi.xMin, aoi.xMax) * canvasWidth;
    const y = Math.min(aoi.yMin, aoi.yMax) * canvasHeight;
    const width = Math.abs(aoi.xMax - aoi.xMin) * canvasWidth;
    const height = Math.abs(aoi.yMax - aoi.yMin) * canvasHeight;

    ctx.fillRect(x, y, width, height);
    ctx.strokeRect(x, y, width, height);
  }

  function drawMiniMapPolygon(ctx, points) {
    const finitePoints = points.filter((point) => (
      Number.isFinite(point?.x) &&
      Number.isFinite(point?.y)
    ));

    if (finitePoints.length < 3) {
      return;
    }

    ctx.beginPath();
    finitePoints.forEach((point, index) => {
      if (index === 0) {
        ctx.moveTo(point.x, point.y);
        return;
      }

      ctx.lineTo(point.x, point.y);
    });
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  function drawVideoPolygonMiniMap(ctx, canvasWidth, canvasHeight, aoi) {
    const points = Array.isArray(aoi.points)
      ? aoi.points.map((point) => ({
        x: point.x * canvasWidth,
        y: point.y * canvasHeight,
      }))
      : [];

    drawMiniMapPolygon(ctx, points);
  }

  function drawPanoramaPolygonMiniMap(ctx, canvasWidth, canvasHeight, aoi) {
    const sourcePoints = Array.isArray(aoi.points)
      ? aoi.points.filter((point) => (
        Number.isFinite(point?.yaw) &&
        Number.isFinite(point?.pitch)
      ))
      : [];

    if (sourcePoints.length < 3) {
      return;
    }

    let previousYaw = normalizeYaw(sourcePoints[0].yaw);
    const points = sourcePoints.map((point, index) => {
      let yaw = normalizeYaw(point.yaw);

      if (index > 0) {
        while (yaw - previousYaw > 180) {
          yaw -= 360;
        }

        while (yaw - previousYaw < -180) {
          yaw += 360;
        }
      }

      previousYaw = yaw;

      return {
        x: ((yaw + 180) / 360) * canvasWidth,
        y: ((90 - point.pitch) / 180) * canvasHeight,
      };
    });
    const xs = points.map((point) => point.x);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minShift = Math.floor((0 - maxX) / canvasWidth);
    const maxShift = Math.ceil((canvasWidth - minX) / canvasWidth);

    for (let shiftIndex = minShift; shiftIndex <= maxShift; shiftIndex += 1) {
      const shiftX = shiftIndex * canvasWidth;
      const shiftedPoints = points.map((point) => ({
        ...point,
        x: point.x + shiftX,
      }));

      if (
        Math.max(...shiftedPoints.map((point) => point.x)) >= 0 &&
        Math.min(...shiftedPoints.map((point) => point.x)) <= canvasWidth
      ) {
        drawMiniMapPolygon(ctx, shiftedPoints);
      }
    }
  }

  function buildMiniMapSignature(width, height) {
    const dynamicTimeBucket = activeAois.some((aoi) => (
      Array.isArray(aoi.keyframes) && aoi.keyframes.length
    ))
      ? Math.round((sourceVideo.currentTime || 0) * 10)
      : 0;

    return [
      aoiOverlayVersion,
      width,
      height,
      getCurrentProjection(),
      dynamicTimeBucket,
      state.latestPoint ? Math.round(state.latestPoint.yaw * 10) : '',
      state.latestPoint ? Math.round(state.latestPoint.pitch * 10) : '',
    ].join('|');
  }

  function drawMiniMap({ nowMs = performance.now(), force = true } = {}) {
    const ctx = miniMap.getContext('2d');
    const width = miniMap.width;
    const height = miniMap.height;
    const signature = buildMiniMapSignature(width, height);

    if (!miniMapRedrawGate.shouldRedraw({ signature, nowMs, force })) {
      return;
    }

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#0b0d0a';
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = 'rgba(247, 242, 232, 0.16)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= width; x += width / 12) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (let y = 0; y <= height; y += height / 6) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    getOverlayRenderableAois().forEach((aoi) => {
      ctx.fillStyle = `${aoi.color}33`;
      ctx.strokeStyle = aoi.color;
      ctx.lineWidth = 2;
      if (aoi.shape === 'polygon' && aoi.space === 'video') {
        drawVideoPolygonMiniMap(ctx, width, height, aoi);
      } else if (aoi.shape === 'polygon') {
        drawPanoramaPolygonMiniMap(ctx, width, height, aoi);
      } else if (aoi.space === 'video') {
        drawVideoRange(ctx, width, height, aoi);
      } else {
        drawYawRange(ctx, width, height, aoi);
      }
    });

    if (state.latestPoint) {
      const x = ((state.latestPoint.yaw + 180) / 360) * width;
      const y = ((90 - state.latestPoint.pitch) / 180) * height;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#0a0b09';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  function maybeSample(now) {
    if (state.reviewActive || !calibrationOverlay.hidden) {
      return;
    }

    if (!state.isRecording || !state.latestPoint) {
      return;
    }

    const sampleDecision = shouldRecordSample(recordingSampleScheduler, now, state.gaze);
    if (!sampleDecision.record) {
      return;
    }

    const trustedForAoiAnalysis = state.appMode === 'participant' || state.mode !== 'webcam' || state.accuracyValidated;

    state.samples.push(buildRecordingSample({
      timeSec: sourceVideo.currentTime,
      source: state.mode,
      quality: {
        trustedForAoiAnalysis,
        webcamAccuracyValidated: state.mode === 'webcam' && state.accuracyValidated,
        accuracyMeanPx: state.correctedAccuracySummary?.meanPx ?? null,
        accuracyMedianPx: state.correctedAccuracySummary?.medianPx ?? null,
        accuracyP90Px: state.correctedAccuracySummary?.p90Px ?? null,
        accuracyMaxPx: state.correctedAccuracySummary?.maxPx ?? null,
        accuracyP90DispersionPx: state.correctedAccuracySummary?.p90DispersionPx ?? null,
        accuracyMaxDispersionPx: state.correctedAccuracySummary?.maxDispersionPx ?? null,
        accuracyInvalidationReason: state.accuracyInvalidationReason,
        validationPolicyId: state.validationPolicyId,
        policyPassed: state.policyPassed,
        policyFailures: state.policyFailures,
        droppedGazeSamples: state.droppedGazeSamples,
        faceQualityAvailable: state.faceQualityAvailable,
        faceQualityUnavailableReason: state.faceQualityUnavailableReason,
      },
      gazeStreamQuality: getCurrentGazeStreamQuality(),
      gaze: state.gaze,
      rawGaze: state.rawViewerGaze,
      camera: {
        yaw: state.cameraYaw,
        pitch: state.cameraPitch,
        fov: camera.fov,
      },
      panorama: state.latestPoint,
      hits: state.latestHits,
      stableHits: state.aoiStability.stableHits,
      activeAois: state.latestAois,
      classification: state.latestAoiClassification,
      aoiStability: state.aoiStability,
      uncertainty: state.latestUncertainty,
    }));
    sampleCount.textContent = String(state.samples.length);
  }

  function animate(now = 0) {
    invalidateExpiredAccuracy(now);
    syncReviewPlaybackWindow();
    syncProjectionMesh();
    updateCamera();
    const isDraggingCamera = viewer.classList.contains('is-dragging');
    updateReadout({
      skipAoiClassification: isDraggingCamera && !state.isRecording,
    });
    if (isDraggingCamera) {
      drawAoiOverlay({
        nowMs: now,
        force: false,
        dragMode: true,
        minRedrawIntervalMs: 100,
      });
    } else {
      drawAoiOverlay({ nowMs: now, force: false });
      drawMiniMap({ nowMs: now, force: false });
    }
    maybeSample(now);
    enforceParticipantRecordingLimit();
    renderer.render(scene, camera);
    requestAnimationFrame(animate);
  }

  function startDrag(event) {
    if (calibrationOverlay.contains(event.target)) {
      return;
    }

    if (state.manualAnnotation.mode === 'drawing' || event.target.closest?.('.aoi-vertex-handle')) {
      return;
    }

    if (!shouldAllowCameraDrag(getCurrentProjection())) {
      return;
    }

    viewer.classList.add('is-dragging');
    drawAoiOverlay({ force: true, dragMode: true });
    viewer.setPointerCapture(event.pointerId);
    viewer.dataset.lastX = String(event.clientX);
    viewer.dataset.lastY = String(event.clientY);
  }

  function drag(event) {
    if (!viewer.classList.contains('is-dragging')) {
      return;
    }

    const lastX = Number(viewer.dataset.lastX);
    const lastY = Number(viewer.dataset.lastY);
    const dx = event.clientX - lastX;
    const dy = event.clientY - lastY;

    if (!shouldAllowCameraDrag(getCurrentProjection())) {
      viewer.dataset.lastX = String(event.clientX);
      viewer.dataset.lastY = String(event.clientY);
      return;
    }

    const nextCamera = getNextCameraFromDrag({
      cameraYaw: state.cameraYaw,
      cameraPitch: state.cameraPitch,
      dx,
      dy,
    });
    state.cameraYaw = nextCamera.cameraYaw;
    state.cameraPitch = nextCamera.cameraPitch;
    viewer.dataset.lastX = String(event.clientX);
    viewer.dataset.lastY = String(event.clientY);
    updateCamera();
  }

  function endDrag(event) {
    viewer.classList.remove('is-dragging');
    if (viewer.hasPointerCapture(event.pointerId)) {
      viewer.releasePointerCapture(event.pointerId);
    }
    updateReadout();
    drawAoiOverlay();
    drawMiniMap();
  }

  async function toggleVideoPlayback() {
    try {
      if (sourceVideo.paused) {
        await sourceVideo.play();
        playVideoButton.textContent = 'Tạm dừng';
        setNotice('', false);
      } else {
        sourceVideo.pause();
        playVideoButton.textContent = 'Phát';
      }
    } catch (error) {
      setNotice(`Video không thể phát: ${error.message}`);
    }
  }

  function resetView() {
    state.cameraYaw = 0;
    state.cameraPitch = 0;
    updateCamera();
  }

  function canRecordCurrentMode() {
    if (state.appMode === 'participant') {
      return Boolean(getSeeSoCalibrationData()) || state.webcamCalibrationTrained || state.webcamStarted;
    }

    return true;
  }

  function isAoiPackageLoading() {
    return typeof aoiSource === 'string' && aoiSource.startsWith('loading ');
  }

  function hasLoadedStudyAois() {
    return activeAois.length > 0 && !isAoiPackageLoading() && aoiSource !== 'none';
  }

  function ensureLoadedStudyAois() {
    if (hasLoadedStudyAois()) {
      return true;
    }

    const message = isAoiPackageLoading()
      ? 'AOI quality package is still loading. Wait for it to finish before recording or exporting JSON.'
      : 'No quality AOI package is loaded for this video. Recording/export is blocked.';
    setNotice(message, true);
    return false;
  }

  function canStartRecordingNow() {
    if (!ensureLoadedStudyAois()) {
      return false;
    }

    const rawDiagnostic = state.rawGazeDiagnostic.latestSummary;
    if (state.mode === 'webcam' && rawDiagnostic?.shouldBlockRecording) {
      setNotice(`${rawDiagnostic.reason} Đã chặn ghi.`, true);
      return false;
    }

    return true;
  }

  function getParticipantRecordingElapsedSec() {
    if (!Number.isFinite(participantRecordingStartedAtSec)) {
      return 0;
    }

    const currentTime = Number(sourceVideo.currentTime);
    return Math.max(0, (Number.isFinite(currentTime) ? currentTime : 0) - participantRecordingStartedAtSec);
  }

  function formatCountdownSeconds(value) {
    const seconds = Math.max(0, Math.ceil(value));
    return `00:${String(seconds).padStart(2, '0')}`;
  }

  function updateParticipantRecordingCountdown() {
    if (state.appMode !== 'participant' || !state.isRecording) {
      participantRecordingCountdown.hidden = true;
      return PARTICIPANT_RECORDING_LIMIT_SEC;
    }

    const remainingSec = Math.max(
      0,
      PARTICIPANT_RECORDING_LIMIT_SEC - getParticipantRecordingElapsedSec(),
    );
    participantRecordingCountdown.hidden = false;
    participantRecordingCountdown.textContent = formatCountdownSeconds(remainingSec);
    return remainingSec;
  }

  function startParticipantRecordingCountdown() {
    participantRecordingStartedAtSec = Number.isFinite(Number(sourceVideo.currentTime))
      ? Number(sourceVideo.currentTime)
      : 0;
    updateParticipantRecordingCountdown();
  }

  function stopParticipantRecordingCountdown() {
    participantRecordingStartedAtSec = null;
    participantRecordingCountdown.hidden = true;
  }

  function enforceParticipantRecordingLimit() {
    if (state.appMode !== 'participant' || !state.isRecording) {
      updateParticipantRecordingCountdown();
      return;
    }

    const remainingSec = updateParticipantRecordingCountdown();
    if (remainingSec > 0) {
      return;
    }

    setRecordingActive(false);
    pauseSynchronizedParticipantPlayback();
    setNotice('Báº£n ghi Ä‘Ã£ tá»± dá»«ng sau 30 giÃ¢y. CÃ³ thá»ƒ xuáº¥t káº¿t quáº£.', true);
  }

  function setRecordingActive(isRecording) {
    if (state.isRecording === isRecording) {
      return;
    }

    const startingRecording = isRecording;

    if (startingRecording) {
      exitAnalyticsMode();
      state.gazeStreamStats = null;
      activeStatsSampleSource = 'live';
    }

    state.isRecording = isRecording;
    resetRecordingSampleScheduler();
    recordButton.textContent = state.isRecording ? 'Dừng ghi' : 'Bắt đầu ghi';
    recordButton.classList.toggle('primary', !state.isRecording);
    syncAdminGazeSetupControls();
    syncParticipantSessionControls();
    if (state.appMode === 'participant' && state.isRecording) {
      startParticipantRecordingCountdown();
    } else {
      stopParticipantRecordingCountdown();
    }
    if (!state.isRecording) {
      enterAnalyticsMode('live');
    }
  }

  function toggleRecording() {
    if (!state.isRecording && !canStartRecordingNow()) {
      return;
    }

    setRecordingActive(!state.isRecording);
  }

  async function startSynchronizedParticipantPlayback() {
    if (state.appMode === 'participant') {
      sourceVideo.loop = false;
    }

    if (!sourceVideo.paused) {
      playVideoButton.textContent = 'Tạm dừng';
      return true;
    }

    try {
      await sourceVideo.play();
      playVideoButton.textContent = 'Tạm dừng';
      setNotice('', false);
      return true;
    } catch (error) {
      setNotice(`Video không thể phát: ${error.message}`);
      return false;
    }
  }

  function pauseSynchronizedParticipantPlayback() {
    if (!sourceVideo.paused) {
      sourceVideo.pause();
    }

    playVideoButton.textContent = 'Phát';
  }

  async function toggleParticipantRecording() {
    if (state.appMode !== 'participant') {
      toggleRecording();
      return;
    }

    if (state.isRecording) {
      setRecordingActive(false);
      pauseSynchronizedParticipantPlayback();
      return;
    }

    if (!canStartRecordingNow()) {
      return;
    }

    setWebcamStatus('starting');
    syncParticipantSessionControls();
    await setWebcamMode();
    if (!state.webcamStarted) {
      syncParticipantSessionControls();
      return;
    }

    const playbackStarted = await startSynchronizedParticipantPlayback();
    if (playbackStarted) {
      await requestParticipantFullscreen();
      setRecordingActive(true);
    }
  }

  function syncParticipantRecordingFromPlayback() {
    if (state.appMode !== 'participant' || !state.participant.startedAt) {
      return;
    }

    if (sourceVideo.paused) {
      playVideoButton.textContent = 'Phát';
      if (state.isRecording) {
        setRecordingActive(false);
      }
      return;
    }

    playVideoButton.textContent = 'Tạm dừng';
    if (!state.isRecording && canRecordCurrentMode() && canStartRecordingNow()) {
      setRecordingActive(true);
    }
  }

  function handleParticipantVideoEnded() {
    if (state.appMode !== 'participant') {
      return;
    }

    playVideoButton.textContent = 'Phát';
    if (state.isRecording) {
      setRecordingActive(false);
      setNotice('Bản ghi đã hoàn tất. Có thể tải CSV thống kê xuống máy này.', true);
    }
  }

  function clearSamples() {
    const shouldClearReviewSamples = activeStatsSampleSource === 'review' || analyticsMode === 'review';

    exitAnalyticsMode();
    state.samples = [];
    state.gazeStreamStats = null;
    if (shouldClearReviewSamples) {
      state.reviewSamples = [];
      state.reviewSource = '';
      state.reviewActive = false;
      state.reviewIndex = 0;
      reviewButton.disabled = true;
      reviewButton.textContent = 'Xem lại bản ghi';
    }
    activeStatsSampleSource = 'live';
    resetAoiStability();
    resetRecordingSampleScheduler();
    sampleCount.textContent = '0';
    syncParticipantSessionControls();
  }

  async function startReviewMode() {
    if (!state.reviewSamples.length) {
      setNotice('Tải JSON bản ghi trước khi xem lại.');
      return;
    }

    state.reviewActive = true;
    state.mode = 'review';
    state.isRecording = false;
    activeStatsSampleSource = 'review';
    resetRecordingSampleScheduler();
    recordButton.textContent = 'Bắt đầu ghi';
    recordButton.classList.add('primary');
    mouseModeButton.classList.remove('is-active');
    webcamModeButton.classList.remove('is-active');
    modeLabel.textContent = 'xem lại';
    reviewButton.textContent = 'Dừng xem lại';
    sampleCount.textContent = String(state.reviewSamples.length);

    const firstSample = state.reviewSamples[0];
    if (Number.isFinite(firstSample?.t) && Number.isFinite(sourceVideo.duration)) {
      sourceVideo.currentTime = Math.min(sourceVideo.duration, Math.max(0, firstSample.t));
    }

    updateReadout();
    drawMiniMap();
    renderAoiStatsPanel();

    const reviewWindow = getReviewTimeWindow(state.reviewSamples);
    const windowLabel = reviewWindow
      ? ` (cửa sổ mẫu ${(reviewWindow.end - reviewWindow.start).toFixed(1)}s)`
      : '';

    try {
      await sourceVideo.play();
      playVideoButton.textContent = 'Tạm dừng';
      setNotice(`Đang xem lại ${state.reviewSamples.length} mẫu từ ${state.reviewSource}${windowLabel}.`, true);
    } catch (error) {
      playVideoButton.textContent = 'Phát';
      setNotice(`Đang xem lại ${state.reviewSamples.length} mẫu từ ${state.reviewSource}${windowLabel}. Nhấn Phát để phát lại theo thời gian.`, true);
    }
  }

  async function toggleReviewMode() {
    if (state.reviewActive) {
      stopReviewMode();
      state.mode = 'mouse';
      state.gaze = createDefaultGaze({ source: 'mouse' });
      mouseModeButton.classList.add('is-active');
      webcamModeButton.classList.remove('is-active');
      modeLabel.textContent = 'chuột';
      setNotice('Đã dừng xem lại bản ghi.', false);
      renderAoiStatsPanel();
      return;
    }

    await startReviewMode();
  }

  function buildExportSummary(samples = state.samples, exportState = state) {
    return createExportSummary(samples, exportState, recordingSampleScheduler.intervalMs, {
      screenHeatmapDimensions: getViewerScreenDimensions(),
    });
  }

  function downloadText(text, fileName, type = 'text/plain') {
    const blob = new Blob([text], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
  }

  function downloadJson(payload, fileName) {
    downloadText(JSON.stringify(payload, null, 2), fileName, 'application/json');
  }

  function normalizeDownloadSegment(value, fallback) {
    const normalized = String(value ?? '')
      .trim()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase();

    return normalized || fallback;
  }

  function buildParticipantCsvFileName() {
    const participantId = normalizeDownloadSegment(
      state.participant.id || participantIdInput.value,
      'participant',
    );
    const videoId = normalizeDownloadSegment(
      selectedStudyVideo?.id || sourceVideoInfo.name,
      'video',
    );

    return `aoi-stats-${videoId}-${participantId}-${Date.now()}.csv`;
  }

  function buildParticipantJsonFileName() {
    const participantId = normalizeDownloadSegment(
      state.participant.id || participantIdInput.value,
      'participant',
    );
    const videoId = normalizeDownloadSegment(
      selectedStudyVideo?.id || sourceVideoInfo.name,
      'video',
    );

    return `aoi-result-${videoId}-${participantId}-${Date.now()}.json`;
  }

  function buildParticipantHeatmapFileName() {
    const participantId = normalizeDownloadSegment(
      state.participant.id || participantIdInput.value,
      'participant',
    );
    const videoId = normalizeDownloadSegment(
      selectedStudyVideo?.id || sourceVideoInfo.name,
      'video',
    );

    return `aoi-heatmap-${videoId}-${participantId}-${Date.now()}.json`;
  }

  function buildMergedHeatmapFileName(extension = 'json') {
    return `merged-heatmaps-${Date.now()}.${extension}`;
  }

  function exportMergedHeatmapJson() {
    if (!mergedHeatmapExport) {
      setNotice('Chưa có heatmap tổng để xuất JSON.', true);
      return;
    }

    downloadJson(mergedHeatmapExport, buildMergedHeatmapFileName('json'));
    setNotice('Đã xuất JSON heatmap tổng.', true);
  }

  function drawMergedHeatmapToCanvas(canvas, heatmap) {
    const dimensions = getHeatmapRenderDimensions(heatmap);

    canvas.width = dimensions.width;
    canvas.height = dimensions.height;

    const context = canvas.getContext('2d');

    if (!context) {
      return false;
    }

    const columns = Number.isFinite(Number(heatmap?.columns)) && Number(heatmap.columns) > 0
      ? Number(heatmap.columns)
      : 72;
    const rows = Number.isFinite(Number(heatmap?.rows)) && Number(heatmap.rows) > 0
      ? Number(heatmap.rows)
      : 36;
    const cellWidth = canvas.width / columns;
    const cellHeight = canvas.height / rows;

    context.globalCompositeOperation = 'source-over';
    context.fillStyle = '#111827';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.globalCompositeOperation = 'lighter';

    normalizeHeatmapBins(heatmap).forEach((bin) => {
      const column = Number(bin.column);
      const row = Number(bin.row);
      const intensity = Number(bin.intensity);

      if (
        !Number.isFinite(column)
        || !Number.isFinite(row)
        || !Number.isFinite(intensity)
        || intensity <= 0
        || column < 0
        || row < 0
        || column >= columns
        || row >= rows
      ) {
        return;
      }

      const x = (column + 0.5) * cellWidth;
      const y = (row + 0.5) * cellHeight;
      const radius = Math.max(cellWidth, cellHeight) * (1.2 + intensity * 2.4);
      const gradient = context.createRadialGradient(x, y, 0, x, y, radius);

      gradient.addColorStop(0, `rgba(255, 255, 255, ${Math.min(0.95, intensity)})`);
      gradient.addColorStop(0.18, `rgba(255, 40, 24, ${Math.min(0.85, intensity)})`);
      gradient.addColorStop(0.45, `rgba(255, 210, 28, ${Math.min(0.65, intensity * 0.75)})`);
      gradient.addColorStop(0.78, `rgba(0, 220, 255, ${Math.min(0.35, intensity * 0.45)})`);
      gradient.addColorStop(1, 'rgba(0, 220, 255, 0)');

      context.fillStyle = gradient;
      context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    });

    context.globalCompositeOperation = 'source-over';
    return true;
  }

  function exportMergedHeatmapImage() {
    const heatmap = getSelectedMergedHeatmap();

    if (!heatmap) {
      setNotice('Nhóm đã chọn không có heatmap hợp lệ để xuất ảnh.');
      return;
    }

    const canvas = document.createElement('canvas');
    const drawn = drawMergedHeatmapToCanvas(canvas, heatmap);

    if (!drawn) {
      setNotice('Không thể vẽ heatmap tổng để xuất ảnh.', true);
      return;
    }

    let dataUrl = '';

    try {
      dataUrl = canvas.toDataURL('image/png');
    } catch (error) {
      setNotice('Không thể tạo PNG heatmap tổng để xuất ảnh.', true);
      return;
    }

    if (!dataUrl || dataUrl === 'data:,') {
      setNotice('Không thể tạo PNG heatmap tổng để xuất ảnh.', true);
      return;
    }

    const anchor = document.createElement('a');
    anchor.href = dataUrl;
    anchor.download = buildMergedHeatmapFileName('png');
    anchor.click();
    setNotice('Đã xuất ảnh heatmap tổng.', true);
  }

  function buildVideoPackageMetadata() {
    syncSourceVideoMetadataFromControls();

    return createVideoPackageMetadata({
      sourceVideoInfo,
      sourceVideo,
      sidecarVideo: registeredProjectMetadata.video || {},
      projection: getCurrentProjection(),
      stereoLayout: getCurrentStereoLayout(),
    });
  }

  function buildProjectPackage() {
    syncSourceVideoMetadataFromControls();

    return createProjectPackage({
      sourceVideoInfo,
      sourceVideo,
      sidecarVideo: registeredProjectMetadata.video || {},
      projection: getCurrentProjection(),
      stereoLayout: getCurrentStereoLayout(),
      aoiSource,
      aois: activeAois,
      selectedCalibrationProfile: state.selectedCalibrationProfile,
      calibrationProfile: state.calibrationProfile,
      selectedValidationPolicyId: state.selectedValidationPolicyId,
      validationPolicyId: state.validationPolicyId,
      faceQualityAvailable: state.faceQualityAvailable,
      faceQualityUnavailableReason: state.faceQualityUnavailableReason,
      faceQualityBaseline: state.faceQualityBaseline,
      faceQualityInvalidations: state.faceQualityInvalidations,
    });
  }

  function getActiveStatsSamples() {
    return activeStatsSampleSource === 'review' ? state.reviewSamples : state.samples;
  }

  function hasSamplesForAnalytics(source = activeStatsSampleSource) {
    const samples = source === 'review' ? state.reviewSamples : state.samples;
    return Array.isArray(samples) && samples.length > 0;
  }

  function clearGazeHeatmapOverlay() {
    const ctx = gazeHeatmapOverlay.getContext('2d');
    if (!ctx) {
      return;
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, gazeHeatmapOverlay.width || 1, gazeHeatmapOverlay.height || 1);
    updateHeatmapRuler();
  }

  function formatHeatmapWeightMs(weightMs) {
    const value = Number(weightMs);
    if (!Number.isFinite(value) || value <= 0) {
      return '--';
    }

    if (value < 1000) {
      return `${Math.round(value)}ms`;
    }

    const seconds = value / 1000;
    return `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)}s`;
  }

  function updateHeatmapRuler(range = null) {
    const hasVisibleHeatmap = analyticsMode !== null || activeMergedHeatmapView !== null;
    heatmapRuler.hidden = !hasVisibleHeatmap || !range;

    if (heatmapRuler.hidden) {
      heatmapRulerMin.textContent = '--';
      heatmapRulerMax.textContent = '--';
      heatmapRuler.removeAttribute('data-point-count');
      heatmapRuler.setAttribute('aria-label', 'Heatmap intensity scale');
      return;
    }

    heatmapRulerMin.textContent = formatHeatmapWeightMs(range.minWeightMs);
    heatmapRulerMax.textContent = formatHeatmapWeightMs(range.maxWeightMs);
    heatmapRuler.dataset.pointCount = String(range.pointCount ?? 0);
    heatmapRuler.setAttribute(
      'aria-label',
      `Heatmap intensity scale from ${heatmapRulerMin.textContent} to ${heatmapRulerMax.textContent}`,
    );
  }

  function syncGazeHeatmapOverlaySize() {
    const dimensions = getViewerScreenDimensions();
    const width = Math.max(1, Math.round(dimensions.width));
    const height = Math.max(1, Math.round(dimensions.height));
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    const canvasWidth = Math.max(1, Math.round(width * pixelRatio));
    const canvasHeight = Math.max(1, Math.round(height * pixelRatio));

    if (gazeHeatmapOverlay.width !== canvasWidth) {
      gazeHeatmapOverlay.width = canvasWidth;
    }

    if (gazeHeatmapOverlay.height !== canvasHeight) {
      gazeHeatmapOverlay.height = canvasHeight;
    }

    gazeHeatmapOverlay.style.width = `${width}px`;
    gazeHeatmapOverlay.style.height = `${height}px`;

    return { width, height, pixelRatio };
  }

  function pointIsInsideViewport(point, width, height) {
    return (
      Number.isFinite(point?.x) &&
      Number.isFinite(point?.y) &&
      point.x >= 0 &&
      point.y >= 0 &&
      point.x <= width &&
      point.y <= height
    );
  }

  function getHeatmapSampleWeightMs(sample, index, samples) {
    const explicitWeight = Number(sample?.weightMs ?? sample?.durationMs);
    if (Number.isFinite(explicitWeight) && explicitWeight > 0) {
      return clampNumber(explicitWeight, 8, 240);
    }

    const nextTime = Number(samples[index + 1]?.t);
    const currentTime = Number(sample?.t);
    const deltaMs = Number.isFinite(nextTime) && Number.isFinite(currentTime)
      ? (nextTime - currentTime) * 1000
      : recordingSampleScheduler.intervalMs;

    return clampNumber(deltaMs, 8, 240);
  }

  function getHeatmapPointForSample(sample, dimensions) {
    const { width, height } = dimensions;
    const projection = getCurrentProjection();
    const hasPanoramaPoint = (
      Number.isFinite(sample?.panorama?.yaw) &&
      Number.isFinite(sample?.panorama?.pitch)
    );

    if (projection === 'equirectangular' && hasPanoramaPoint) {
      const projected = panoramaPointToScreen({
        yaw: sample.panorama.yaw,
        pitch: sample.panorama.pitch,
        width,
        height,
        cameraYaw: state.cameraYaw,
        cameraPitch: state.cameraPitch,
        fov: camera.fov,
      });

      return projected.visible && pointIsInsideViewport(projected, width, height)
        ? { x: projected.x, y: projected.y }
        : null;
    }

    const screenPoint = Number.isFinite(sample?.screen?.x) && Number.isFinite(sample?.screen?.y)
      ? { x: sample.screen.x, y: sample.screen.y }
      : null;

    if (screenPoint && pointIsInsideViewport(screenPoint, width, height)) {
      return screenPoint;
    }

    const videoPoint = Number.isFinite(sample?.videoPoint?.x) && Number.isFinite(sample?.videoPoint?.y)
      ? sample.videoPoint
      : sample?.video;
    if (
      projection === 'flat' &&
      Number.isFinite(videoPoint?.x) &&
      Number.isFinite(videoPoint?.y)
    ) {
      const projected = videoPointToScreenPoint(videoPoint, getCurrentVideoRect());
      if (pointIsInsideViewport(projected, width, height)) {
        return projected;
      }
    }

    if (hasPanoramaPoint) {
      const projected = panoramaPointToScreen({
        yaw: sample.panorama.yaw,
        pitch: sample.panorama.pitch,
        width,
        height,
        cameraYaw: state.cameraYaw,
        cameraPitch: state.cameraPitch,
        fov: camera.fov,
      });

      if (projected.visible && pointIsInsideViewport(projected, width, height)) {
        return { x: projected.x, y: projected.y };
      }
    }

    return null;
  }

  function isTrustedHeatmapSample(sample) {
    return (
      sample?.quality?.trustedForAoiAnalysis === true ||
      sample?.aoiStability?.trustedForAoiAnalysis === true ||
      (Array.isArray(sample?.stableHits) && sample.stableHits.length > 0)
    );
  }

  function drawHeatmapPoints(ctx, points, { width, height }) {
    if (!points.length) {
      updateHeatmapRuler();
      return;
    }

    const maxDrawnPoints = 900;
    const stride = Math.max(1, Math.ceil(points.length / maxDrawnPoints));
    const drawnPoints = points.filter((_, index) => index % stride === 0);
    const minWeightMs = Math.min(...drawnPoints.map((point) => point.weightMs));
    const maxWeightMs = Math.max(...drawnPoints.map((point) => point.weightMs), 1);
    const radiusBase = clampNumber(Math.min(width, height) * 0.095, 26, 92);
    updateHeatmapRuler({ minWeightMs, maxWeightMs, pointCount: drawnPoints.length });

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    drawnPoints.forEach((point) => {
      const intensity = clampNumber(point.weightMs / maxWeightMs, 0.18, 1);
      const radius = radiusBase * (0.72 + intensity * 0.42);
      const alpha = 0.1 + intensity * 0.22;
      const gradient = ctx.createRadialGradient(
        point.x,
        point.y,
        0,
        point.x,
        point.y,
        radius,
      );

      gradient.addColorStop(0, `rgba(255, 255, 255, ${(alpha * 0.96).toFixed(3)})`);
      gradient.addColorStop(0.16, `rgba(255, 24, 16, ${alpha.toFixed(3)})`);
      gradient.addColorStop(0.42, `rgba(255, 210, 28, ${(alpha * 0.76).toFixed(3)})`);
      gradient.addColorStop(0.72, `rgba(0, 220, 255, ${(alpha * 0.38).toFixed(3)})`);
      gradient.addColorStop(1, 'rgba(0, 220, 255, 0)');
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.restore();
  }

  function drawGazeHeatmapOverlay(samples = getActiveStatsSamples()) {
    const ctx = gazeHeatmapOverlay.getContext('2d');
    if (!ctx) {
      return;
    }

    if (analyticsMode === null) {
      clearGazeHeatmapOverlay();
      return;
    }

    const dimensions = syncGazeHeatmapOverlaySize();
    const { width, height, pixelRatio } = dimensions;
    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const heatmapPoints = samples
      .map((sample, index) => {
        const point = getHeatmapPointForSample(sample, dimensions);
        return point ? {
          ...point,
          trusted: isTrustedHeatmapSample(sample),
          weightMs: getHeatmapSampleWeightMs(sample, index, samples),
        } : null;
      })
      .filter(Boolean);
    const trustedPoints = heatmapPoints.filter((point) => point.trusted);
    const points = trustedPoints.length ? trustedPoints : heatmapPoints;

    drawHeatmapPoints(ctx, points, dimensions);
  }

  function enterAnalyticsMode(source) {
    if (state.appMode !== 'admin' || !hasSamplesForAnalytics(source)) {
      return;
    }

    analyticsMode = source;
    activeStatsSampleSource = source;
    activeMergedHeatmapView = null;
    appShell.classList.add('is-analytics-mode');
    appShell.classList.remove('is-merged-heatmap-view');
    aoiStatsPanel.hidden = false;
    renderAoiStatsPanel();
  }

  function exitAnalyticsMode({ clearOverlay = true } = {}) {
    analyticsMode = null;
    heatmapOverlaySignature = '';
    appShell.classList.remove('is-analytics-mode');
    aoiStatsPanel.hidden = true;

    if (clearOverlay) {
      clearGazeHeatmapOverlay();
    }
  }

  function getHeatmapOverlaySignature() {
    const dimensions = getViewerScreenDimensions();
    const samples = getActiveStatsSamples();
    const firstSample = samples[0];
    const lastSample = samples[samples.length - 1];

    return [
      analyticsMode,
      activeStatsSampleSource,
      getCurrentProjection(),
      samples.length,
      firstSample?.t ?? '',
      lastSample?.t ?? '',
      state.cameraYaw.toFixed(3),
      state.cameraPitch.toFixed(3),
      camera.fov.toFixed(3),
      Math.round(dimensions.width),
      Math.round(dimensions.height),
    ].join('|');
  }

  function redrawAnalyticsHeatmapOverlay({ force = false } = {}) {
    if (analyticsMode !== null) {
      const signature = getHeatmapOverlaySignature();
      if (!force && signature === heatmapOverlaySignature) {
        return;
      }

      heatmapOverlaySignature = signature;
      drawGazeHeatmapOverlay(getActiveStatsSamples());
    }
  }

  function buildCurrentNamedAoiMetrics(samples = getActiveStatsSamples()) {
    const exportAois = withEffectiveAoisAnalysisPadding(activeAois, getViewerAnalysisDimensions());
    const namedAoiMetrics = buildNamedAoiMetrics(samples, exportAois, {
      sampleIntervalMs: recordingSampleScheduler.intervalMs,
    });

    return { exportAois, namedAoiMetrics };
  }

  function formatMetricNumber(value, suffix = '') {
    return Number.isFinite(value) ? `${value}${suffix}` : '--';
  }

  function formatMetricSeconds(value) {
    return Number.isFinite(value) ? `${value.toFixed(2)}s` : '--';
  }

  function formatMetricMilliseconds(value) {
    return Number.isFinite(value) && value > 0 ? `${Math.round(value)}ms` : '--';
  }

  function formatElapsedMetricMilliseconds(value) {
    return Number.isFinite(value) && value >= 0 ? `${Math.round(value)}ms` : '--';
  }

  function createStatsCell(value, className = '') {
    const cell = document.createElement('td');
    cell.textContent = value;
    if (className) {
      cell.className = className;
    }

    return cell;
  }

  function createStatsBlock(className, label, value) {
    const block = document.createElement('div');
    block.className = className;

    const labelElement = document.createElement('span');
    labelElement.textContent = label;
    const valueElement = document.createElement('strong');
    valueElement.textContent = value;

    block.append(labelElement, valueElement);
    return block;
  }

  function getAoiMetricEntries(namedAoiMetrics) {
    const perAoi = namedAoiMetrics?.perAoi;

    if (Array.isArray(perAoi)) {
      return perAoi.map((metrics, index) => [metrics?.id ?? String(index), metrics]);
    }

    return perAoi && typeof perAoi === 'object' ? Object.entries(perAoi) : [];
  }

  function renderAoiStatsSummary(viewModel) {
    const items = viewModel.summaryItems.map((item) => (
      createStatsBlock('aoi-stats-summary-item', item.label, item.value)
    ));

    aoiStatsSummary.replaceChildren(...items);
  }

  function renderAoiStatsCards(viewModel) {
    if (!viewModel.cards.length) {
      const empty = document.createElement('p');
      empty.className = 'aoi-stats-empty';
      empty.textContent = viewModel.emptyMessage;
      aoiStatsCards.replaceChildren(empty);
      return;
    }

    const note = viewModel.resultNote ? document.createElement('p') : null;
    if (note) {
      note.className = 'aoi-stats-result-note';
      note.textContent = viewModel.resultNote;
    }

    const cards = viewModel.cards.map((card) => {
      const article = document.createElement('article');
      article.className = 'aoi-stat-card';

      const header = document.createElement('div');
      header.className = 'aoi-stat-card-header';
      const rank = document.createElement('span');
      rank.className = 'aoi-stat-rank';
      rank.textContent = `#${card.rank}`;
      const title = document.createElement('h4');
      title.textContent = card.label;
      header.append(rank, title);

      const primary = createStatsBlock('aoi-stat-primary', card.primaryLabel, card.primaryValue);
      const bar = document.createElement('div');
      bar.className = 'aoi-stat-card-bar';
      const barFill = document.createElement('div');
      barFill.className = 'aoi-stat-card-bar-fill';
      barFill.style.setProperty('--bar-width', `${card.barPercent}%`);
      bar.append(barFill);

      const stats = document.createElement('dl');
      stats.className = 'aoi-stat-card-metrics';
      card.stats.forEach((stat) => {
        const metric = document.createElement('div');
        const label = document.createElement('dt');
        label.textContent = stat.label;
        const value = document.createElement('dd');
        value.textContent = stat.value;
        metric.append(label, value);
        stats.append(metric);
      });

      article.append(header, primary, bar, stats);
      return article;
    });

    aoiStatsCards.replaceChildren(...(note ? [note] : []), ...cards);
  }

  function renderAoiStatsTable(namedAoiMetrics, samples) {
    const body = aoiStatsTable.tBodies[0] || aoiStatsTable.createTBody();
    const entries = getAoiMetricEntries(namedAoiMetrics)
      .filter(([, metrics]) => metrics && typeof metrics === 'object');

    if (!samples.length || !entries.length) {
      const row = document.createElement('tr');
      const cell = createStatsCell(
        samples.length ? 'Không có chỉ số AOI cho các vùng hiện tại.' : 'Chưa có mẫu. Hãy ghi hoặc tải một phiên để tạo thống kê AOI.',
        'empty-table-cell',
      );
      cell.colSpan = 6;
      row.append(cell);
      body.replaceChildren(row);
      return;
    }

    const rows = entries.map(([key, metrics]) => {
      const row = document.createElement('tr');
      const label = metrics.label ?? metrics.name ?? metrics.id ?? key;

      row.append(
        createStatsCell(label, 'aoi-name-cell'),
        createStatsCell(formatMetricSeconds(metrics.likelyDwellSec)),
        createStatsCell(formatMetricNumber(metrics.fixationCount)),
        createStatsCell(formatMetricMilliseconds(metrics.averageFixationDurationMs)),
        createStatsCell(formatElapsedMetricMilliseconds(metrics.timeToFirstFixationMs)),
        createStatsCell(formatMetricNumber(metrics.percentageOfViewingTime, '%')),
      );

      return row;
    });

    body.replaceChildren(...rows);
  }

  function renderAoiStatsPanel() {
    if (analyticsMode === null) {
      aoiStatsPanel.hidden = true;
      return;
    }

    const samples = getActiveStatsSamples();
    const { namedAoiMetrics } = buildCurrentNamedAoiMetrics(samples);
    const viewModel = buildAoiStatsViewModel({
      namedAoiMetrics,
      sampleCount: samples.length,
    });

    renderAoiStatsSummary(viewModel);
    renderAoiStatsCards(viewModel);
    renderAoiStatsTable(namedAoiMetrics, samples);
    redrawAnalyticsHeatmapOverlay({ force: true });
  }

  function buildCurrentExportPayload() {
    syncSelectedCalibrationProfileState();
    syncSelectedValidationPolicyState();
    const activeStatsSamples = getActiveStatsSamples();
    const exportState = activeStatsSampleSource === 'live'
      ? state
      : { ...state, samples: activeStatsSamples };
    const { exportAois, namedAoiMetrics } = buildCurrentNamedAoiMetrics(activeStatsSamples);
    const video = buildVideoPackageMetadata();
    return buildExportPayload({
      sourceVideo: sourceVideo.currentSrc || sourceVideo.src,
      exportedAt: new Date().toISOString(),
      participant: getExportParticipantMetadata(),
      project: buildProjectPackage(),
      video,
      summary: buildExportSummary(activeStatsSamples, exportState),
      namedAoiMetrics,
      aoiSource,
      aois: exportAois,
      state: exportState,
    });
  }

  function exportParticipantStatsCsv() {
    const { namedAoiMetrics } = buildCurrentNamedAoiMetrics(getActiveStatsSamples());
    const csv = buildAoiStatsCsv({ namedAoiMetrics });
    const fileName = buildParticipantCsvFileName();

    downloadText(csv, fileName, 'text/csv;charset=utf-8');
    setParticipantUploadStatus('downloaded', fileName);
    setNotice(PARTICIPANT_EXPORT_SUCCESS_MESSAGE, true);
    renderParticipantResultPanel();
    renderAoiStatsPanel();
  }

  function exportParticipantJson() {
    if (!ensureLoadedStudyAois()) {
      return;
    }

    const payload = buildCurrentExportPayload();
    downloadJson(payload, buildParticipantJsonFileName());
    setParticipantUploadStatus('downloaded');
    setNotice(PARTICIPANT_EXPORT_SUCCESS_MESSAGE, true);
    renderParticipantResultPanel();
    renderAoiStatsPanel();
  }

  function exportParticipantHeatmap() {
    if (!ensureLoadedStudyAois()) {
      return;
    }

    const payload = buildCurrentExportPayload();
    const heatmapPayload = {
      exportedAt: payload.exportedAt,
      participant: payload.participant,
      video: payload.video,
      summary: {
        heatmaps: payload.summary.heatmaps,
      },
    };

    downloadJson(heatmapPayload, buildParticipantHeatmapFileName());
    setParticipantUploadStatus('downloaded');
    setNotice(PARTICIPANT_EXPORT_SUCCESS_MESSAGE, true);
    renderParticipantResultPanel();
    renderAoiStatsPanel();
  }

  async function exportSamples() {
    if (!ensureLoadedStudyAois()) {
      return;
    }

    if (state.appMode === 'participant') {
      exportParticipantStatsCsv();
      return;
    }

    const payload = buildCurrentExportPayload();

    downloadJson(payload, `aoi-samples-${Date.now()}.json`);
    renderAoiStatsPanel();
  }

  function exportStatsCsv() {
    const { namedAoiMetrics } = buildCurrentNamedAoiMetrics(getActiveStatsSamples());
    const csv = buildAoiStatsCsv({ namedAoiMetrics });

    downloadText(csv, `aoi-stats-${Date.now()}.csv`, 'text/csv;charset=utf-8');
    setNotice('Đã xuất CSV thống kê AOI.', true);
    renderAoiStatsPanel();
  }

  function createUniqueAoiId(label) {
    const base = normalizeAoiId(label, 'manual-aoi');
    const existingIds = new Set(activeAois.map((aoi) => aoi.id));

    if (!existingIds.has(base)) {
      return base;
    }

    let suffix = 2;
    while (existingIds.has(`${base}-${suffix}`)) {
      suffix += 1;
    }

    return `${base}-${suffix}`;
  }

  function setManualAnnotationIdle(message = 'Click Draw Polygon, then click around the object edge.') {
    state.manualAnnotation = { mode: 'idle', points: [], dragIndex: null, space: null };
    drawPolygonAoiButton.disabled = false;
    finishPolygonAoiButton.disabled = true;
    cancelPolygonAoiButton.disabled = true;
    aoiOverlay.classList.remove('is-authoring');
    manualAoiStatus.textContent = message;
  }

  function startPolygonAnnotation() {
    state.selectedAoiId = null;
    state.manualAnnotation = {
      mode: 'drawing',
      points: [],
      dragIndex: null,
      space: getCurrentProjection() === 'flat' ? 'video' : 'panorama',
    };
    drawPolygonAoiButton.disabled = true;
    finishPolygonAoiButton.disabled = true;
    cancelPolygonAoiButton.disabled = false;
    aoiOverlay.classList.add('is-authoring');
    manualAoiStatus.textContent = 'Nhấp quanh mép đối tượng. Nhấp đúp để hoàn tất.';
    renderAoiList();
    drawAoiOverlay();
  }

  function cancelPolygonAnnotation() {
    setManualAnnotationIdle('Click Draw Polygon, then click around the object edge.');
    drawAoiOverlay();
  }

  function updateFinishPolygonAoiState() {
    const space = state.manualAnnotation.space || (getCurrentProjection() === 'flat' ? 'video' : 'panorama');
    finishPolygonAoiButton.disabled = !isValidPolygonPoints(state.manualAnnotation.points, space);
  }

  function addDraftPolygonPoint(event) {
    if (state.manualAnnotation.mode !== 'drawing' || event.detail > 1) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const rect = viewer.getBoundingClientRect();
    const point = screenToCurrentAoiPoint({
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    });
    state.manualAnnotation.points.push(point);
    updateFinishPolygonAoiState();
    drawAoiOverlay();
  }

  function finishPolygonAnnotation() {
    if (state.manualAnnotation.points.length < 3) {
      return;
    }

    const label = manualAoiLabelInput.value.trim() || 'Manual polygon AOI';
    const id = createUniqueAoiId(label);
    const space = state.manualAnnotation.space || (getCurrentProjection() === 'flat' ? 'video' : 'panorama');
    const points = cloneAoiPoints(state.manualAnnotation.points);

    if (!isValidPolygonPoints(points, space)) {
      finishPolygonAoiButton.disabled = true;
      manualAoiStatus.textContent = 'Đa giác cần hình dạng không chồng lấn và có diện tích đo được.';
      setNotice('AOI đa giác cần hình dạng không chồng lấn và có diện tích đo được.');
      return;
    }

    const aoi = {
      id,
      label,
      color: manualAoiColorInput.value || '#ffd166',
      space,
      shape: 'polygon',
      points,
      keyframes: [
        {
          t: Number((sourceVideo.currentTime || 0).toFixed(3)),
          points: cloneAoiPoints(points),
        },
      ],
    };

    activeAois = [...activeAois, aoi];
    resetAoiStability();
    invalidateAoiOverlay();
    aoiSource = 'manual';
    cancelPolygonAnnotation();
    renderAoiList();
    drawAoiOverlay();
    drawMiniMap();
    setNotice(`Đã thêm AOI đa giác: ${label}`, true);
  }

  function selectAoiForEditing(aoiId, { restoreFocus = false } = {}) {
    const selectedAoi = getActiveAoiById(aoiId);

    if (!selectedAoi) {
      return;
    }

    state.selectedAoiId = selectedAoi.id;
    state.manualAnnotation = {
      mode: selectedAoi.shape === 'polygon' ? 'editing' : 'idle',
      points: [],
      dragIndex: null,
      space: null,
    };
    drawPolygonAoiButton.disabled = false;
    finishPolygonAoiButton.disabled = true;
    cancelPolygonAoiButton.disabled = true;
    aoiOverlay.classList.remove('is-authoring');
    manualAoiStatus.textContent = selectedAoi.shape === 'polygon'
      ? 'Drag polygon vertices to refine the selected AOI.'
      : 'Selected AOI. Polygon vertices are editable for polygon AOIs.';
    renderAoiList({ focusAoiId: restoreFocus ? selectedAoi.id : null });
    drawAoiOverlay();
  }

  function handleAoiListClick(event) {
    const button = event.target.closest('.aoi-list-button[data-aoi-id]');

    if (button) {
      selectAoiForEditing(button.dataset.aoiId, { restoreFocus: true });
    }
  }

  function saveSelectedAoiChanges() {
    const selectedAoi = getActiveAoiById(state.selectedAoiId);

    if (!selectedAoi) {
      syncSelectedAoiPanel();
      return;
    }

    const label = selectedAoiLabelInput.value.trim() || selectedAoi.label || 'AOI';
    const color = selectedAoiColorInput.value || selectedAoi.color || '#ffd166';
    const analysisPaddingPx = normalizeAnalysisPaddingPx(selectedAoiPaddingInput.value);
    const dimensions = getViewerAnalysisDimensions();

    activeAois = activeAois.map((aoi) => (
      aoi.id === selectedAoi.id
        ? withEffectiveAoiAnalysisPadding({
          ...aoi,
          label,
          color,
          analysisPaddingPx,
        }, dimensions, { forceFromPx: true })
        : aoi
    ));
    resetAoiStability();
    invalidateAoiOverlay();

    renderAoiList({ focusAoiId: selectedAoi.id });
    drawAoiOverlay();
    drawMiniMap();
    setNotice(`Đã cập nhật AOI: ${label}`, true);
  }

  function deleteSelectedAoi() {
    const selectedAoi = getActiveAoiById(state.selectedAoiId);

    if (!selectedAoi) {
      state.selectedAoiId = null;
      setManualAnnotationIdle('Click Draw Polygon, then click around the object edge.');
      renderAoiList();
      drawAoiOverlay();
      drawMiniMap();
      return;
    }

    activeAois = activeAois.filter((aoi) => aoi.id !== selectedAoi.id);
    resetAoiStability();
    invalidateAoiOverlay();
    state.selectedAoiId = null;
    setManualAnnotationIdle('Click Draw Polygon, then click around the object edge.');
    renderAoiList();
    drawAoiOverlay();
    drawMiniMap();
    setNotice(`Đã xóa AOI: ${selectedAoi.label}`, true);
  }

  function findEditablePolygonKeyframeIndex(aoi) {
    if (!Array.isArray(aoi?.keyframes) || aoi.keyframes.length <= 1) {
      return 0;
    }

    const timeSec = sourceVideo.currentTime || 0;
    return aoi.keyframes.findIndex((keyframe) => (
      Number.isFinite(keyframe?.t) &&
      Math.abs(keyframe.t - timeSec) <= POLYGON_KEYFRAME_EDIT_EPSILON_SEC
    ));
  }

  function canEditPolygonVerticesAtCurrentTime(aoi) {
    return aoi?.shape === 'polygon' && findEditablePolygonKeyframeIndex(aoi) >= 0;
  }

  function setDynamicPolygonKeyframeEditMessage() {
    manualAoiStatus.textContent = 'Di chuyển đến keyframe đa giác để sửa các đỉnh động.';
  }

  function replacePolygonVertex(points, vertexIndex, point) {
    const nextPoints = cloneAoiPoints(points);

    if (!nextPoints[vertexIndex]) {
      return null;
    }

    nextPoints[vertexIndex] = point;
    return nextPoints;
  }

  function updatePolygonKeyframes(aoi, vertexIndex, point) {
    let editedKeyframePoints = null;

    if (!Array.isArray(aoi.keyframes) || !aoi.keyframes.length) {
      editedKeyframePoints = replacePolygonVertex(aoi.points, vertexIndex, point);

      return {
        keyframes: [
          editedKeyframePoints && {
            t: Number((sourceVideo.currentTime || 0).toFixed(3)),
            points: cloneAoiPoints(editedKeyframePoints),
          },
        ].filter(Boolean),
        editedKeyframePoints,
      };
    }

    const keyframeIndex = findEditablePolygonKeyframeIndex(aoi);

    if (keyframeIndex < 0) {
      setDynamicPolygonKeyframeEditMessage();
      return { keyframes: aoi.keyframes, editedKeyframePoints: null };
    }

    const keyframes = aoi.keyframes.map((keyframe, index) => {
      if (index !== keyframeIndex) {
        return keyframe;
      }

      const sourcePoints = Array.isArray(keyframe.points) && keyframe.points.length
        ? keyframe.points
        : aoi.points;
      const nextPoints = replacePolygonVertex(sourcePoints, vertexIndex, point);

      if (!nextPoints) {
        return keyframe;
      }

      editedKeyframePoints = nextPoints;
      return { ...keyframe, points: cloneAoiPoints(nextPoints) };
    });

    return { keyframes, editedKeyframePoints };
  }

  function updateSelectedPolygonPoint(vertexIndex, point) {
    const selectedAoi = getActiveAoiById(state.selectedAoiId);

    if (selectedAoi?.shape !== 'polygon') {
      return;
    }

    const { keyframes, editedKeyframePoints } = updatePolygonKeyframes(selectedAoi, vertexIndex, point);

    if (!editedKeyframePoints) {
      return;
    }

    const hasMultipleKeyframes = Array.isArray(selectedAoi.keyframes) && selectedAoi.keyframes.length > 1;
    const points = hasMultipleKeyframes
      ? cloneAoiPoints(selectedAoi.points)
      : cloneAoiPoints(editedKeyframePoints);

    activeAois = activeAois.map((aoi) => (
      aoi.id === selectedAoi.id
        ? {
          ...aoi,
          points: cloneAoiPoints(points),
          keyframes,
        }
        : aoi
    ));
    resetAoiStability();
    invalidateAoiOverlay();
  }

  function startVertexHandleDrag(event) {
    if (state.manualAnnotation.mode === 'drawing') {
      event.stopPropagation();
      return;
    }

    const handle = event.target.closest?.('.aoi-vertex-handle');
    if (!handle?.dataset.aoiId) {
      return;
    }

    const dragIndex = Number(handle.dataset.vertexIndex);
    if (!Number.isInteger(dragIndex)) {
      return;
    }

    const selectedAoi = getActiveAoiById(handle.dataset.aoiId);
    if (!canEditPolygonVerticesAtCurrentTime(selectedAoi)) {
      setDynamicPolygonKeyframeEditMessage();
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    state.selectedAoiId = handle.dataset.aoiId;
    state.manualAnnotation = { mode: 'editing', points: [], dragIndex, space: null };
    aoiOverlay.setPointerCapture(event.pointerId);
    manualAoiStatus.textContent = 'Đang kéo đỉnh đa giác.';
    renderAoiList();
    event.preventDefault();
    event.stopPropagation();
  }

  function dragSelectedVertex(event) {
    if (state.manualAnnotation.mode !== 'editing' || state.manualAnnotation.dragIndex === null) {
      return;
    }

    const selectedAoi = getActiveAoiById(state.selectedAoiId);
    if (selectedAoi?.shape !== 'polygon') {
      return;
    }

    if (!canEditPolygonVerticesAtCurrentTime(selectedAoi)) {
      state.manualAnnotation.dragIndex = null;
      setDynamicPolygonKeyframeEditMessage();
      return;
    }

    const rect = viewer.getBoundingClientRect();
    const point = screenToAoiSpacePoint({
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    }, getAoiSpace(selectedAoi));
    updateSelectedPolygonPoint(state.manualAnnotation.dragIndex, point);
    drawAoiOverlay();
    event.preventDefault();
    event.stopPropagation();
  }

  function finishVertexHandleDrag(event) {
    if (state.manualAnnotation.dragIndex === null) {
      return;
    }

    state.manualAnnotation = { ...state.manualAnnotation, dragIndex: null };
    if (aoiOverlay.hasPointerCapture(event.pointerId)) {
      aoiOverlay.releasePointerCapture(event.pointerId);
    }
    manualAoiStatus.textContent = 'Kéo các đỉnh đa giác để tinh chỉnh AOI đã chọn.';
    drawAoiOverlay();
    event.preventDefault();
    event.stopPropagation();
  }

  function addManualAoi() {
    const label = manualAoiLabelInput.value.trim() || 'Manual AOI';
    const color = manualAoiColorInput.value || '#ffd166';
    const size = Math.min(80, Math.max(4, Number(manualAoiSizeInput.value) || 24));
    const timeSec = Number(sourceVideo.currentTime.toFixed(3)) || 0;
    const projection = getCurrentProjection();
    const id = createUniqueAoiId(label);
    let aoi;

    if (projection === 'flat') {
      const half = size / 200;
      aoi = {
        id,
        label,
        color,
        space: 'video',
        xMin: Number(Math.max(0, 0.5 - half).toFixed(6)),
        xMax: Number(Math.min(1, 0.5 + half).toFixed(6)),
        yMin: Number(Math.max(0, 0.5 - half).toFixed(6)),
        yMax: Number(Math.min(1, 0.5 + half).toFixed(6)),
      };
    } else {
      const rect = viewer.getBoundingClientRect();
      const center = screenPointToYawPitch({
        x: rect.width / 2,
        y: rect.height / 2,
        width: rect.width,
        height: rect.height,
        cameraYaw: state.cameraYaw,
        cameraPitch: state.cameraPitch,
        fov: camera.fov,
      });
      const yawHalf = size / 2;
      const pitchHalf = Math.max(3, size / 3);
      aoi = {
        id,
        label,
        color,
        yawMin: normalizeYaw(center.yaw - yawHalf),
        yawMax: normalizeYaw(center.yaw + yawHalf),
        pitchMin: Number(Math.max(-90, center.pitch - pitchHalf).toFixed(3)),
        pitchMax: Number(Math.min(90, center.pitch + pitchHalf).toFixed(3)),
      };
    }

    aoi.keyframes = [{ t: timeSec, ...aoi }];
    activeAois = [...activeAois, aoi];
    resetAoiStability();
    invalidateAoiOverlay();
    aoiSource = 'manual';
    renderAoiList();
    drawAoiOverlay();
    drawMiniMap();
    setNotice(`Đã thêm AOI: ${label}`, true);
  }

  function loadLocalVideo(event) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    sourceVideo.src = URL.createObjectURL(file);
    generatedAoiLoadId += 1;
    sourceVideoInfo = {
      kind: 'local-file',
      name: file.name,
      path: null,
      type: file.type || null,
      size: file.size,
      lastModified: file.lastModified || null,
      projection: getCurrentProjection(),
      stereoLayout: getCurrentStereoLayout(),
    };
    sourceVideo.load();
    setNotice(`Đã tải video cục bộ: ${file.name}`);
    playVideoButton.textContent = 'Phát';
  }

  function syncVideoNotice() {
    if (state.appMode === 'validation') {
      setNotice('Màn hình xác thực trống. Khi người dùng sẵn sàng, hãy bắt đầu kiểm tra độ chính xác.', true);
      return;
    }

    if (state.reviewActive || sourceVideo.readyState < HTMLMediaElement.HAVE_METADATA) {
      return;
    }

    if (isViewerNoticeShowingWorkflowMessage()) {
      return;
    }

    setNotice('Video đã load thành công trên hệ thống và sẵn sàng để tải về.', false);
  }

  return {
    start() {
      sourceVideo.addEventListener('loadedmetadata', syncVideoNotice);
      sourceVideo.addEventListener('canplay', syncVideoNotice);
      sourceVideo.addEventListener('play', syncParticipantRecordingFromPlayback);
      sourceVideo.addEventListener('pause', syncParticipantRecordingFromPlayback);
      sourceVideo.addEventListener('ended', handleParticipantVideoEnded);

      sourceVideo.addEventListener('error', () => {
        setNotice('Không thể tải video nghiên cứu đã chọn. Hãy kiểm tra các clip nghiên cứu trong assets/clips và assets/clips-2d.');
      });

      aoiOverlay.addEventListener('click', addDraftPolygonPoint);
      aoiOverlay.addEventListener('dblclick', (event) => {
        if (state.manualAnnotation.mode === 'drawing') {
          event.preventDefault();
          event.stopPropagation();
          finishPolygonAnnotation();
        }
      });
      aoiOverlay.addEventListener('pointerdown', startVertexHandleDrag);
      aoiOverlay.addEventListener('pointermove', dragSelectedVertex);
      aoiOverlay.addEventListener('pointerup', finishVertexHandleDrag);
      aoiOverlay.addEventListener('pointercancel', finishVertexHandleDrag);
      aoiOverlay.addEventListener('lostpointercapture', finishVertexHandleDrag);
      viewer.addEventListener('pointerdown', startDrag);
      viewer.addEventListener('pointermove', drag);
      viewer.addEventListener('pointerup', endDrag);
      viewer.addEventListener('pointercancel', endDrag);
      mouseProvider.start();
      playVideoButton.addEventListener('click', toggleVideoPlayback);
      resetViewButton.addEventListener('click', resetView);
      mouseModeButton.addEventListener('click', setMouseMode);
      webcamModeButton.addEventListener('click', setWebcamMode);
      gazeProviderSelect.addEventListener('change', handleGazeProviderChange);
      calibrateButton.addEventListener('click', startCalibration);
      accuracyButton.addEventListener('click', startAccuracyCheck);
      rawGazeDiagnosticButton.addEventListener('click', startRawGazeDiagnostic);
      calibrationTarget.addEventListener('click', handleTargetClick);
      cancelCalibrationButton.addEventListener('click', cancelCalibration);
      recordButton.addEventListener('click', toggleRecording);
      reviewButton.addEventListener('click', toggleReviewMode);
      clearButton.addEventListener('click', clearSamples);
      exportButton.addEventListener('click', exportSamples);
      exportStatsCsvButton.addEventListener('click', exportStatsCsv);
      exitAnalyticsButton.addEventListener('click', () => exitAnalyticsMode());
      analyticsClearButton.addEventListener('click', clearSamples);
      analyticsExportButton.addEventListener('click', exportSamples);
      analyticsExportStatsCsvButton.addEventListener('click', exportStatsCsv);
      refreshStatsButton.addEventListener('click', renderAoiStatsPanel);
      studyVideoSelect.addEventListener('change', handleStudyVideoChange);
      participantStudyVideoSelect.addEventListener('change', handleParticipantStudyVideoChange);
      aoiFileInput.addEventListener('change', loadAoiFile);
      calibrationProfileSelect.addEventListener('change', syncSelectedCalibrationProfileState);
      validationPolicySelect.addEventListener('change', syncSelectedValidationPolicyState);
      projectionSelect.addEventListener('change', syncSourceVideoMetadataFromControls);
      stereoLayoutSelect.addEventListener('change', syncSourceVideoMetadataFromControls);
      addManualAoiButton.addEventListener('click', addManualAoi);
      drawPolygonAoiButton.addEventListener('click', startPolygonAnnotation);
      finishPolygonAoiButton.addEventListener('click', finishPolygonAnnotation);
      cancelPolygonAoiButton.addEventListener('click', cancelPolygonAnnotation);
      aoiList.addEventListener('click', handleAoiListClick);
      saveSelectedAoiButton.addEventListener('click', saveSelectedAoiChanges);
      deleteSelectedAoiButton.addEventListener('click', deleteSelectedAoi);
      adminFlowSteps.forEach((element) => {
        element.addEventListener('click', () => {
          setAdminWorkflowStep(element.hash.slice(1));
        });
      });
      controlPanel.addEventListener('scroll', syncAdminWorkflowStep, { passive: true });
      recordingFileInput.addEventListener('change', loadRecordingFile);
      heatmapMergeFileInput.addEventListener('change', loadHeatmapMergeFiles);
      mergedHeatmapPackageFileInput.addEventListener('change', loadMergedHeatmapPackageFile);
      viewMergedHeatmapButton.addEventListener('click', () => viewSelectedMergedHeatmap());
      clearMergedHeatmapViewButton.addEventListener('click', clearMergedHeatmapView);
      exportMergedHeatmapJsonButton.addEventListener('click', exportMergedHeatmapJson);
      exportMergedHeatmapImageButton.addEventListener('click', exportMergedHeatmapImage);
      mergedHeatmapGroupSelect.addEventListener('change', syncMergedHeatmapControls);
      mergedHeatmapVariantSelect.addEventListener('change', syncMergedHeatmapControls);
      mergedHeatmapTypeSelect.addEventListener('change', syncMergedHeatmapControls);
      participantIdInput.addEventListener('input', handleParticipantMetadataChange);
      participantNameInput.addEventListener('input', handleParticipantMetadataChange);
      participantAgeInput.addEventListener('input', handleParticipantMetadataChange);
      participantConsentInput.addEventListener('change', handleParticipantMetadataChange);
      getSeeSoGeometryInputs().forEach(([monitorInput, distanceInput]) => {
        monitorInput.addEventListener('input', persistSeeSoGeometrySettings);
        distanceInput.addEventListener('input', persistSeeSoGeometrySettings);
      });
      participantStartButton.addEventListener('click', startParticipantSession);
      participantCalibrateButton.addEventListener('click', startCalibration);
      participantRecordButton.addEventListener('click', toggleParticipantRecording);
      participantExportCsvButton.addEventListener('click', exportParticipantStatsCsv);
      participantExportJsonButton.addEventListener('click', exportParticipantJson);
      participantExportHeatmapButton.addEventListener('click', exportParticipantHeatmap);
      validationTestCalibrateButton.addEventListener('click', startCalibration);
      validationTestAccuracyButton.addEventListener('click', startAccuracyCheck);
      validationStatsCloseButton.addEventListener('click', hideValidationStatsPopup);
      validationStatsPopup.addEventListener('click', (event) => {
        if (event.target === validationStatsPopup) {
          hideValidationStatsPopup();
        }
      });
      window.addEventListener('resize', handleResize);
      window.addEventListener('blur', handleWindowFocusLoss);
      document.addEventListener('visibilitychange', handleVisibilityChange);

      renderAoiList();
      STUDY_VIDEOS.forEach((video) => {
        [studyVideoSelect, participantStudyVideoSelect].forEach((select) => {
          const existingOption = Array.from(select.options)
            .find((option) => option.value === video.id);
          if (existingOption) {
            existingOption.textContent = video.label;
          }
        });
      });
      initializeGazeProviderControls();
      restoreParticipantState();
      if (!sourceVideo.getAttribute('src')) {
        setStudyVideo(selectedStudyVideo.id, { clearAois: true });
      }
      syncSelectedCalibrationProfileState();
      syncSelectedValidationPolicyState();
      syncMergedHeatmapControls();
      resize();
      updateCamera();
      selectWebcamMode();
      setWebcamStatus(state.webcamCalibrationTrained ? 'calibrated' : 'idle');
      syncVideoNotice();
      applyAppMode();
      void autoStartGazeAfterCalibrationReturn();
      animate();
      window.__aoiGetRuntimeQualityMetadata = () => ({
        faceQuality: getFaceQualityRuntimeMetadata(),
        rawGazeDiagnostic: state.rawGazeDiagnostic,
      });
      window.__aoiAppReady = true;
    },
  };
}
