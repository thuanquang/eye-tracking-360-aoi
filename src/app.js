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
} from './aoiMath.js?v=aoi-anchor-4';
import { buildNamedAoiMetrics } from './analysisMetrics.js?v=ui-modes-1';
import {
  buildColabAoiJob,
  normalizeAoiId,
} from './aoiGeneration.js?v=colab-aoi-1';
import {
  getEffectiveAnalysisPadding,
  hasUsablePolygonArea,
} from './aoiShapes.js?v=polygon-padding-2';
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
} from './gazeQuality.js';

const DEFAULT_AOIS = [
  {
    id: 'front-center',
    label: 'Front center object',
    color: '#ffd166',
    yawMin: -18,
    yawMax: 18,
    pitchMin: -10,
    pitchMax: 16,
    keyframes: [
      { t: 0, yawMin: -18, yawMax: 18, pitchMin: -10, pitchMax: 16 },
      { t: 8, yawMin: -4, yawMax: 32, pitchMin: -8, pitchMax: 18 },
      { t: 16, yawMin: -24, yawMax: 12, pitchMin: -12, pitchMax: 14 },
    ],
  },
  {
    id: 'upper-left',
    label: 'Upper left zone',
    color: '#5dd7c8',
    yawMin: -82,
    yawMax: -42,
    pitchMin: 4,
    pitchMax: 32,
  },
  {
    id: 'lower-right',
    label: 'Lower right zone',
    color: '#ff8a5c',
    yawMin: 38,
    yawMax: 88,
    pitchMin: -38,
    pitchMax: -10,
  },
  {
    id: 'rear-seam',
    label: 'Rear seam wraparound',
    color: '#8bd66f',
    yawMin: 165,
    yawMax: -165,
    pitchMin: -20,
    pitchMax: 20,
  },
];
let activeAois = DEFAULT_AOIS;
let aoiSource = 'default';
let registeredProjectMetadata = {};
let sourceVideoInfo = {
  kind: 'bundled',
  name: 'test-video.mp4',
  path: 'assets/test-video.mp4',
  type: 'video/mp4',
  size: null,
  lastModified: null,
  projection: 'equirectangular',
  stereoLayout: 'mono',
};

const SAMPLE_INTERVAL_MS = 150;
const DEFAULT_GAZE = { x: 0, y: 0, visible: false, source: 'webcam' };
const GAZE_SMOOTHING_ALPHA = 0.16;
const GAZE_FAST_SMOOTHING_ALPHA = 0.56;
const GAZE_FAST_SMOOTHING_DISTANCE_PX = 260;
const MAX_GAZE_JUMP_PX = 900;
const GAZE_BOUNDS_MARGIN_PX = 24;
const RAW_GAZE_BOUNDS_MARGIN_RATIO = 0.35;
const FRESH_GAZE_MAX_AGE_MS = 180;
const LIVE_GAZE_STALE_MS = 450;
const LIVE_GAZE_HOLD_MS = 1350;
const POLYGON_KEYFRAME_EDIT_EPSILON_SEC = 0.05;
const TARGET_MAX_DISPERSION_PX = 100;
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
const CALIBRATION_SAMPLES_PER_POINT = 12;
const VALIDATION_SAMPLES_PER_POINT = 12;
const TARGET_SETTLE_DELAY_MS = 250;
const TARGET_SAMPLE_DELAY_MS = 55;
const MIN_ACCEPTED_REFINEMENT_TARGETS = 7;
const MIN_ACCEPTED_VALIDATION_TARGETS = 5;
const LIVE_QUALITY_MAX_EVENTS = 24;
const LIVE_QUALITY_MIN_EVENTS = 12;
const LIVE_QUALITY_MAX_BAD_RATE = 0.5;
const LIVE_QUALITY_MAX_CONSECUTIVE_BAD = 8;
const DEFAULT_VALIDATION_MAX_AGE_MS = 5 * 60 * 1000;
const REVIEW_GAZE_EDGE_PADDING_PX = 12;
const REVIEW_LOOP_GRACE_SEC = 0.25;
const SVG_NS = 'http://www.w3.org/2000/svg';

const appShell = document.querySelector('#appShell');
const viewer = document.querySelector('#viewer');
const viewerSection = document.querySelector('#viewerSection');
const viewerNotice = document.querySelector('#viewerNotice');
const aoiOverlay = document.querySelector('#aoiOverlay');
const gazeDot = document.querySelector('#gazeDot');
const sourceVideo = document.querySelector('#sourceVideo');
const miniMap = document.querySelector('#miniMap');
const playVideoButton = document.querySelector('#playVideoButton');
const resetViewButton = document.querySelector('#resetViewButton');
const mouseModeButton = document.querySelector('#mouseModeButton');
const webcamModeButton = document.querySelector('#webcamModeButton');
const calibrateButton = document.querySelector('#calibrateButton');
const accuracyButton = document.querySelector('#accuracyButton');
const videoFileInput = document.querySelector('#videoFileInput');
const aoiFileInput = document.querySelector('#aoiFileInput');
const projectionSelect = document.querySelector('#projectionSelect');
const stereoLayoutSelect = document.querySelector('#stereoLayoutSelect');
const manualAoiLabelInput = document.querySelector('#manualAoiLabelInput');
const manualAoiSizeInput = document.querySelector('#manualAoiSizeInput');
const manualAoiColorInput = document.querySelector('#manualAoiColorInput');
const addManualAoiButton = document.querySelector('#addManualAoiButton');
const drawPolygonAoiButton = document.querySelector('#drawPolygonAoiButton');
const finishPolygonAoiButton = document.querySelector('#finishPolygonAoiButton');
const cancelPolygonAoiButton = document.querySelector('#cancelPolygonAoiButton');
const manualAoiStatus = document.querySelector('#manualAoiStatus');
const selectedAoiPanel = document.querySelector('#selectedAoiPanel');
const selectedAoiLabelInput = document.querySelector('#selectedAoiLabelInput');
const selectedAoiPaddingInput = document.querySelector('#selectedAoiPaddingInput');
const selectedAoiColorInput = document.querySelector('#selectedAoiColorInput');
const saveSelectedAoiButton = document.querySelector('#saveSelectedAoiButton');
const deleteSelectedAoiButton = document.querySelector('#deleteSelectedAoiButton');
const cloudAoiPromptsInput = document.querySelector('#cloudAoiPromptsInput');
const cloudAoiSampleIntervalInput = document.querySelector('#cloudAoiSampleIntervalInput');
const cloudAoiMaxPointsInput = document.querySelector('#cloudAoiMaxPointsInput');
const cloudAoiSimplifyInput = document.querySelector('#cloudAoiSimplifyInput');
const exportColabJobButton = document.querySelector('#exportColabJobButton');
const cloudAoiResultInput = document.querySelector('#cloudAoiResultInput');
const recordingFileInput = document.querySelector('#recordingFileInput');
const recordButton = document.querySelector('#recordButton');
const reviewButton = document.querySelector('#reviewButton');
const clearButton = document.querySelector('#clearButton');
const exportButton = document.querySelector('#exportButton');
const sampleCount = document.querySelector('#sampleCount');
const modeLabel = document.querySelector('#modeLabel');
const webcamStatusLabel = document.querySelector('#webcamStatusLabel');
const accuracyStatusLabel = document.querySelector('#accuracyStatusLabel');
const aoiSourceLabel = document.querySelector('#aoiSourceLabel');
const screenReadout = document.querySelector('#screenReadout');
const cameraReadout = document.querySelector('#cameraReadout');
const panoramaReadout = document.querySelector('#panoramaReadout');
const hitReadout = document.querySelector('#hitReadout');
const aoiList = document.querySelector('#aoiList');
const controlPanel = document.querySelector('#controlPanel');
const participantPanel = document.querySelector('#participantPanel');
const adminModeLink = document.querySelector('#adminModeLink');
const participantModeLink = document.querySelector('#participantModeLink');
const participantIdInput = document.querySelector('#participantIdInput');
const participantNameInput = document.querySelector('#participantNameInput');
const participantAgeInput = document.querySelector('#participantAgeInput');
const participantConsentInput = document.querySelector('#participantConsentInput');
const participantStartButton = document.querySelector('#participantStartButton');
const participantStageLabel = document.querySelector('#participantStageLabel');
const calibrationOverlay = document.querySelector('#calibrationOverlay');
const calibrationTarget = document.querySelector('#calibrationTarget');
const calibrationProgress = document.querySelector('#calibrationProgress');
const calibrationDescription = document.querySelector('#calibrationDescription');
const cancelCalibrationButton = document.querySelector('#cancelCalibrationButton');

const state = {
  cameraYaw: 0,
  cameraPitch: 0,
  mode: 'webcam',
  gaze: { ...DEFAULT_GAZE },
  latestPoint: null,
  latestHits: [],
  latestAois: [],
  latestAoiClassification: null,
  latestUncertainty: null,
  samples: [],
  reviewSamples: [],
  reviewSource: null,
  reviewActive: false,
  reviewIndex: 0,
  isRecording: false,
  lastSampleAt: 0,
  webcamStarted: false,
  webcamStatus: 'idle',
  rawPageGaze: null,
  rawViewerGaze: null,
  rawGazeAt: 0,
  lastAcceptedGazeAt: 0,
  gazeCorrection: null,
  refinementAccuracySummary: null,
  accuracySummary: null,
  correctedAccuracySummary: null,
  localAccuracyErrorModel: null,
  validationSamples: [],
  accuracyValidated: false,
  accuracyValidatedAt: null,
  accuracyInvalidationReason: null,
  liveGazeQuality: null,
  gazeDropReason: null,
  droppedGazeSamples: 0,
  appMode: 'admin',
  participant: {
    id: '',
    name: '',
    age: null,
    consent: false,
    startedAt: null,
  },
  calibrationIndex: 0,
  targetMode: 'calibration',
  targetCaptureInProgress: false,
  accuracyIndex: 0,
  accuracySamples: [],
  resumeVideoAfterTargetMode: false,
  selectedAoiId: null,
  manualAnnotation: {
    mode: 'idle',
    points: [],
    dragIndex: null,
    space: null,
  },
};

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
  const mode = new URLSearchParams(window.location.search).get('mode');
  return mode === 'participant' ? 'participant' : 'admin';
}

function setParticipantStage(message) {
  participantStageLabel.textContent = message;
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

function applyAppMode(mode = getRequestedAppMode()) {
  state.appMode = mode;
  const isParticipant = mode === 'participant';

  appShell.classList.toggle('is-participant-mode', isParticipant);
  appShell.classList.toggle('is-admin-mode', !isParticipant);
  participantPanel.hidden = !isParticipant;
  controlPanel.hidden = isParticipant;
  adminModeLink.classList.toggle('is-active', !isParticipant);
  participantModeLink.classList.toggle('is-active', isParticipant);

  if (isParticipant) {
    setParticipantStage('Enter details');
    updateParticipantStartState();
    setNotice('Enter participant details, then start the session.', true);
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
  appShell.classList.add('is-participant-started');
  selectWebcamMode();
  setParticipantStage('Ready: calibrate webcam');
  setNotice('Participant session ready. Calibrate webcam, check accuracy, then start recording.', true);
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
  const dimensions = getViewerAnalysisDimensions();

  if (state.reviewActive && state.reviewSamples.length) {
    const sampleIndex = findReviewSampleIndex(sourceVideo.currentTime || 0);
    const sample = state.reviewSamples[sampleIndex >= 0 ? sampleIndex : 0];

    if (Array.isArray(sample?.activeAois) && sample.activeAois.length) {
      return withEffectiveAoisAnalysisPadding(sample.activeAois, dimensions);
    }

    return resolveAoisForAnalysis(activeAois, sample?.t || 0, dimensions);
  }

  return resolveAoisForAnalysis(activeAois, sourceVideo.currentTime || 0, dimensions);
}

function splitAoiYawRanges(aoi) {
  const yawMin = normalizeYaw(aoi.yawMin);
  const yawMax = normalizeYaw(aoi.yawMax);

  if (yawMin <= yawMax) {
    return [{ yawMin, yawMax }];
  }

  return [
    { yawMin, yawMax: 180 },
    { yawMin: -180, yawMax },
  ];
}

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function interpolateScreenPoint(start, end, ratio) {
  return {
    x: start.x + (end.x - start.x) * ratio,
    y: start.y + (end.y - start.y) * ratio,
  };
}

function clipPolygonAgainstBoundary(points, isInside, intersection) {
  if (!points.length) {
    return [];
  }

  const clipped = [];
  let previous = points[points.length - 1];
  let previousInside = isInside(previous);

  points.forEach((current) => {
    const currentInside = isInside(current);

    if (currentInside) {
      if (!previousInside) {
        clipped.push(intersection(previous, current));
      }

      clipped.push(current);
    } else if (previousInside) {
      clipped.push(intersection(previous, current));
    }

    previous = current;
    previousInside = currentInside;
  });

  return clipped;
}

function clipPolygonToRect(points, width, height) {
  const safeIntersection = (start, end, ratio) => interpolateScreenPoint(
    start,
    end,
    Number.isFinite(ratio) ? ratio : 0,
  );

  const clipped = [
    {
      isInside: (point) => point.x >= 0,
      intersection: (start, end) => safeIntersection(start, end, (0 - start.x) / (end.x - start.x)),
    },
    {
      isInside: (point) => point.x <= width,
      intersection: (start, end) => safeIntersection(start, end, (width - start.x) / (end.x - start.x)),
    },
    {
      isInside: (point) => point.y >= 0,
      intersection: (start, end) => safeIntersection(start, end, (0 - start.y) / (end.y - start.y)),
    },
    {
      isInside: (point) => point.y <= height,
      intersection: (start, end) => safeIntersection(start, end, (height - start.y) / (end.y - start.y)),
    },
  ].reduce(
    (currentPoints, boundary) => clipPolygonAgainstBoundary(
      currentPoints,
      boundary.isInside,
      boundary.intersection,
    ),
    points,
  );

  return clipped.map((point) => ({
    x: clampNumber(point.x, 0, width),
    y: clampNumber(point.y, 0, height),
  }));
}

function projectAoiRange(aoi, yawMin, yawMax, rect) {
  const pitchMin = Math.min(aoi.pitchMin, aoi.pitchMax);
  const pitchMax = Math.max(aoi.pitchMin, aoi.pitchMax);
  const corners = [
    { yaw: yawMin, pitch: pitchMax },
    { yaw: yawMax, pitch: pitchMax },
    { yaw: yawMax, pitch: pitchMin },
    { yaw: yawMin, pitch: pitchMin },
  ].map((corner) => panoramaPointToScreen({
    ...corner,
    width: rect.width,
    height: rect.height,
    cameraYaw: state.cameraYaw,
    cameraPitch: state.cameraPitch,
    fov: camera.fov,
  }));

  if (!corners.every((corner) => corner.inFront && Number.isFinite(corner.x) && Number.isFinite(corner.y))) {
    return null;
  }

  const clipped = clipPolygonToRect(corners, rect.width, rect.height);

  if (clipped.length < 3) {
    return null;
  }

  return clipped;
}

function projectVideoAoiRange(aoi, rect) {
  const xMin = Math.min(aoi.xMin, aoi.xMax) * rect.width;
  const xMax = Math.max(aoi.xMin, aoi.xMax) * rect.width;
  const yMin = Math.min(aoi.yMin, aoi.yMax) * rect.height;
  const yMax = Math.max(aoi.yMin, aoi.yMax) * rect.height;

  return [
    { x: xMin, y: yMin },
    { x: xMax, y: yMin },
    { x: xMax, y: yMax },
    { x: xMin, y: yMax },
  ];
}

function projectVideoPolygon(aoi, rect) {
  return (aoi.points || []).map((point) => ({
    x: point.x * rect.width,
    y: point.y * rect.height,
  }));
}

function projectPanoramaPolygon(aoi, rect) {
  const points = (aoi.points || []).map((point) => panoramaPointToScreen({
    yaw: point.yaw,
    pitch: point.pitch,
    width: rect.width,
    height: rect.height,
    cameraYaw: state.cameraYaw,
    cameraPitch: state.cameraPitch,
    fov: camera.fov,
  }));

  if (!points.every((point) => point.inFront && Number.isFinite(point.x) && Number.isFinite(point.y))) {
    return null;
  }

  return clipPolygonToRect(points, rect.width, rect.height);
}

function getAoiOverlayColor(aoi) {
  return typeof aoi.color === 'string' && window.CSS?.supports('color', aoi.color)
    ? aoi.color
    : '#ffd166';
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

function appendAoiOverlayLabel(fragment, aoi, point) {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    return;
  }

  const label = document.createElementNS(SVG_NS, 'text');
  label.setAttribute('class', 'aoi-overlay-label');
  label.setAttribute('x', String(Math.round(point.x + 8)));
  label.setAttribute('y', String(Math.round(point.y - 8)));
  label.textContent = aoi.label;
  fragment.appendChild(label);
}

function cloneAoiPoints(points) {
  return (points || []).map((point) => ({ ...point }));
}

function screenToAoiSpacePoint(screenPoint, space) {
  const rect = viewer.getBoundingClientRect();
  const x = clampNumber(screenPoint.x, 0, rect.width);
  const y = clampNumber(screenPoint.y, 0, rect.height);

  if (space === 'video') {
    return {
      x: Number((x / rect.width).toFixed(6)),
      y: Number((y / rect.height).toFixed(6)),
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
    return points.map((point) => ({ x: point.x * rect.width, y: point.y * rect.height }));
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
    return points.map((point, index) => ({
      x: point.x * rect.width,
      y: point.y * rect.height,
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
    aoiOverlay.__renderSignature = '';
    return;
  }

  aoiOverlay.setAttribute('viewBox', `0 0 ${rect.width} ${rect.height}`);
  aoiOverlay.setAttribute('width', String(rect.width));
  aoiOverlay.setAttribute('height', String(rect.height));

  const fragment = document.createDocumentFragment();

  getRenderableAois().forEach((aoi) => {
    const color = getAoiOverlayColor(aoi);

    if (aoi.shape === 'polygon' && aoi.space === 'video') {
      const corners = projectVideoPolygon(aoi, rect);
      appendAoiOverlayPolygon(fragment, aoi, corners, color);
      appendAoiOverlayLabel(fragment, aoi, corners[0]);
      return;
    }

    if (aoi.space === 'video') {
      const corners = projectVideoAoiRange(aoi, rect);
      const labelPoint = {
        x: Math.min(aoi.xMax, 0.96) * rect.width,
        y: Math.max(aoi.yMin, 0.04) * rect.height,
      };

      appendAoiOverlayPolygon(fragment, aoi, corners, color);
      appendAoiOverlayLabel(fragment, aoi, labelPoint);
      return;
    }

    if (aoi.shape === 'polygon' && aoi.space !== 'video') {
      const corners = projectPanoramaPolygon(aoi, rect);
      if (corners?.length >= 3) {
        appendAoiOverlayPolygon(fragment, aoi, corners, color);
        appendAoiOverlayLabel(fragment, aoi, corners[0]);
      }
      return;
    }

    splitAoiYawRanges(aoi).forEach(({ yawMin, yawMax }) => {
      const corners = projectAoiRange(aoi, yawMin, yawMax, rect);

      if (!corners) {
        return;
      }

      appendAoiOverlayPolygon(fragment, aoi, corners, color);

      const center = panoramaPointToScreen({
        yaw: normalizeYaw((yawMin + yawMax) / 2),
        pitch: (Math.min(aoi.pitchMin, aoi.pitchMax) + Math.max(aoi.pitchMin, aoi.pitchMax)) / 2,
        width: rect.width,
        height: rect.height,
        cameraYaw: state.cameraYaw,
        cameraPitch: state.cameraPitch,
        fov: camera.fov,
      });

      if (center.visible) {
        appendAoiOverlayLabel(fragment, aoi, center);
      }
    });
  });

  appendSelectedPolygonHandles(fragment, rect);
  appendDraftPolygon(fragment, rect);
  const renderSignature = Array.from(fragment.childNodes)
    .map((node) => node.outerHTML || node.textContent || '')
    .join('');

  if (aoiOverlay.__renderSignature === renderSignature) {
    return;
  }

  aoiOverlay.__renderSignature = renderSignature;
  aoiOverlay.replaceChildren(fragment);
}

function getAoiBoundsLabel(aoi) {
  if (aoi.shape === 'polygon') {
    const pointCount = Array.isArray(aoi.points) ? aoi.points.length : 0;
    const spaceLabel = getAoiSpace(aoi) === 'video' ? 'video' : 'panorama';
    return `${pointCount} ${spaceLabel} polygon points`;
  }

  return aoi.space === 'video'
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
  syncSelectedAoiPanel();
  if (focusAoiId) {
    focusAoiListButton(focusAoiId);
  }
}

function isFiniteNumber(value) {
  return Number.isFinite(Number(value));
}

function getAoiSpace(aoi) {
  return aoi?.space === 'video' ? 'video' : 'panorama';
}

function isValidVideoAoiBounds(aoi) {
  return (
    isFiniteNumber(aoi.xMin) &&
    isFiniteNumber(aoi.xMax) &&
    isFiniteNumber(aoi.yMin) &&
    isFiniteNumber(aoi.yMax)
  );
}

function isValidPanoramaAoiBounds(aoi) {
  return (
    isFiniteNumber(aoi.yawMin) &&
    isFiniteNumber(aoi.yawMax) &&
    isFiniteNumber(aoi.pitchMin) &&
    isFiniteNumber(aoi.pitchMax)
  );
}

function isStrictFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function isValidPolygonPoints(points, space) {
  if (!Array.isArray(points) || points.length < 3) {
    return false;
  }

  const pointKeys = space === 'panorama'
    ? { x: 'yaw', y: 'pitch' }
    : { x: 'x', y: 'y' };

  return (
    points.every((point) => (
      point != null &&
      typeof point === 'object' &&
      (space === 'panorama'
        ? isStrictFiniteNumber(point.yaw) && isStrictFiniteNumber(point.pitch)
        : isStrictFiniteNumber(point.x) && isStrictFiniteNumber(point.y))
    )) &&
    hasUsablePolygonArea(points, pointKeys)
  );
}

function isValidAoiBounds(aoi, space = getAoiSpace(aoi)) {
  if (aoi.shape === 'polygon') {
    return isValidPolygonPoints(aoi.points, space);
  }

  return space === 'video'
    ? isValidVideoAoiBounds(aoi)
    : isValidPanoramaAoiBounds(aoi);
}

function isValidAoiKeyframes(aoi) {
  if (!Array.isArray(aoi.keyframes)) {
    return true;
  }

  const space = getAoiSpace(aoi);

  return (
    aoi.keyframes.length > 0 &&
    aoi.keyframes.every((keyframe) => (
      isFiniteNumber(keyframe.t) &&
      (aoi.shape === 'polygon'
        ? isValidPolygonPoints(keyframe.points, space)
        : isValidAoiBounds(keyframe, space))
    ))
  );
}

function isValidAoi(aoi) {
  return (
    typeof aoi?.id === 'string' &&
    typeof aoi?.label === 'string' &&
    typeof aoi?.color === 'string' &&
    isValidAoiBounds(aoi) &&
    isValidAoiKeyframes(aoi)
  );
}

function isValidReviewSample(sample) {
  return (
    isFiniteNumber(sample?.t) &&
    isFiniteNumber(sample?.panorama?.yaw) &&
    isFiniteNumber(sample?.panorama?.pitch)
  );
}

function extractRecordingSamplesFromJson(json) {
  if (Array.isArray(json?.samples)) {
    return json.samples;
  }

  throw new Error('Recording JSON must be an exported object with a samples array.');
}

function extractProjectMetadataFromJson(json) {
  if (!json || Array.isArray(json) || typeof json !== 'object') {
    return {};
  }

  return {
    video: json.video && typeof json.video === 'object' ? { ...json.video } : null,
  };
}

function extractAoisFromJson(json) {
  if (Array.isArray(json)) {
    return json;
  }

  if (Array.isArray(json?.aois)) {
    return json.aois;
  }

  throw new Error('AOI JSON must be an array or an object with an aois array.');
}

function registerAois(aois, source) {
  const loadedAois = extractAoisFromJson(aois);

  if (!loadedAois.length || !loadedAois.every(isValidAoi)) {
    throw new Error('AOI JSON must contain at least one valid AOI definition.');
  }

  activeAois = withEffectiveAoisAnalysisPadding(
    loadedAois,
    getViewerAnalysisDimensions(),
  );
  aoiSource = source;
  state.selectedAoiId = null;
  setManualAnnotationIdle('Click Draw Polygon, then click around the object edge. Double-click or press Finish to close.');
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
    activeAois = withEffectiveAoisAnalysisPadding(DEFAULT_AOIS);
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
  const samples = extractRecordingSamplesFromJson(json)
    .filter(isValidReviewSample)
    .sort((a, b) => a.t - b.t);

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
}

function disableWebGazerMouseTraining() {
  window.__aoiBlockWebGazerMouseTraining = true;
  if (window.webgazer?.removeMouseEventListeners) {
    window.webgazer.removeMouseEventListeners();
  }
}

function disableWebGazerPersistence() {
  if (window.webgazer?.saveDataAcrossSessions) {
    window.webgazer.saveDataAcrossSessions(false);
  }
}

function configureWebGazerForControlledCalibration() {
  disableWebGazerPersistence();

  if (window.webgazer?.setRegression) {
    window.webgazer.setRegression('ridge');
  }

  if (window.webgazer?.setTracker) {
    window.webgazer.setTracker('TFFacemesh');
  }

  if (window.webgazer?.applyKalmanFilter) {
    window.webgazer.applyKalmanFilter(false);
  }

  if (window.webgazer?.showFaceOverlay) {
    window.webgazer.showFaceOverlay(true);
  }

  if (window.webgazer?.showFaceFeedbackBox) {
    window.webgazer.showFaceFeedbackBox(true);
  }
}

async function resetWebcamCalibrationData() {
  if (window.webgazer?.clearData) {
    await window.webgazer.clearData();
  }

  state.gaze = { ...DEFAULT_GAZE };
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
    return;
  }

  if (state.accuracyValidated && state.correctedAccuracySummary) {
    accuracyStatusLabel.textContent = `validated ${Math.round(state.correctedAccuracySummary.meanPx)}px`;
    return;
  }

  accuracyStatusLabel.textContent = `${summary.quality} ${Math.round(summary.meanPx)}px`;
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
  state.gaze = { ...DEFAULT_GAZE, source: 'mouse' };
  mouseModeButton.classList.add('is-active');
  webcamModeButton.classList.remove('is-active');
  modeLabel.textContent = 'mouse';
}

function selectWebcamMode() {
  stopReviewMode();
  state.mode = 'webcam';
  state.gaze = { ...DEFAULT_GAZE };
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

    state.gaze = { ...DEFAULT_GAZE };
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

  configureWebGazerForControlledCalibration();
  window.webgazer.showVideoPreview(true);
  window.webgazer.showPredictionPoints(false);
  window.webgazer.setGazeListener((data) => {
    if (!data || state.mode !== 'webcam') {
      return;
    }

    processWebcamGaze(data);
  });

  try {
    await window.webgazer.begin();
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

  if (!window.webgazer?.recordScreenPosition) {
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
    window.webgazer.recordScreenPosition(x, y, 'click');
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

function findReviewSampleIndex(timeSec) {
  const samples = state.reviewSamples;

  if (!samples.length) {
    return -1;
  }

  if (!Number.isFinite(timeSec) || timeSec <= samples[0].t) {
    return 0;
  }

  if (timeSec >= samples[samples.length - 1].t) {
    return samples.length - 1;
  }

  let bestIndex = 0;
  let bestDistance = Infinity;

  for (let index = 0; index < samples.length; index += 1) {
    const distance = Math.abs(samples[index].t - timeSec);

    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }

  return bestIndex;
}

function getReviewTimeWindow() {
  if (!state.reviewSamples.length) {
    return null;
  }

  return {
    start: state.reviewSamples[0].t,
    end: state.reviewSamples[state.reviewSamples.length - 1].t,
  };
}

function syncReviewPlaybackWindow() {
  if (!state.reviewActive || !Number.isFinite(sourceVideo.currentTime)) {
    return;
  }

  const window = getReviewTimeWindow();
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
  const sampleIndex = findReviewSampleIndex(sourceVideo.currentTime || 0);

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

  const analysisDimensions = getViewerAnalysisDimensions();
  const viewport = {
    width: rect.width,
    height: rect.height,
  };
  const videoPoint = screenPointToVideoPoint({
    x: screen.x,
    y: screen.y,
    width: viewport.width,
    height: viewport.height,
  });

  return {
    gaze: state.gaze,
    timeSec: sample.t,
    aois: Array.isArray(sample.activeAois) && sample.activeAois.length
      ? withEffectiveAoisAnalysisPadding(sample.activeAois, analysisDimensions)
      : resolveAoisForAnalysis(activeAois, sample.t, analysisDimensions),
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

  const viewport = {
    width: rect.width,
    height: rect.height,
  };
  const analysisDimensions = getViewerAnalysisDimensions();

  return {
    gaze,
    timeSec,
    aois: resolveAoisForAnalysis(activeAois, timeSec, analysisDimensions),
    viewport,
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

function classifyVideoAois(point, aois, viewport) {
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
  if (
    !Number.isFinite(canvasWidth) ||
    !Number.isFinite(canvasHeight) ||
    canvasWidth <= 0 ||
    canvasHeight <= 0
  ) {
    return;
  }

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
    if (aoi.shape === 'polygon') {
      if (aoi.space === 'video') {
        drawVideoPolygonMiniMap(ctx, width, height, aoi);
      } else {
        drawPanoramaPolygonMiniMap(ctx, width, height, aoi);
      }
      return;
    }

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

function serializeAoiCoordinate(value) {
  return isFiniteNumber(value) ? Number(Number(value).toFixed(3)) : null;
}

function serializeAoiPoints(points) {
  return Array.isArray(points)
    ? points.map((point) => (
      point && typeof point === 'object'
        ? { ...point }
        : point
    ))
    : null;
}

function serializeActiveAoiForSample(aoi) {
  const serialized = {
    id: aoi.id,
    label: aoi.label,
    color: aoi.color,
    space: getAoiSpace(aoi),
    shape: aoi.shape || 'box',
    points: serializeAoiPoints(aoi.points),
    yawMin: serializeAoiCoordinate(aoi.yawMin),
    yawMax: serializeAoiCoordinate(aoi.yawMax),
    pitchMin: serializeAoiCoordinate(aoi.pitchMin),
    pitchMax: serializeAoiCoordinate(aoi.pitchMax),
    xMin: serializeAoiCoordinate(aoi.xMin),
    xMax: serializeAoiCoordinate(aoi.xMax),
    yMin: serializeAoiCoordinate(aoi.yMin),
    yMax: serializeAoiCoordinate(aoi.yMax),
  };

  const analysisPaddingPx = serializeAoiCoordinate(aoi.analysisPaddingPx);
  const analysisPadding = serializeAoiCoordinate(aoi.analysisPadding);

  if (analysisPaddingPx != null) {
    serialized.analysisPaddingPx = analysisPaddingPx;
  }

  if (analysisPadding != null) {
    serialized.analysisPadding = analysisPadding;
  }

  return serialized;
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

  state.samples.push({
    t: Number(sourceVideo.currentTime.toFixed(3)),
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
    screen: {
      x: Math.round(state.gaze.x),
      y: Math.round(state.gaze.y),
    },
    rawScreen: state.rawViewerGaze ? {
      x: Math.round(state.rawViewerGaze.x),
      y: Math.round(state.rawViewerGaze.y),
    } : null,
    camera: {
      yaw: Number(state.cameraYaw.toFixed(3)),
      pitch: Number(state.cameraPitch.toFixed(3)),
      fov: camera.fov,
    },
    panorama: {
      yaw: Number(state.latestPoint.yaw.toFixed(3)),
      pitch: Number(state.latestPoint.pitch.toFixed(3)),
    },
    hits: state.latestHits.map((hit) => hit.id),
    activeAois: state.latestAois.map(serializeActiveAoiForSample),
    likelyHits: state.latestAoiClassification?.likelyHits.map((hit) => hit.id) || [],
    possibleHits: state.latestAoiClassification?.possibleHits.map((hit) => hit.id) || [],
    ambiguousHits: state.latestAoiClassification?.ambiguousHits.map((hit) => hit.id) || [],
    gazeUncertainty: state.latestUncertainty || { px: 0, yawRadius: 0, pitchRadius: 0 },
  });
  sampleCount.textContent = String(state.samples.length);
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

  if (state.manualAnnotation.mode === 'drawing' || event.target.closest?.('.aoi-vertex-handle')) {
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
}

function clearSamples() {
  state.samples = [];
  sampleCount.textContent = '0';
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

  const reviewWindow = getReviewTimeWindow();
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
    state.gaze = { ...DEFAULT_GAZE, source: 'mouse' };
    mouseModeButton.classList.add('is-active');
    webcamModeButton.classList.remove('is-active');
    modeLabel.textContent = 'mouse';
    setNotice('Recording review stopped.', false);
    return;
  }

  await startReviewMode();
}

function countValues(samples, getValues) {
  return samples.reduce((counts, sample) => {
    const values = getValues(sample);

    values.forEach((value) => {
      counts[value] = (counts[value] || 0) + 1;
    });

    return counts;
  }, {});
}

function getSampleDurations(samples) {
  return samples.map((sample, index) => {
    const next = samples[index + 1];
    const videoDelta = next ? next.t - sample.t : SAMPLE_INTERVAL_MS / 1000;

    return Number.isFinite(videoDelta) && videoDelta > 0
      ? videoDelta
      : SAMPLE_INTERVAL_MS / 1000;
  });
}

function sumDwellSeconds(samples, getValues) {
  const durations = getSampleDurations(samples);

  return samples.reduce((dwell, sample, index) => {
    getValues(sample).forEach((value) => {
      dwell[value] = Number(((dwell[value] || 0) + durations[index]).toFixed(3));
    });

    return dwell;
  }, {});
}

function buildExportSummary() {
  const durationSec = getSampleDurations(state.samples).reduce((sum, duration) => sum + duration, 0);

  return {
    totalSamples: state.samples.length,
    durationSec: Number(durationSec.toFixed(3)),
    sources: countValues(state.samples, (sample) => [sample.source]),
    aoiHitCounts: countValues(state.samples, (sample) => sample.hits || []),
    likelyAoiHitCounts: countValues(state.samples, (sample) => sample.likelyHits || []),
    possibleAoiHitCounts: countValues(state.samples, (sample) => sample.possibleHits || []),
    aoiDwellSec: sumDwellSeconds(state.samples, (sample) => sample.hits || []),
    likelyAoiDwellSec: sumDwellSeconds(state.samples, (sample) => sample.likelyHits || []),
    possibleAoiDwellSec: sumDwellSeconds(state.samples, (sample) => sample.possibleHits || []),
    ambiguousSampleCount: state.samples.filter((sample) => (sample.ambiguousHits || []).length > 0).length,
    trustedSampleCount: state.samples.filter((sample) => sample.quality?.trustedForAoiAnalysis).length,
    accuracyValidated: state.accuracyValidated,
    accuracyMeanPx: state.correctedAccuracySummary?.meanPx ?? null,
    accuracyP90Px: state.correctedAccuracySummary?.p90Px ?? null,
    accuracyMaxPx: state.correctedAccuracySummary?.maxPx ?? null,
    accuracyP90DispersionPx: state.correctedAccuracySummary?.p90DispersionPx ?? null,
    accuracyMaxDispersionPx: state.correctedAccuracySummary?.maxDispersionPx ?? null,
    droppedGazeSamples: state.droppedGazeSamples,
  };
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
  const durationSec = Number.isFinite(sourceVideo.duration)
    ? Number(sourceVideo.duration.toFixed(3))
    : null;
  const sidecarVideo = registeredProjectMetadata.video || {};
  syncSourceVideoMetadataFromControls();

  return {
    ...sidecarVideo,
    ...sourceVideoInfo,
    name: sourceVideoInfo.kind === 'local-file'
      ? sourceVideoInfo.name
      : sidecarVideo.name || sourceVideoInfo.name || null,
    durationSec: durationSec ?? sidecarVideo.durationSec ?? null,
    projection: getCurrentProjection(),
    stereoLayout: getCurrentStereoLayout(),
    src: sourceVideo.currentSrc || sourceVideo.src,
  };
}

function buildProjectPackage() {
  return {
    version: 1,
    video: buildVideoPackageMetadata(),
    aois: {
      source: aoiSource,
      count: activeAois.length,
      packaged: true,
    },
    includesVideoBinary: false,
  };
}

function exportSamples() {
  const exportAois = withEffectiveAoisAnalysisPadding(
    activeAois,
    getViewerAnalysisDimensions(),
  );
  const namedAoiMetrics = buildNamedAoiMetrics(state.samples, exportAois);
  const payload = {
    sourceVideo: sourceVideo.currentSrc || sourceVideo.src,
    exportedAt: new Date().toISOString(),
    participant: getExportParticipantMetadata(),
    project: buildProjectPackage(),
    video: buildVideoPackageMetadata(),
    summary: buildExportSummary(),
    namedAoiMetrics,
    aoiSource,
    aois: exportAois,
    accuracy: state.correctedAccuracySummary,
    rawValidationAccuracy: state.accuracySummary,
    correctionFitAccuracy: state.refinementAccuracySummary,
    gazeCorrection: state.gazeCorrection,
    localAccuracyErrorModel: state.localAccuracyErrorModel,
    accuracyValidated: state.accuracyValidated,
    accuracyInvalidationReason: state.accuracyInvalidationReason,
    liveGazeQuality: state.liveGazeQuality,
    droppedGazeSamples: state.droppedGazeSamples,
    samples: state.samples,
  };
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
  aoiSource = 'manual';
  cancelPolygonAnnotation();
  renderAoiList();
  drawAoiOverlay();
  setNotice(`Added polygon AOI: ${label}`, true);
}

function getActiveAoiById(aoiId) {
  return activeAois.find((aoi) => aoi.id === aoiId);
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
