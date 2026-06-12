const DEFAULT_GAZE = { x: 0, y: 0, visible: false, source: 'webcam' };

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

export function createDefaultAois() {
  return structuredClone(DEFAULT_AOIS);
}

export function createDefaultGaze(overrides = {}) {
  return { ...DEFAULT_GAZE, ...overrides };
}

export function createInitialVideoInfo() {
  return {
    kind: 'bundled',
    name: 'test-video.mp4',
    path: 'assets/test-video.mp4',
    type: 'video/mp4',
    size: null,
    lastModified: null,
    projection: 'equirectangular',
    stereoLayout: 'mono',
  };
}

export function createInitialAppState() {
  return {
    cameraYaw: 0,
    cameraPitch: 0,
    mode: 'webcam',
    gaze: createDefaultGaze(),
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
    gazeStreamStats: null,
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
  };
}
