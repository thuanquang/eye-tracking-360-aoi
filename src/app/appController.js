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
import { buildAoiStatsCsv } from '../recording/csvExport.js?v=aoi-stats-csv-1';
import { buildPanoramaHeatmap } from '../recording/heatmapMetrics.js';
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
  findReviewSampleIndex,
  getReviewTimeWindow,
  prepareReviewSamples,
} from '../recording/replay.js?v=recording-replay-1';
import {
  buildColabAoiJob,
  normalizeAoiId,
} from '../aois/aoiGeneration.js?v=viewer-yaw-1';
import {
  extractAoisFromJson,
  extractProjectMetadataFromJson,
  isValidAoi,
  isValidPolygonPoints,
} from '../aois/aoiImport.js?v=aoi-schema-1';
import { buildAoiOverlayModels } from '../aois/aoiOverlay.js?v=aoi-overlay-1';
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
} from '../viewer/projection.js?v=modern-stereo-1';
import {
  applyViewportCalibration,
  distanceBetweenPoints,
  estimateLocalAccuracyErrorPx,
  isGazeInsideViewport,
  isValidationFresh,
  resolveGazeUpdate,
  shouldCaptureFreshGazeSample,
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
} from './studyVideos.js?v=generated-aoi-1';
import { queryAppDom } from './dom.js';
import { createMouseProvider } from '../gaze/providers/mouseProvider.js?v=gaze-providers-1';
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
  let webcamProvider = null;

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
  const MIN_ACCEPTED_REFINEMENT_TARGETS = TARGET_CAPTURE.minAcceptedRefinementTargets;
  const MIN_ACCEPTED_VALIDATION_TARGETS = TARGET_CAPTURE.minAcceptedValidationTargets;
  const LIVE_QUALITY_MAX_EVENTS = LIVE_QUALITY.maxEvents;
  const LIVE_QUALITY_MIN_EVENTS = LIVE_QUALITY.minEvents;
  const LIVE_QUALITY_MAX_BAD_RATE = LIVE_QUALITY.maxBadRate;
  const LIVE_QUALITY_MAX_CONSECUTIVE_BAD = LIVE_QUALITY.maxConsecutiveBad;
  const FACE_QUALITY_MAX_CONSECUTIVE_FAILURES = 3;

  const dom = queryAppDom(document);
  const {
    appShell,
    viewer,
    viewerSection,
    viewerNotice,
    aoiOverlay,
    gazeDot,
    sourceVideo,
    miniMap,
    playVideoButton,
    resetViewButton,
    mouseModeButton,
    webcamModeButton,
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
    cloudAoiPromptsInput,
    cloudAoiSampleIntervalInput,
    cloudAoiMaxPointsInput,
    cloudAoiSimplifyInput,
    exportColabJobButton,
    cloudAoiResultInput,
    recordingFileInput,
    recordButton,
    reviewButton,
    clearButton,
    exportButton,
    exportStatsCsvButton,
    refreshStatsButton,
    aoiStatsTable,
    heatmapCanvas,
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
    participantModeLink,
    participantIdInput,
    participantNameInput,
    participantAgeInput,
    participantConsentInput,
    participantStartButton,
    participantStageLabel,
    participantSessionPanel,
    participantSessionStatus,
    participantCalibrateButton,
    participantAccuracyButton,
    participantRecordButton,
    participantExportButton,
    participantFlowSteps,
    calibrationOverlay,
    calibrationTarget,
    calibrationProgress,
    calibrationDescription,
    cancelCalibrationButton,
  } = dom;

  const state = createInitialAppState();
  let activeCalibrationProfile = null;

  function resetAoiStability() {
    state.aoiStability = createAoiStabilityState();
    state.lastAoiStabilityAt = 0;
  }

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
    return Array.from(select.options).some((option) => option.value === value);
  }

  function setSelectValueIfOptionExists(select, value) {
    if (hasSelectOption(select, value)) {
      select.value = value;
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

  function setStudyVideo(videoId, { clearAois = true } = {}) {
    const video = findStudyVideoById(videoId) || getDefaultStudyVideo();
    selectedStudyVideo = video;
    sourceVideoInfo = videoInfoFromStudyVideo(video);
    studyVideoSelect.value = video.id;
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
    playVideoButton.textContent = 'Play';

    if (clearAois) {
      activeAois = [];
      resetAoiStability();
      aoiSource = 'none';
      registeredProjectMetadata = { video: { ...sourceVideoInfo } };
      state.selectedAoiId = null;
      setManualAnnotationIdle();
      renderAoiList();
      loadGeneratedAoisForStudyVideo(video);
    }

    setNotice(`Selected study video: ${video.label}`);
  }

  function handleStudyVideoChange() {
    setStudyVideo(studyVideoSelect.value);
  }

  function getRequestedAppMode() {
    const params = new URLSearchParams(window.location.search);
    if (!params.has('mode')) {
      return 'select';
    }

    const mode = params.get('mode');
    return mode === 'participant' ? 'participant' : 'admin';
  }

  function setParticipantStage(message) {
    participantStageLabel.textContent = message;
    participantSessionStatus.textContent = message;
  }

  function collectParticipantMetadata() {
    return {
      id: participantIdInput.value.trim(),
      name: participantNameInput.value.trim(),
      age: Number(participantAgeInput.value),
      consent: participantConsentInput.checked,
    };
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

  function updateParticipantStartState() {
    if (state.appMode !== 'participant') {
      return;
    }

    const metadata = collectParticipantMetadata();
    participantStartButton.disabled = !isParticipantMetadataValid(metadata);
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

  function syncParticipantSessionControls() {
    const isParticipant = state.appMode === 'participant';
    const isStarted = Boolean(state.participant.startedAt);

    appShell.classList.toggle('is-participant-started', isParticipant && isStarted);
    participantSessionPanel.hidden = !isParticipant || !isStarted;

    if (!isParticipant) {
      return;
    }

    if (!isStarted) {
      setParticipantFlowStep('setup');
      participantSessionStatus.textContent = 'Waiting to start';
      return;
    }

    participantRecordButton.textContent = state.isRecording ? 'Stop Recording' : 'Start Recording';
    participantRecordButton.classList.toggle('primary', !state.isRecording);

    if (state.isRecording) {
      setParticipantFlowStep('recording');
      setParticipantStage('Recording samples');
    } else if (state.samples.length > 0) {
      setParticipantFlowStep('export');
      setParticipantStage('Recording ready to export');
    } else if (state.accuracyValidated) {
      setParticipantFlowStep('recording');
      setParticipantStage('Ready: start recording');
    } else if (state.webcamStatus === 'calibrated' || state.webcamStatus === 'validating') {
      setParticipantFlowStep('calibration');
      setParticipantStage('Ready: check accuracy');
    } else {
      setParticipantFlowStep('calibration');
    }
  }

  function applyAppMode(mode = getRequestedAppMode()) {
    state.appMode = mode;
    const isParticipant = mode === 'participant';
    const isModeSelect = mode === 'select';

    appShell.classList.toggle('is-mode-select', isModeSelect);
    appShell.classList.toggle('is-participant-mode', isParticipant);
    appShell.classList.toggle('is-admin-mode', mode === 'admin');
    participantPanel.hidden = !isParticipant;
    controlPanel.hidden = isParticipant || isModeSelect;
    viewerSection.hidden = isModeSelect;
    adminModeLink.classList.toggle('is-active', mode === 'admin');
    participantModeLink.classList.toggle('is-active', isParticipant);

    if (isParticipant) {
      setParticipantStage('Enter details');
      updateParticipantStartState();
      setNotice('Enter participant details, then start the session.', true);
      syncParticipantSessionControls();
    }

    if (isModeSelect) {
      setNotice('Choose Admin or Participant mode to begin.', true);
    }
  }

  async function requestParticipantFullscreen() {
    if (!document.fullscreenEnabled || document.fullscreenElement) {
      return;
    }

    try {
      await viewerSection.requestFullscreen();
    } catch (error) {
      setNotice('Fullscreen was not started. Continue in the browser window or use your browser fullscreen control.', true);
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
      startedAt: new Date().toISOString(),
    };
    selectWebcamMode();
    setParticipantStage('Ready: calibrate webcam');
    setNotice('Participant session ready. Calibrate webcam, check accuracy, then start recording.', true);
    syncParticipantSessionControls();
    resize();
    await requestParticipantFullscreen();
  }

  function getExportParticipantMetadata() {
    if (state.appMode !== 'participant' || !state.participant.startedAt) {
      return null;
    }

    return {
      ...state.participant,
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
      manualAoiStatus.textContent = 'Drag polygon vertices to refine the selected AOI.';
    }

    getPolygonHandleScreenPoints(selectedAoi, rect).forEach((point) => {
      appendAoiVertexHandle(fragment, point, point.vertexIndex, selectedAoi.id);
    });
  }

  function drawAoiOverlay() {
    const rect = viewer.getBoundingClientRect();

    if (!rect.width || !rect.height) {
      aoiOverlay.replaceChildren();
      return;
    }

    aoiOverlay.setAttribute('viewBox', `0 0 ${rect.width} ${rect.height}`);
    aoiOverlay.setAttribute('width', String(rect.width));
    aoiOverlay.setAttribute('height', String(rect.height));

    const fragment = document.createDocumentFragment();

    const models = buildAoiOverlayModels({
      aois: getRenderableAois(),
      rect,
      videoRect: getCurrentVideoRect(rect),
      camera: { yaw: state.cameraYaw, pitch: state.cameraPitch, fov: camera.fov },
      supportsColor: (color) => window.CSS?.supports('color', color),
    });

    models.forEach((model) => {
      const shape = document.createElementNS(SVG_NS, 'polygon');
      shape.setAttribute('class', 'aoi-overlay-shape');
      shape.setAttribute('points', model.points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' '));
      shape.setAttribute('fill', model.color);
      shape.setAttribute('fill-opacity', '0.16');
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

  function registerAois(aois, source) {
    const loadedAois = extractAoisFromJson(aois);
    const projectMetadata = extractProjectMetadataFromJson(aois);

    if (!loadedAois.length || !loadedAois.every(isValidAoi)) {
      throw new Error('AOI JSON must contain at least one valid AOI definition.');
    }

    validateAoiVideoCompatibility({
      selectedVideo: selectedStudyVideo,
      metadataVideo: projectMetadata.video,
    });

    activeAois = withEffectiveAoisAnalysisPadding(loadedAois, getViewerAnalysisDimensions());
    resetAoiStability();
    aoiSource = source;
    registeredProjectMetadata = projectMetadata;
    state.selectedAoiId = null;
    applyVideoMetadataControls(registeredProjectMetadata.video || {});
    setManualAnnotationIdle();
    renderAoiList();
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
      const response = await fetch(`./${aoiPath}`, { cache: 'no-store' });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      if (loadId !== generatedAoiLoadId || selectedStudyVideo.id !== video.id) {
        return;
      }

      registerAois(await response.json(), aoiPath);
      setNotice(`Loaded generated AOIs for ${video.label}.`, false);
    } catch (error) {
      if (loadId !== generatedAoiLoadId || selectedStudyVideo.id !== video.id) {
        return;
      }

      activeAois = [];
      resetAoiStability();
      aoiSource = 'none';
      registeredProjectMetadata = { video: { ...sourceVideoInfo } };
      state.selectedAoiId = null;
      setManualAnnotationIdle();
      renderAoiList();
      setNotice(`Could not load generated AOIs for ${video.label}: ${error.message}`);
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
      setNotice(`Loaded AOI JSON: ${file.name}`, false);
    } catch (error) {
      setNotice(`Could not load AOI JSON: ${error.message}`);
    } finally {
      event.target.value = '';
    }
  }

  function stopReviewMode() {
    state.reviewActive = false;
    state.reviewIndex = 0;
    reviewButton.textContent = 'Review Recording';
  }

  function registerRecording(json, source) {
    const samples = prepareReviewSamples(json);

    if (!samples.length) {
      throw new Error('Recording JSON has no valid gaze samples.');
    }

    if (Array.isArray(json.aois)) {
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
    renderAoiStatsPanel();
  }

  async function loadRecordingFile(event) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    try {
      generatedAoiLoadId += 1;
      registerRecording(JSON.parse(await file.text()), file.name);
      setNotice(`Loaded recording JSON: ${file.name}. Click Review Recording to replay tracker samples.`, true);
    } catch (error) {
      setNotice(`Could not load recording JSON: ${error.message}`);
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
  }

  function updateCamera() {
    camera.rotation.order = 'YXZ';
    if (getCurrentProjection() === 'flat') {
      camera.rotation.y = 0;
      camera.rotation.x = 0;
      return;
    }

    camera.rotation.y = THREE.MathUtils.degToRad(state.cameraYaw);
    camera.rotation.x = THREE.MathUtils.degToRad(state.cameraPitch);
  }

  function syncProjectionMesh(rect = viewer.getBoundingClientRect()) {
    const isFlat = getCurrentProjection() === 'flat';
    const transform = getProjectionTextureTransform({
      projection: getCurrentProjection(),
      stereoLayout: getCurrentStereoLayout(),
      eye: sourceVideoInfo.stereoEye || 'left',
    });
    videoTexture.offset.set(transform.offsetX, transform.offsetY);
    videoTexture.repeat.set(transform.repeatX, transform.repeatY);
    videoTexture.updateMatrix();
    videoTexture.needsUpdate = true;
    material.needsUpdate = true;
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
    syncParticipantSessionControls();
  }

  function blockWebGazerMouseTraining() {
    window.__aoiBlockWebGazerMouseTraining = true;
  }

  async function resetWebcamCalibrationData() {
    await webcamProvider?.resetCalibration();

    state.gaze = createDefaultGaze();
    state.rawPageGaze = null;
    state.rawViewerGaze = null;
    state.rawGazeAt = 0;
    clearAccuracyRefinement();
    state.gazeDropReason = null;
    state.droppedGazeSamples = 0;
    state.gazeStreamStats = null;
  }

  function setAccuracySummary(summary) {
    if (!summary || summary.quality === 'untested') {
      accuracyStatusLabel.textContent = 'untested';
      syncParticipantSessionControls();
      return;
    }

    if (state.accuracyValidated && state.correctedAccuracySummary) {
      accuracyStatusLabel.textContent = `validated ${Math.round(state.correctedAccuracySummary.meanPx)}px`;
      syncParticipantSessionControls();
      return;
    }

    accuracyStatusLabel.textContent = `${summary.quality} ${Math.round(summary.meanPx)}px`;
    syncParticipantSessionControls();
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
    modeLabel.textContent = 'mouse';
  }

  function selectWebcamMode() {
    stopReviewMode();
    state.mode = 'webcam';
    state.gaze = createDefaultGaze();
    mouseModeButton.classList.remove('is-active');
    webcamModeButton.classList.add('is-active');
    modeLabel.textContent = 'webcam';
  }

  function resetLiveGazeQuality() {
    state.liveGazeQuality = null;
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
      ? `${policyLabel} failed: ${details}. Recalibrate before recording.`
      : `${policyLabel} failed. Recalibrate before recording.`;
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
    recordButton.textContent = 'Start Recording';
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
    accuracyStatusLabel.textContent = 'recheck needed';

    if (state.isRecording) {
      state.isRecording = false;
      resetRecordingSampleScheduler();
      recordButton.textContent = 'Start Recording';
      recordButton.classList.add('primary');
    }

    setNotice('Webcam tracking became unreliable. Run Check accuracy again before recording.', true);
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
    accuracyStatusLabel.textContent = 'recheck needed';

    if (state.isRecording) {
      state.isRecording = false;
      resetRecordingSampleScheduler();
      recordButton.textContent = 'Start Recording';
      recordButton.classList.add('primary');
    }

    setNotice('Webcam setup may have changed. Run Check accuracy again before recording.', true);
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
    setNotice('Webcam accuracy check expired. Run Check accuracy again before recording.', true);
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
    const update = resolveGazeUpdate({
      previous: previousWebcamGaze,
      next: viewerGaze,
      viewport,
      alpha: GAZE_SMOOTHING_ALPHA,
      maxJumpPx: MAX_GAZE_JUMP_PX,
      boundsMarginPx: GAZE_BOUNDS_MARGIN_PX,
      adaptiveSmoothing: true,
      adaptiveSmoothingOptions: {
        maxAlpha: GAZE_FAST_SMOOTHING_ALPHA,
        fastDistancePx: GAZE_FAST_SMOOTHING_DISTANCE_PX,
      },
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

  async function ensureWebcamGaze() {
    if (!window.webgazer) {
      setNotice('WebGazer did not load. Check internet access or use mouse gaze mode.');
      setWebcamStatus('unloaded');
      return false;
    }

    if (state.webcamStarted) {
      return true;
    }

    setWebcamStatus('starting');

    try {
      webcamProvider = createWebGazerProvider({
        webgazer: window.webgazer,
        onGaze: (data) => {
          if (state.mode !== 'webcam') {
            return;
          }

          processWebcamGaze(data);
        },
        onFaceQuality: handleFaceQuality,
      });
      await webcamProvider.start();
      state.webcamStarted = true;
      blockWebGazerMouseTraining();
      setWebcamStatus('active');
      return true;
    } catch (error) {
      setNotice(`Could not start webcam gaze: ${error.message}`);
      setWebcamStatus('blocked');
      return false;
    }
  }

  async function setWebcamMode() {
    selectWebcamMode();
    setNotice('Webcam gaze is starting. Browser camera permission and calibration may be required.');

    const started = await ensureWebcamGaze();
    if (started) {
      setNotice('Webcam gaze is active. Calibrate before recording for usable AOI data.', false);
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
      setNotice('Target sequence changed. Start calibration again.', true);
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
      playVideoButton.textContent = 'Play';
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
      playVideoButton.textContent = 'Pause';
    } catch (error) {
      setNotice(`Video could not resume after calibration: ${error.message}`);
    }
  }

  function getRawDiagnosticTargetPoint() {
    return RAW_GAZE_DIAGNOSTIC.targets[state.rawGazeDiagnostic.index];
  }

  function setRawDiagnosticStatus(summary = null) {
    if (!summary) {
      rawGazeDiagnosticStatus.textContent = 'Raw gaze diagnostic not run.';
      return;
    }

    rawGazeDiagnosticStatus.textContent = `${summary.quality}: p90 jitter ${Math.round(summary.p90JitterPx)}px, p90 bias ${Math.round(summary.p90BiasPx)}px, Hz ${Math.round(summary.effectiveHz)}.`;
  }

  function positionRawDiagnosticTarget() {
    const point = getRawDiagnosticTargetPoint();
    const cardVerticalPosition = point.y < 50 ? 'bottom' : 'top';
    const cardHorizontalPosition = point.x < 50 ? 'right' : 'left';

    calibrationTarget.style.setProperty('--target-x', `${point.x}%`);
    calibrationTarget.style.setProperty('--target-y', `${point.y}%`);
    calibrationOverlay.dataset.cardPosition = `${cardVerticalPosition}-${cardHorizontalPosition}`;
    calibrationProgress.textContent = `Raw gaze ${state.rawGazeDiagnostic.index + 1} of ${RAW_GAZE_DIAGNOSTIC.targets.length}`;
    calibrationDescription.textContent = 'Look at the target, then click it. This measures raw WebGazer noise without training.';
  }

  async function startRawGazeDiagnostic() {
    stopActiveRecordingForTargetMode();
    await setWebcamMode();

    if (!state.webcamStarted) {
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
      if (Number.isFinite(state.rawViewerGaze?.x) && Number.isFinite(state.rawViewerGaze?.y)) {
        samples.push({
          x: state.rawViewerGaze.x,
          y: state.rawViewerGaze.y,
          atMs: performance.now() - startedAt,
        });
      }
      await delay(RAW_GAZE_DIAGNOSTIC.sampleDelayMs);
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

  async function startCalibration() {
    stopActiveRecordingForTargetMode();
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
      calibrationOverlay.hidden = true;
      setCalibrationProfileSelectLocked(false);
      setValidationPolicySelectLocked(false);
      setWebcamStatus('calibrated');
      setNotice('Webcam calibration complete. Run Check accuracy before recording.', false);
      await restoreVideoAfterTargetMode();
      return;
    }

    positionTargetOverlay();
  }

  async function startAccuracyCheck() {
    stopActiveRecordingForTargetMode();
    await setWebcamMode();

    if (!state.webcamStarted) {
      return;
    }

    const validationPolicy = freezeSelectedValidationPolicyForAccuracy();

    state.targetMode = 'accuracy';
    state.accuracyIndex = 0;
    state.accuracySamples = [];
    state.validationSamples = [];
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
    setWebcamStatus('validating');
    setAccuracySummary(null);
    state.activeValidationPolicyId = validationPolicy.id;
    positionTargetOverlay();
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

    for (let sample = 0; sample < VALIDATION_SAMPLES_PER_POINT; sample += 1) {
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
      calibrationProgress.textContent = `Accuracy target ${state.accuracyIndex + 1} of ${VALIDATION_POINTS.length} - sample ${sample + 1}`;
      await delay(TARGET_SAMPLE_DELAY_MS);
    }

    setTargetCapturing(false);

    const targetSampleSummary = summarizeTargetSamples(gazeSamples, {
      minSamples: Math.max(4, Math.floor(VALIDATION_SAMPLES_PER_POINT * 0.6)),
      maxDispersionPx: TARGET_MAX_DISPERSION_PX,
    });

    if (!targetSampleSummary.accepted) {
      positionTargetOverlay();
      calibrationDescription.textContent = targetSampleSummary.reason === 'unstable'
        ? 'Gaze was too unstable. Keep your face steady and retry this target.'
        : 'Not enough fresh webcam gaze samples. Keep looking at the target and retry.';
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
        setNotice('Accuracy check could not collect enough fresh stable gaze predictions. Keep your face steady, then run Check accuracy again.', true);
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
        setNotice('Accuracy check did not cover enough of the player. Keep your face steady and retry all targets before recording.', true);
        await restoreVideoAfterTargetMode();
        return;
      }

      const correctedValidationSummary = evaluation.correctedValidationSummary;

      state.gazeCorrection = evaluation.validationPassed ? evaluation.liveCalibration : null;
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
      if (correctedValidationSummary.quality === 'untested') {
        setNotice('Accuracy check could not collect gaze predictions. Recalibrate and keep your face steady in view.', true);
      } else {
        setNotice(
          evaluation.validationPassed
            ? `Accuracy validated independently: mean ${Math.round(correctedValidationSummary.meanPx)}px, p90 ${Math.round(correctedValidationSummary.p90Px || 0)}px, capture p90 ${Math.round(correctedValidationSummary.p90DispersionPx || 0)}px, worst target ${Math.round(correctedValidationSummary.maxPx || 0)}px.`
            : evaluation.reason === 'failed-validation-policy'
              ? formatPolicyFailureNotice(evaluation)
            : `Accuracy validation is ${correctedValidationSummary.quality}, mean error ${Math.round(correctedValidationSummary.meanPx)}px, capture p90 ${Math.round(correctedValidationSummary.p90DispersionPx || 0)}px, worst target ${Math.round(correctedValidationSummary.maxPx || 0)}px. Recalibrate before recording.`,
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

  function getCurrentPanoramaPoint() {
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
      aois: resolveAoisForAnalysis(activeAois, timeSec, analysisDimensions),
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

  function updateReadout() {
    const current = getCurrentPanoramaPoint();

    cameraReadout.textContent = `yaw ${formatDegrees(state.cameraYaw)}, pitch ${formatDegrees(state.cameraPitch)}`;
    updateGazeQualityReadout();

    if (!current) {
      screenReadout.textContent = state.mode === 'webcam' && state.gazeDropReason === 'out-of-bounds'
        ? 'webcam gaze outside viewer'
        : state.mode === 'webcam' && state.gazeDropReason === 'raw-out-of-bounds'
          ? 'webcam face/gaze lost'
          : state.mode === 'webcam' && state.gazeDropReason === 'stale'
            ? 'webcam gaze stale'
            : state.mode === 'webcam' ? 'waiting for webcam gaze' : 'outside viewer';
      panoramaReadout.textContent = '--';
      hitReadout.textContent = 'none';
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

  function drawMiniMap() {
    const ctx = miniMap.getContext('2d');
    const width = miniMap.width;
    const height = miniMap.height;

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

    resolveAoisAtTime(activeAois, sourceVideo.currentTime || 0).forEach((aoi) => {
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

    const trustedForAoiAnalysis = state.mode !== 'webcam' || state.accuracyValidated;

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
    syncParticipantSessionControls();
  }

  function animate(now = 0) {
    invalidateExpiredAccuracy(now);
    syncReviewPlaybackWindow();
    syncProjectionMesh();
    updateCamera();
    updateReadout();
    drawAoiOverlay();
    drawMiniMap();
    maybeSample(now);
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
  }

  async function toggleVideoPlayback() {
    try {
      if (sourceVideo.paused) {
        await sourceVideo.play();
        playVideoButton.textContent = 'Pause';
        setNotice('', false);
      } else {
        sourceVideo.pause();
        playVideoButton.textContent = 'Play';
      }
    } catch (error) {
      setNotice(`Video could not play: ${error.message}`);
    }
  }

  function resetView() {
    state.cameraYaw = 0;
    state.cameraPitch = 0;
    updateCamera();
  }

  function canRecordCurrentMode() {
    if (state.mode !== 'webcam') {
      return true;
    }

    return state.accuracyValidated;
  }

  function toggleRecording() {
    const rawDiagnostic = state.rawGazeDiagnostic.latestSummary;
    if (!state.isRecording && state.mode === 'webcam' && rawDiagnostic?.shouldBlockRecording) {
      setNotice(`${rawDiagnostic.reason} Recording blocked.`, true);
      return;
    }

    if (!state.isRecording && !canRecordCurrentMode()) {
      setNotice('Run Check accuracy before recording webcam AOI samples. Recalibrate if the result is poor.', true);
      return;
    }

    const startingRecording = !state.isRecording;

    if (startingRecording) {
      state.gazeStreamStats = null;
      activeStatsSampleSource = 'live';
    }

    state.isRecording = !state.isRecording;
    resetRecordingSampleScheduler();
    recordButton.textContent = state.isRecording ? 'Stop Recording' : 'Start Recording';
    recordButton.classList.toggle('primary', !state.isRecording);
    syncParticipantSessionControls();
    if (!state.isRecording) {
      renderAoiStatsPanel();
    }
  }

  function clearSamples() {
    state.samples = [];
    state.gazeStreamStats = null;
    activeStatsSampleSource = 'live';
    resetAoiStability();
    resetRecordingSampleScheduler();
    sampleCount.textContent = '0';
    syncParticipantSessionControls();
    renderAoiStatsPanel();
  }

  async function startReviewMode() {
    if (!state.reviewSamples.length) {
      setNotice('Load a recording JSON before reviewing.');
      return;
    }

    state.reviewActive = true;
    state.mode = 'review';
    state.isRecording = false;
    activeStatsSampleSource = 'review';
    resetRecordingSampleScheduler();
    recordButton.textContent = 'Start Recording';
    recordButton.classList.add('primary');
    mouseModeButton.classList.remove('is-active');
    webcamModeButton.classList.remove('is-active');
    modeLabel.textContent = 'review';
    reviewButton.textContent = 'Stop Review';
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
      ? ` (${(reviewWindow.end - reviewWindow.start).toFixed(1)}s sample window)`
      : '';

    try {
      await sourceVideo.play();
      playVideoButton.textContent = 'Pause';
      setNotice(`Reviewing ${state.reviewSamples.length} samples from ${state.reviewSource}${windowLabel}.`, true);
    } catch (error) {
      playVideoButton.textContent = 'Play';
      setNotice(`Reviewing ${state.reviewSamples.length} samples from ${state.reviewSource}${windowLabel}. Press Play to replay over time.`, true);
    }
  }

  async function toggleReviewMode() {
    if (state.reviewActive) {
      stopReviewMode();
      state.mode = 'mouse';
      state.gaze = createDefaultGaze({ source: 'mouse' });
      mouseModeButton.classList.add('is-active');
      webcamModeButton.classList.remove('is-active');
      modeLabel.textContent = 'mouse';
      setNotice('Recording review stopped.', false);
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

  function createStatsCell(value, className = '') {
    const cell = document.createElement('td');
    cell.textContent = value;
    if (className) {
      cell.className = className;
    }

    return cell;
  }

  function getAoiMetricEntries(namedAoiMetrics) {
    const perAoi = namedAoiMetrics?.perAoi;

    if (Array.isArray(perAoi)) {
      return perAoi.map((metrics, index) => [metrics?.id ?? String(index), metrics]);
    }

    return perAoi && typeof perAoi === 'object' ? Object.entries(perAoi) : [];
  }

  function renderAoiStatsTable(namedAoiMetrics, samples) {
    const body = aoiStatsTable.tBodies[0] || aoiStatsTable.createTBody();
    const entries = getAoiMetricEntries(namedAoiMetrics)
      .filter(([, metrics]) => metrics && typeof metrics === 'object');

    if (!samples.length || !entries.length) {
      const row = document.createElement('tr');
      const cell = createStatsCell(
        samples.length ? 'No AOI metrics available for the current regions.' : 'No samples yet. Record or load a session to populate AOI stats.',
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
        createStatsCell(formatMetricMilliseconds(metrics.timeToFirstFixationMs)),
        createStatsCell(formatMetricNumber(metrics.percentageOfViewingTime, '%')),
      );

      return row;
    });

    body.replaceChildren(...rows);
  }

  function drawHeatmapEmptyState(ctx, width, height, message) {
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#fcfcfd';
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = '#e4e7ec';
    ctx.strokeRect(0.5, 0.5, width - 1, height - 1);
    ctx.fillStyle = '#667085';
    ctx.font = '12px Barlow, Aptos, Segoe UI, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(message, width / 2, height / 2);
  }

  function drawHeatmapPreview(samples) {
    const ctx = heatmapCanvas.getContext('2d');

    if (!ctx) {
      return;
    }

    const width = heatmapCanvas.width;
    const height = heatmapCanvas.height;
    const heatmap = buildPanoramaHeatmap(samples, {
      columns: 36,
      rows: 18,
      sampleIntervalMs: recordingSampleScheduler.intervalMs,
      trustedOnly: true,
    });

    if (!heatmap.bins.length) {
      drawHeatmapEmptyState(
        ctx,
        width,
        height,
        samples.length ? 'No trusted panorama samples' : 'No heatmap samples yet',
      );
      return;
    }

    const cellWidth = width / heatmap.columns;
    const cellHeight = height / heatmap.rows;
    const maxWeight = Math.max(...heatmap.bins.map((bin) => bin.weightSec), 0.001);

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#fcfcfd';
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = 'rgba(16, 24, 40, 0.08)';
    ctx.lineWidth = 1;

    for (let column = 0; column <= heatmap.columns; column += 1) {
      const x = Math.round(column * cellWidth) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }

    for (let row = 0; row <= heatmap.rows; row += 1) {
      const y = Math.round(row * cellHeight) + 0.5;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    heatmap.bins.forEach((bin) => {
      const intensity = Math.min(1, bin.weightSec / maxWeight);
      const alpha = 0.24 + (0.62 * intensity);
      ctx.fillStyle = `rgba(252, 119, 83, ${alpha.toFixed(3)})`;
      ctx.fillRect(
        bin.column * cellWidth,
        bin.row * cellHeight,
        Math.ceil(cellWidth),
        Math.ceil(cellHeight),
      );
    });
  }

  function renderAoiStatsPanel() {
    const samples = getActiveStatsSamples();
    const { namedAoiMetrics } = buildCurrentNamedAoiMetrics(samples);

    renderAoiStatsTable(namedAoiMetrics, samples);
    drawHeatmapPreview(samples);
  }

  function exportSamples() {
    syncSelectedCalibrationProfileState();
    syncSelectedValidationPolicyState();
    const activeStatsSamples = getActiveStatsSamples();
    const exportState = activeStatsSampleSource === 'live'
      ? state
      : { ...state, samples: activeStatsSamples };
    const { exportAois, namedAoiMetrics } = buildCurrentNamedAoiMetrics(activeStatsSamples);
    const video = buildVideoPackageMetadata();
    const payload = buildExportPayload({
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
    downloadJson(payload, `aoi-samples-${Date.now()}.json`);
    renderAoiStatsPanel();
  }

  function exportStatsCsv() {
    const { namedAoiMetrics } = buildCurrentNamedAoiMetrics(getActiveStatsSamples());
    const csv = buildAoiStatsCsv({ namedAoiMetrics });

    downloadText(csv, `aoi-stats-${Date.now()}.csv`, 'text/csv;charset=utf-8');
    setNotice('AOI stats CSV exported.', true);
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
    manualAoiStatus.textContent = 'Click around the object edge. Double-click to finish.';
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
      manualAoiStatus.textContent = 'Polygon needs a non-overlapping shape with measurable area.';
      setNotice('Polygon AOI needs a non-overlapping shape with measurable area.');
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
    aoiSource = 'manual';
    cancelPolygonAnnotation();
    renderAoiList();
    drawAoiOverlay();
    drawMiniMap();
    setNotice(`Added polygon AOI: ${label}`, true);
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

    renderAoiList({ focusAoiId: selectedAoi.id });
    drawAoiOverlay();
    drawMiniMap();
    setNotice(`Updated AOI: ${label}`, true);
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
    state.selectedAoiId = null;
    setManualAnnotationIdle('Click Draw Polygon, then click around the object edge.');
    renderAoiList();
    drawAoiOverlay();
    drawMiniMap();
    setNotice(`Deleted AOI: ${selectedAoi.label}`, true);
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
    manualAoiStatus.textContent = 'Move to a polygon keyframe to edit dynamic vertices.';
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
    manualAoiStatus.textContent = 'Dragging polygon vertex.';
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
    manualAoiStatus.textContent = 'Drag polygon vertices to refine the selected AOI.';
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
    aoiSource = 'manual';
    renderAoiList();
    drawAoiOverlay();
    drawMiniMap();
    setNotice(`Added AOI: ${label}`, true);
  }

  function exportColabAoiJob() {
    const job = buildColabAoiJob({
      video: buildVideoPackageMetadata(),
      prompts: cloudAoiPromptsInput.value,
      sampleIntervalSec: Number(cloudAoiSampleIntervalInput.value),
      maxPolygonPoints: cloudAoiMaxPointsInput.valueAsNumber,
      polygonSimplificationEpsilon: cloudAoiSimplifyInput.valueAsNumber,
    });

    downloadJson(job, `colab-aoi-job-${Date.now()}.json`);
    setNotice('Colab AOI job exported. Upload it with the video in the Colab notebook.', true);
  }

  async function loadCloudAoiResultFile(event) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    try {
      generatedAoiLoadId += 1;
      registerAois(JSON.parse(await file.text()), file.name);
      setNotice(`Imported Colab AOIs: ${file.name}`, false);
    } catch (error) {
      setNotice(`Could not import Colab AOIs: ${error.message}`);
    } finally {
      event.target.value = '';
    }
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
    setNotice(`Loaded local video: ${file.name}`);
    playVideoButton.textContent = 'Play';
  }

  function syncVideoNotice() {
    if (state.reviewActive || sourceVideo.readyState < HTMLMediaElement.HAVE_METADATA) {
      return;
    }

    setNotice('Video loaded. Press Play, drag to rotate, then start recording.', false);
  }

  return {
    start() {
      sourceVideo.addEventListener('loadedmetadata', syncVideoNotice);
      sourceVideo.addEventListener('canplay', syncVideoNotice);

      sourceVideo.addEventListener('error', () => {
        setNotice('Could not load the selected study video. Check that the study clips exist under assets/clips and assets/clips-2d.');
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
      refreshStatsButton.addEventListener('click', renderAoiStatsPanel);
      studyVideoSelect.addEventListener('change', handleStudyVideoChange);
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
      exportColabJobButton.addEventListener('click', exportColabAoiJob);
      cloudAoiResultInput.addEventListener('change', loadCloudAoiResultFile);
      recordingFileInput.addEventListener('change', loadRecordingFile);
      participantIdInput.addEventListener('input', updateParticipantStartState);
      participantNameInput.addEventListener('input', updateParticipantStartState);
      participantAgeInput.addEventListener('input', updateParticipantStartState);
      participantConsentInput.addEventListener('change', updateParticipantStartState);
      participantStartButton.addEventListener('click', startParticipantSession);
      participantCalibrateButton.addEventListener('click', startCalibration);
      participantAccuracyButton.addEventListener('click', startAccuracyCheck);
      participantRecordButton.addEventListener('click', toggleRecording);
      participantExportButton.addEventListener('click', exportSamples);
      window.addEventListener('resize', handleResize);
      window.addEventListener('blur', handleWindowFocusLoss);
      document.addEventListener('visibilitychange', handleVisibilityChange);

      renderAoiList();
      STUDY_VIDEOS.forEach((video) => {
        const existingOption = Array.from(studyVideoSelect.options)
          .find((option) => option.value === video.id);
        if (existingOption) {
          existingOption.textContent = video.label;
        }
      });
      setStudyVideo(selectedStudyVideo.id, { clearAois: true });
      syncSelectedCalibrationProfileState();
      syncSelectedValidationPolicyState();
      resize();
      updateCamera();
      selectWebcamMode();
      setWebcamStatus('idle');
      syncVideoNotice();
      applyAppMode();
      animate();
      window.__aoiGetRuntimeQualityMetadata = () => ({
        faceQuality: getFaceQualityRuntimeMetadata(),
        rawGazeDiagnostic: state.rawGazeDiagnostic,
      });
      window.__aoiAppReady = true;
    },
  };
}
