import * as THREE from 'three';

import {
  classifyAoisWithUncertainty,
  hitTestAois,
  normalizeYaw,
  panoramaPointToScreen,
  resolveAoisAtTime,
  screenPointToVideoPoint,
  screenPointToYawPitch,
  screenUncertaintyToYawPitch,
} from './aois/aoiMath.js?v=aoi-anchor-4';
import { buildNamedAoiMetrics } from './recording/analysisMetrics.js?v=ui-modes-1';
import { buildRecordingSample } from './recording/sampleBuilder.js?v=recording-export-1';
import {
  buildExportPayload,
  buildExportSummary as createExportSummary,
  buildProjectPackage as createProjectPackage,
  buildVideoPackageMetadata as createVideoPackageMetadata,
} from './recording/recordingExport.js?v=recording-export-1';
import {
  findReviewSampleIndex,
  getReviewTimeWindow,
  prepareReviewSamples,
} from './recording/replay.js?v=recording-replay-1';
import {
  buildColabAoiJob,
  normalizeAoiId,
} from './aois/aoiGeneration.js?v=colab-aoi-1';
import {
  extractAoisFromJson,
  extractProjectMetadataFromJson,
  isValidAoi,
} from './aois/aoiImport.js?v=aoi-schema-1';
import { buildAoiOverlayModels } from './aois/aoiOverlay.js?v=aoi-overlay-1';
import {
  applyViewportCalibration,
  buildAccuracyCorrection,
  buildLocalAccuracyErrorModel,
  distanceBetweenPoints,
  estimateLocalAccuracyErrorPx,
  hasSufficientSpatialCoverage,
  isGazeInsideViewport,
  isAccuracyValidationUsable,
  isValidationFresh,
  normalizeAccuracySample,
  resolveGazeUpdate,
  shouldCaptureFreshGazeSample,
  summarizeTargetSamples,
  summarizeAccuracy,
  updateLiveGazeQuality,
} from './gaze/gazeQuality.js';
import {
  DEFAULT_VALIDATION_MAX_AGE_MS,
  GAZE_SMOOTHING,
  GAZE_TIMING,
  LIVE_QUALITY,
  RECORDING_SAMPLE_INTERVAL_MS,
  REVIEW_GAZE_EDGE_PADDING_PX,
  REVIEW_LOOP_GRACE_SEC,
  SVG_NS,
  TARGET_CAPTURE,
} from './app/constants.js';
import {
  createDefaultAois,
  createDefaultGaze,
  createInitialAppState,
  createInitialVideoInfo,
} from './app/state.js';
import { queryAppDom } from './app/dom.js';
import { createWebGazerProvider } from './gaze/providers/webgazerProvider.js?v=gaze-providers-1';

let activeAois = createDefaultAois();
let aoiSource = 'default';
let registeredProjectMetadata = {};
let sourceVideoInfo = createInitialVideoInfo();
let webcamProvider = null;

const SAMPLE_INTERVAL_MS = RECORDING_SAMPLE_INTERVAL_MS;
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
const CALIBRATION_POINTS = [
  { x: 50, y: 50 },
  { x: 12, y: 14 },
  { x: 88, y: 86 },
  { x: 88, y: 14 },
  { x: 12, y: 86 },
  { x: 50, y: 14 },
  { x: 50, y: 86 },
  { x: 12, y: 50 },
  { x: 88, y: 50 },
  { x: 28, y: 28 },
  { x: 72, y: 72 },
  { x: 72, y: 28 },
  { x: 28, y: 72 },
  { x: 50, y: 50 },
];
const ACCURACY_REFINEMENT_POINTS = [
  { x: 50, y: 50 },
  { x: 20, y: 22 },
  { x: 80, y: 22 },
  { x: 20, y: 78 },
  { x: 80, y: 78 },
  { x: 50, y: 24 },
  { x: 50, y: 76 },
  { x: 24, y: 50 },
  { x: 76, y: 50 },
];
const ACCURACY_VALIDATION_POINTS = [
  { x: 35, y: 35 },
  { x: 65, y: 35 },
  { x: 35, y: 65 },
  { x: 65, y: 65 },
  { x: 50, y: 38 },
  { x: 50, y: 62 },
  { x: 38, y: 50 },
  { x: 62, y: 50 },
];
const VALIDATION_POINTS = [
  ...ACCURACY_REFINEMENT_POINTS,
  ...ACCURACY_VALIDATION_POINTS,
];
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
  videoFileInput,
  aoiFileInput,
  projectionSelect,
  stereoLayoutSelect,
  manualAoiLabelInput,
  manualAoiSizeInput,
  manualAoiColorInput,
  addManualAoiButton,
  cloudAoiPromptsInput,
  cloudAoiSampleIntervalInput,
  exportColabJobButton,
  cloudAoiResultInput,
  recordingFileInput,
  recordButton,
  reviewButton,
  clearButton,
  exportButton,
  sampleCount,
  modeLabel,
  webcamStatusLabel,
  accuracyStatusLabel,
  aoiSourceLabel,
  screenReadout,
  cameraReadout,
  panoramaReadout,
  hitReadout,
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

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1100);
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
viewer.appendChild(renderer.domElement);

const geometry = new THREE.SphereGeometry(500, 64, 40);
geometry.scale(-1, 1, 1);
const videoTexture = new THREE.VideoTexture(sourceVideo);
videoTexture.colorSpace = THREE.SRGBColorSpace;
const material = new THREE.MeshBasicMaterial({ map: videoTexture });
const sphere = new THREE.Mesh(geometry, material);
scene.add(sphere);

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
  return projectionSelect?.value || sourceVideoInfo.projection || 'equirectangular';
}

function getCurrentStereoLayout() {
  return stereoLayoutSelect?.value || sourceVideoInfo.stereoLayout || 'mono';
}

function syncSourceVideoMetadataFromControls() {
  sourceVideoInfo = {
    ...sourceVideoInfo,
    projection: getCurrentProjection(),
    stereoLayout: getCurrentStereoLayout(),
  };
}

function applyVideoMetadataControls(video = {}) {
  if (video.projection && projectionSelect.querySelector(`option[value="${video.projection}"]`)) {
    projectionSelect.value = video.projection;
  }

  if (video.stereoLayout && stereoLayoutSelect.querySelector(`option[value="${video.stereoLayout}"]`)) {
    stereoLayoutSelect.value = video.stereoLayout;
  }

  syncSourceVideoMetadataFromControls();
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

function getRenderableAois() {
  if (state.reviewActive && state.reviewSamples.length) {
    const sampleIndex = findReviewSampleIndex(state.reviewSamples, sourceVideo.currentTime || 0);
    const sample = state.reviewSamples[sampleIndex >= 0 ? sampleIndex : 0];

    if (Array.isArray(sample?.activeAois) && sample.activeAois.length) {
      return sample.activeAois;
    }

    return resolveAoisAtTime(activeAois, sample?.t || 0);
  }

  return resolveAoisAtTime(activeAois, sourceVideo.currentTime || 0);
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

  aoiOverlay.replaceChildren(fragment);
}

function renderAoiList() {
  aoiSourceLabel.textContent = aoiSource;
  aoiList.innerHTML = activeAois.map((aoi) => {
    const bounds = aoi.space === 'video'
      ? `x ${aoi.xMin} to ${aoi.xMax}, y ${aoi.yMin} to ${aoi.yMax}`
      : `yaw ${aoi.yawMin} to ${aoi.yawMax}, pitch ${aoi.pitchMin} to ${aoi.pitchMax}`;
    const dynamicLabel = Array.isArray(aoi.keyframes) && aoi.keyframes.length ? ' (dynamic)' : '';

    return `
      <li>
        <span class="swatch" style="background: ${aoi.color}"></span>
        <span>
          <strong>${aoi.label}${dynamicLabel}</strong>
          <span>${bounds}</span>
        </span>
      </li>
    `;
  }).join('');
}

function registerAois(aois, source) {
  const loadedAois = extractAoisFromJson(aois);

  if (!loadedAois.length || !loadedAois.every(isValidAoi)) {
    throw new Error('AOI JSON must contain at least one valid AOI box.');
  }

  activeAois = loadedAois;
  aoiSource = source;
  registeredProjectMetadata = extractProjectMetadataFromJson(aois);
  applyVideoMetadataControls(registeredProjectMetadata.video || {});
  renderAoiList();
}

async function loadAois() {
  try {
    const response = await fetch('./assets/aois.json', { cache: 'no-store' });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    registerAois(await response.json(), 'assets/aois.json');
  } catch (error) {
    activeAois = createDefaultAois();
    aoiSource = 'default';
    registeredProjectMetadata = {};
    applyVideoMetadataControls(sourceVideoInfo);
    renderAoiList();
  }
}

async function loadAoiFile(event) {
  const file = event.target.files?.[0];

  if (!file) {
    return;
  }

  try {
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
  reviewButton.disabled = false;
  sampleCount.textContent = String(samples.length);
}

async function loadRecordingFile(event) {
  const file = event.target.files?.[0];

  if (!file) {
    return;
  }

  try {
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
}

function updateCamera() {
  camera.rotation.order = 'YXZ';
  camera.rotation.y = THREE.MathUtils.degToRad(state.cameraYaw);
  camera.rotation.x = THREE.MathUtils.degToRad(state.cameraPitch);
}

function setWebcamStatus(status) {
  state.webcamStatus = status;
  webcamStatusLabel.textContent = status;
  syncParticipantSessionControls();
}

function disableWebGazerMouseTraining() {
  window.__aoiBlockWebGazerMouseTraining = true;
  if (window.webgazer?.removeMouseEventListeners) {
    window.webgazer.removeMouseEventListeners();
  }
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
  state.liveGazeQuality = null;
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
  const rawBoundsMargin = Math.max(rect.width, rect.height) * RAW_GAZE_BOUNDS_MARGIN_RATIO;

  if (!isGazeInsideViewport(rawViewerGaze, viewport, rawBoundsMargin)) {
    state.droppedGazeSamples += 1;
    if (canHoldLastWebcamGaze(now)) {
      holdLastWebcamGaze('raw-out-of-bounds');
      return;
    }

    state.gaze = createDefaultGaze();
    state.gazeDropReason = 'raw-out-of-bounds';
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
      holdLastWebcamGaze(update.reason);
      return;
    }

    state.gaze = update.gaze;
    state.gazeDropReason = update.reason;
    registerLiveGazeQualityEvent({ accepted: false, reason: update.reason });
    return;
  }

  state.gaze = update.gaze;
  state.lastAcceptedGazeAt = now;
  state.gazeDropReason = null;
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
    });
    await webcamProvider.start();
    state.webcamStarted = true;
    disableWebGazerMouseTraining();
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
  return state.targetMode === 'accuracy' ? VALIDATION_POINTS : CALIBRATION_POINTS;
}

function positionTargetOverlay() {
  const points = targetPointsForMode();
  const index = state.targetMode === 'accuracy' ? state.accuracyIndex : state.calibrationIndex;
  const point = points[index];
  const label = state.targetMode === 'accuracy' ? 'Accuracy target' : 'Target';
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

async function startCalibration() {
  await setWebcamMode();

  if (!state.webcamStarted) {
    return;
  }

  await resetWebcamCalibrationData();
  state.targetMode = 'calibration';
  state.calibrationIndex = 0;
  pauseVideoForTargetMode();
  calibrationOverlay.hidden = false;
  setWebcamStatus('calibrating');
  positionTargetOverlay();
}

function cancelCalibration() {
  calibrationOverlay.hidden = true;
  setTargetCapturing(false);
  setWebcamStatus(state.webcamStarted ? 'active' : 'idle');
  void restoreVideoAfterTargetMode();
}

async function captureCalibrationPoint() {
  disableWebGazerMouseTraining();

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

  calibrationProgress.textContent = `Target ${state.calibrationIndex + 1} of ${CALIBRATION_POINTS.length} - hold steady`;
  await delay(TARGET_SETTLE_DELAY_MS);

  for (let sample = 0; sample < CALIBRATION_SAMPLES_PER_POINT; sample += 1) {
    calibrationProgress.textContent = `Target ${state.calibrationIndex + 1} of ${CALIBRATION_POINTS.length} - training ${sample + 1}`;
    webcamProvider.recordCalibrationPoint({ x, y });
    await delay(TARGET_SAMPLE_DELAY_MS);
  }

  setTargetCapturing(false);
  state.calibrationIndex += 1;

  if (state.calibrationIndex >= CALIBRATION_POINTS.length) {
    calibrationOverlay.hidden = true;
    setWebcamStatus('calibrated');
    setNotice('Webcam calibration complete. Run Check accuracy before recording.', false);
    await restoreVideoAfterTargetMode();
    return;
  }

  positionTargetOverlay();
}

async function startAccuracyCheck() {
  await setWebcamMode();

  if (!state.webcamStarted) {
    return;
  }

  state.targetMode = 'accuracy';
  state.accuracyIndex = 0;
  state.accuracySamples = [];
  state.validationSamples = [];
  state.accuracyValidated = false;
  state.accuracyValidatedAt = null;
  state.accuracyInvalidationReason = null;
  resetLiveGazeQuality();
  state.refinementAccuracySummary = null;
  state.accuracySummary = null;
  state.correctedAccuracySummary = null;
  state.localAccuracyErrorModel = null;
  pauseVideoForTargetMode();
  calibrationOverlay.hidden = false;
  setWebcamStatus('validating');
  setAccuracySummary(null);
  positionTargetOverlay();
}

async function captureAccuracyPoint() {
  disableWebGazerMouseTraining();

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
    if (
      state.accuracySamples.length < MIN_ACCEPTED_REFINEMENT_TARGETS ||
      state.validationSamples.length < MIN_ACCEPTED_VALIDATION_TARGETS
    ) {
      const summary = summarizeAccuracy([]);

      state.gazeCorrection = null;
      state.refinementAccuracySummary = null;
      state.accuracySummary = summary;
      state.correctedAccuracySummary = null;
      state.localAccuracyErrorModel = null;
      state.accuracyValidated = false;
      state.accuracyValidatedAt = null;
      calibrationOverlay.hidden = true;
      setWebcamStatus('calibrated');
      setAccuracySummary(summary);
      setNotice('Accuracy check could not collect enough fresh stable gaze predictions. Keep your face steady, then run Check accuracy again.', true);
      await restoreVideoAfterTargetMode();
      return;
    }

    const normalizedRefinementSamples = state.accuracySamples.map((sample) => (
      normalizeAccuracySample(sample, sample.viewport)
    ));
    const normalizedValidationSamples = state.validationSamples.map((sample) => (
      normalizeAccuracySample(sample, sample.viewport)
    ));

    if (
      !hasSufficientSpatialCoverage(normalizedRefinementSamples, { minXRange: 0.45, minYRange: 0.45 }) ||
      !hasSufficientSpatialCoverage(normalizedValidationSamples, { minXRange: 0.22, minYRange: 0.22 })
    ) {
      const summary = summarizeAccuracy([]);

      state.gazeCorrection = null;
      state.refinementAccuracySummary = null;
      state.accuracySummary = summary;
      state.correctedAccuracySummary = null;
      state.localAccuracyErrorModel = null;
      state.accuracyValidated = false;
      state.accuracyValidatedAt = null;
      calibrationOverlay.hidden = true;
      setWebcamStatus('calibrated');
      setAccuracySummary(summary);
      setNotice('Accuracy check did not cover enough of the player. Keep your face steady and retry all targets before recording.', true);
      await restoreVideoAfterTargetMode();
      return;
    }

    const refinement = buildAccuracyCorrection(normalizedRefinementSamples, {
      maxCorrectedMeanPx: 0.2,
    });
    const correctedValidationSamples = state.validationSamples.map((sample) => ({
      ...sample,
      gaze: applyViewportCalibration(sample.gaze, refinement.calibration, sample.viewport),
    }));
    const validationSummary = summarizeAccuracy(state.validationSamples);
    const correctedValidationSummary = summarizeAccuracy(correctedValidationSamples);
    const validationPassed = isAccuracyValidationUsable(correctedValidationSummary, {
      minSamples: MIN_ACCEPTED_VALIDATION_TARGETS,
    });
    const finalCorrection = validationPassed
      ? buildAccuracyCorrection([
        ...normalizedRefinementSamples,
        ...normalizedValidationSamples,
      ], {
        maxCorrectedMeanPx: 0.2,
      })
      : null;
    const liveCalibration = finalCorrection?.accepted
      ? finalCorrection.calibration
      : refinement.calibration;

    state.gazeCorrection = validationPassed ? liveCalibration : null;
    state.refinementAccuracySummary = refinement.correctedSummary;
    state.accuracySummary = validationSummary;
    state.correctedAccuracySummary = correctedValidationSummary;
    state.localAccuracyErrorModel = validationPassed
      ? buildLocalAccuracyErrorModel(correctedValidationSamples)
      : null;
    state.accuracyValidated = validationPassed;
    state.accuracyValidatedAt = validationPassed ? performance.now() : null;
    state.accuracyInvalidationReason = null;
    resetLiveGazeQuality();
    calibrationOverlay.hidden = true;
    setWebcamStatus('calibrated');
    setAccuracySummary(correctedValidationSummary);
    if (correctedValidationSummary.quality === 'untested') {
      setNotice('Accuracy check could not collect gaze predictions. Recalibrate and keep your face steady in view.', true);
    } else {
      setNotice(
        validationPassed
          ? `Accuracy validated independently: mean ${Math.round(correctedValidationSummary.meanPx)}px, p90 ${Math.round(correctedValidationSummary.p90Px || 0)}px, capture p90 ${Math.round(correctedValidationSummary.p90DispersionPx || 0)}px, worst target ${Math.round(correctedValidationSummary.maxPx || 0)}px.`
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

  return {
    gaze: state.gaze,
    timeSec: sample.t,
    aois: Array.isArray(sample.activeAois) && sample.activeAois.length
      ? sample.activeAois
      : resolveAoisAtTime(activeAois, sample.t),
    viewport: {
      width: rect.width,
      height: rect.height,
    },
    point: sample.panorama,
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
      holdLastWebcamGaze('stale');
    } else {
      state.gaze = { ...state.gaze, visible: false, held: false };
      state.gazeDropReason = 'stale';
      registerLiveGazeQualityEvent({ accepted: false, reason: 'stale' });
      return null;
    }
  }

  if (state.gaze.held && !canHoldLastWebcamGaze(now)) {
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

  return {
    gaze,
    timeSec,
    aois: resolveAoisAtTime(activeAois, timeSec),
    viewport: {
      width: rect.width,
      height: rect.height,
    },
    point: screenPointToYawPitch({
      x: gaze.x,
      y: gaze.y,
      width: rect.width,
      height: rect.height,
      cameraYaw: state.cameraYaw,
      cameraPitch: state.cameraPitch,
      fov: camera.fov,
    }),
    videoPoint: screenPointToVideoPoint({
      x: gaze.x,
      y: gaze.y,
      width: rect.width,
      height: rect.height,
    }),
  };
}

function classifyVideoAois(point, aois) {
  const exactHits = hitTestAois(point, aois);

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

function updateReadout() {
  const current = getCurrentPanoramaPoint();

  cameraReadout.textContent = `yaw ${formatDegrees(state.cameraYaw)}, pitch ${formatDegrees(state.cameraPitch)}`;

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
    ? classifyVideoAois(current.videoPoint, current.aois)
    : classifyAoisWithUncertainty(current.point, current.aois, angularUncertainty);

  state.latestPoint = current.point;
  state.latestHits = classification.exactHits;
  state.latestAois = current.aois;
  state.latestAoiClassification = classification;
  state.latestUncertainty = {
    px: uncertaintyPx,
    ...angularUncertainty,
  };

  gazeDot.style.transform = `translate(${current.gaze.x}px, ${current.gaze.y}px)`;
  screenReadout.textContent = `x ${Math.round(current.gaze.x)}, y ${Math.round(current.gaze.y)}`;
  panoramaReadout.textContent = isFlatVideo
    ? `video x ${current.videoPoint.x.toFixed(3)}, y ${current.videoPoint.y.toFixed(3)}`
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
    if (aoi.space === 'video') {
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
  if (state.reviewActive) {
    return;
  }

  if (!state.isRecording || !state.latestPoint || now - state.lastSampleAt < SAMPLE_INTERVAL_MS) {
    return;
  }

  if (state.mode === 'webcam' && state.gaze.held) {
    return;
  }

  state.lastSampleAt = now;
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
      droppedGazeSamples: state.droppedGazeSamples,
    },
    gaze: state.gaze,
    rawGaze: state.rawViewerGaze,
    camera: {
      yaw: state.cameraYaw,
      pitch: state.cameraPitch,
      fov: camera.fov,
    },
    panorama: state.latestPoint,
    hits: state.latestHits,
    activeAois: state.latestAois,
    classification: state.latestAoiClassification,
    uncertainty: state.latestUncertainty,
  }));
  sampleCount.textContent = String(state.samples.length);
  syncParticipantSessionControls();
}

function animate(now = 0) {
  invalidateExpiredAccuracy(now);
  syncReviewPlaybackWindow();
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

  viewer.classList.add('is-dragging');
  viewer.setPointerCapture(event.pointerId);
  viewer.dataset.lastX = String(event.clientX);
  viewer.dataset.lastY = String(event.clientY);
}

function drag(event) {
  const rect = viewer.getBoundingClientRect();

  if (state.mode === 'mouse') {
    state.gaze = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
      visible: true,
      source: 'mouse',
    };
  }

  if (!viewer.classList.contains('is-dragging')) {
    return;
  }

  const lastX = Number(viewer.dataset.lastX);
  const lastY = Number(viewer.dataset.lastY);
  const dx = event.clientX - lastX;
  const dy = event.clientY - lastY;

  state.cameraYaw = normalizeYaw(state.cameraYaw - dx * 0.12);
  state.cameraPitch = THREE.MathUtils.clamp(state.cameraPitch - dy * 0.12, -85, 85);
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
  if (!state.isRecording && !canRecordCurrentMode()) {
    setNotice('Run Check accuracy before recording webcam AOI samples. Recalibrate if the result is poor.', true);
    return;
  }

  state.isRecording = !state.isRecording;
  recordButton.textContent = state.isRecording ? 'Stop Recording' : 'Start Recording';
  recordButton.classList.toggle('primary', !state.isRecording);
  syncParticipantSessionControls();
}

function clearSamples() {
  state.samples = [];
  sampleCount.textContent = '0';
  syncParticipantSessionControls();
}

async function startReviewMode() {
  if (!state.reviewSamples.length) {
    setNotice('Load a recording JSON before reviewing.');
    return;
  }

  state.reviewActive = true;
  state.mode = 'review';
  state.isRecording = false;
  state.lastSampleAt = 0;
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
    return;
  }

  await startReviewMode();
}

function buildExportSummary() {
  return createExportSummary(state.samples, state, SAMPLE_INTERVAL_MS);
}

function downloadJson(payload, fileName) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
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
  });
}

function exportSamples() {
  const namedAoiMetrics = buildNamedAoiMetrics(state.samples, activeAois);
  const video = buildVideoPackageMetadata();
  const payload = buildExportPayload({
    sourceVideo: sourceVideo.currentSrc || sourceVideo.src,
    exportedAt: new Date().toISOString(),
    participant: getExportParticipantMetadata(),
    project: buildProjectPackage(),
    video,
    summary: buildExportSummary(),
    namedAoiMetrics,
    aoiSource,
    aois: activeAois,
    state,
  });
  downloadJson(payload, `aoi-samples-${Date.now()}.json`);
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

sourceVideo.addEventListener('loadedmetadata', syncVideoNotice);
sourceVideo.addEventListener('canplay', syncVideoNotice);

sourceVideo.addEventListener('error', () => {
  setNotice('Could not load assets/test-video.mp4. Download the test video or load a local MP4.');
});

viewer.addEventListener('pointerdown', startDrag);
viewer.addEventListener('pointermove', drag);
viewer.addEventListener('pointerup', endDrag);
viewer.addEventListener('pointercancel', endDrag);
playVideoButton.addEventListener('click', toggleVideoPlayback);
resetViewButton.addEventListener('click', resetView);
mouseModeButton.addEventListener('click', setMouseMode);
webcamModeButton.addEventListener('click', setWebcamMode);
calibrateButton.addEventListener('click', startCalibration);
accuracyButton.addEventListener('click', startAccuracyCheck);
calibrationTarget.addEventListener('click', handleTargetClick);
cancelCalibrationButton.addEventListener('click', cancelCalibration);
recordButton.addEventListener('click', toggleRecording);
reviewButton.addEventListener('click', toggleReviewMode);
clearButton.addEventListener('click', clearSamples);
exportButton.addEventListener('click', exportSamples);
videoFileInput.addEventListener('change', loadLocalVideo);
aoiFileInput.addEventListener('change', loadAoiFile);
projectionSelect.addEventListener('change', syncSourceVideoMetadataFromControls);
stereoLayoutSelect.addEventListener('change', syncSourceVideoMetadataFromControls);
addManualAoiButton.addEventListener('click', addManualAoi);
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
applyVideoMetadataControls(sourceVideoInfo);
void loadAois();
resize();
updateCamera();
selectWebcamMode();
setWebcamStatus('idle');
syncVideoNotice();
applyAppMode();
animate();
