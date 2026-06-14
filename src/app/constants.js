import { DEFAULT_RECORDING_SAMPLE_INTERVAL_MS } from '../recording/sampleScheduler.js';

export const RECORDING_SAMPLE_INTERVAL_MS = DEFAULT_RECORDING_SAMPLE_INTERVAL_MS;

export const GAZE_SMOOTHING = {
  alpha: 0.16,
  fastAlpha: 0.56,
  fastDistancePx: 260,
  maxJumpPx: 900,
  boundsMarginPx: 24,
  rawBoundsMarginRatio: 0.35,
};

export const GAZE_TIMING = {
  freshGazeMaxAgeMs: 180,
  liveGazeStaleMs: 450,
  liveGazeHoldMs: 350,
  targetSettleDelayMs: 250,
  targetSampleDelayMs: 55,
};

export const TARGET_CAPTURE = {
  maxDispersionPx: 100,
  calibrationSamplesPerPoint: 12,
  validationSamplesPerPoint: 12,
  validationMaxAttemptsPerTarget: 2,
  minAcceptedRefinementTargets: 7,
  minAcceptedValidationTargets: 5,
};

export const RAW_GAZE_DIAGNOSTIC = {
  samplesPerTarget: 45,
  sampleDelayMs: 33,
  settleDelayMs: 300,
  cursorHoldMs: 1400,
  targets: [
    { id: 'center', label: 'Center', x: 50, y: 50 },
    { id: 'top', label: 'Top', x: 50, y: 20 },
    { id: 'bottom', label: 'Bottom', x: 50, y: 80 },
    { id: 'left', label: 'Left', x: 20, y: 50 },
    { id: 'right', label: 'Right', x: 80, y: 50 },
  ],
};

export const LIVE_QUALITY = {
  maxEvents: 24,
  minEvents: 12,
  maxBadRate: 0.5,
  maxConsecutiveBad: 8,
};

export const DEFAULT_VALIDATION_MAX_AGE_MS = 5 * 60 * 1000;
export const REVIEW_GAZE_EDGE_PADDING_PX = 12;
export const REVIEW_LOOP_GRACE_SEC = 0.25;
export const POLYGON_KEYFRAME_EDIT_EPSILON_SEC = 0.05;
export const SVG_NS = 'http://www.w3.org/2000/svg';
