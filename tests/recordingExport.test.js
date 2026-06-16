import test from 'node:test';
import assert from 'node:assert/strict';

import { RECORDING_SAMPLE_INTERVAL_MS } from '../src/app/constants.js';
import { buildRecordingSample } from '../src/recording/sampleBuilder.js';
import {
  buildExportPayload,
  buildExportSummary,
  buildProjectPackage,
  buildVideoPackageMetadata,
} from '../src/recording/recordingExport.js';

const STANDARD_PROFILE = { id: 'standard', label: 'Standard', pointCount: 9 };
const RESEARCH_39_PROFILE = { id: 'research-39', label: 'Research 39', pointCount: 39 };
const RESEARCH_78_PROFILE = { id: 'research-78', label: 'Research 78', pointCount: 78 };
const POLICY_FAILURE = { metric: 'effectiveHz', actual: 12, limit: 20, comparator: '>=' };
const VALIDATION_STREAM_STATS = {
  events: [
    { atMs: 1000, accepted: true },
    { atMs: 1025, accepted: true },
    { atMs: 1050, accepted: true },
  ],
};

test('builds recording samples with raw, corrected, AOI, and quality fields', () => {
  const sample = buildRecordingSample({
    timeSec: 1.2345,
    source: 'webcam',
    gaze: { x: 100.4, y: 200.6 },
    rawGaze: { x: 95.1, y: 205.9 },
    camera: { yaw: 12.3456, pitch: -4.321, fov: 75 },
    panorama: { yaw: 10.111, pitch: -3.222 },
    hits: [{ id: 'front' }],
    activeAois: [{ id: 'front', label: 'Front', yawMin: -10, yawMax: 10, pitchMin: -5, pitchMax: 5 }],
    classification: {
      likelyHits: [{ id: 'front' }],
      possibleHits: [{ id: 'front' }],
      ambiguousHits: [],
    },
    uncertainty: { px: 50, yawRadius: 2, pitchRadius: 1 },
    quality: { trustedForAoiAnalysis: true },
    gazeStreamQuality: { effectiveHz: 50, dataIntegrityPercent: 75 },
  });

  assert.equal(sample.t, 1.234);
  assert.deepEqual(sample.screen, { x: 100, y: 201 });
  assert.deepEqual(sample.rawScreen, { x: 95, y: 206 });
  assert.deepEqual(sample.hits, ['front']);
  assert.deepEqual(sample.likelyHits, ['front']);
  assert.equal(sample.quality.trustedForAoiAnalysis, true);
  assert.equal(sample.quality.gazeStreamQuality.effectiveHz, 50);
});

test('serializes recorded AOI snapshots as JSON-safe point data', () => {
  const point = { yaw: 1.2345, pitch: -2.3456, runtimeHandle: null };
  point.runtimeHandle = point;

  const sample = buildRecordingSample({
    timeSec: 1,
    source: 'mouse',
    gaze: { x: 10, y: 20 },
    camera: { yaw: 0, pitch: 0, fov: 75 },
    panorama: { yaw: 1, pitch: 2 },
    activeAois: [{
      id: 'dynamic-polygon',
      label: 'Dynamic polygon',
      color: '#00ffaa',
      shape: 'polygon',
      points: [point],
    }],
  });

  assert.doesNotThrow(() => JSON.stringify(sample));
  assert.deepEqual(sample.activeAois[0].points, [{ yaw: 1.2345, pitch: -2.3456 }]);
});

test('builds recording samples with stable AOI evidence', () => {
  const sample = buildRecordingSample({
    timeSec: 1,
    source: 'webcam',
    gaze: { x: 10, y: 20 },
    camera: { yaw: 0, pitch: 0, fov: 75 },
    panorama: { yaw: 1, pitch: 2 },
    stableHits: [{ id: 'sign', label: 'Sign' }],
    aoiStability: {
      candidateAois: [{ id: 'sign', score: 0.9 }],
      trustedForAoiAnalysis: true,
    },
  });

  assert.deepEqual(sample.stableHits, ['sign']);
  assert.equal(sample.quality.trustedForAoiAnalysis, true);
  assert.equal(sample.aoiStability.candidateAois[0].score, 0.9);
});

test('builds summary counts and duration from samples', () => {
  const summary = buildExportSummary([
    {
      t: 0,
      source: 'mouse',
      screen: { x: 20, y: 30 },
      panorama: { yaw: -10, pitch: 5 },
      hits: ['logo'],
      likelyHits: ['logo'],
      possibleHits: [],
      ambiguousHits: [],
      quality: { trustedForAoiAnalysis: true },
    },
    {
      t: RECORDING_SAMPLE_INTERVAL_MS / 1000,
      source: 'mouse',
      screen: { x: 40, y: 60 },
      panorama: { yaw: 15, pitch: -5 },
      hits: ['logo'],
      likelyHits: [],
      possibleHits: ['logo'],
      ambiguousHits: ['logo'],
      quality: { trustedForAoiAnalysis: true },
    },
  ], {
    accuracyValidated: false,
    correctedAccuracySummary: null,
    selectedCalibrationProfile: RESEARCH_39_PROFILE,
    calibrationProfile: null,
    selectedValidationPolicyId: 'research',
    validationPolicyId: 'research',
    policyPassed: false,
    policyFailures: [POLICY_FAILURE],
    validationGazeStreamStats: VALIDATION_STREAM_STATS,
    faceQualityAvailable: false,
    faceQualityUnavailableReason: 'provider-no-face-quality',
    faceQualityBaseline: null,
    faceQualityInvalidations: [],
    gazeStreamStats: {
      events: [
        { atMs: 0, accepted: true },
        { atMs: 20, accepted: false, reason: 'stale' },
        { atMs: 40, accepted: true },
      ],
    },
  }, RECORDING_SAMPLE_INTERVAL_MS, {
    screenHeatmapDimensions: { width: 100, height: 80 },
  });

  assert.equal(summary.totalSamples, 2);
  assert.equal(summary.durationSec, 0.067);
  assert.equal(summary.recordingSampleIntervalMs, RECORDING_SAMPLE_INTERVAL_MS);
  assert.equal(summary.heatmaps.screen.type, 'screen');
  assert.equal(summary.heatmaps.screen.width, 100);
  assert.equal(summary.heatmaps.screen.height, 80);
  assert.equal(summary.heatmaps.screen.dimensionSource, 'provided');
  assert.equal(summary.heatmaps.screen.trustedOnly, true);
  assert.equal(summary.heatmaps.variants.trusted.screen.type, 'screen');
  assert.equal(summary.heatmaps.variants.trusted.panorama.type, 'panorama');
  assert.equal(summary.heatmaps.variants.likely.screen.totalWeightSec, 0.067);
  assert.equal(summary.heatmaps.variants.likely.panorama.totalWeightSec, 0.067);
  assert.equal(summary.heatmaps.variants.possible.screen.totalWeightSec, 0.067);
  assert.equal(summary.heatmaps.variants.possible.panorama.totalWeightSec, 0.067);
  assert.deepEqual(summary.heatmaps.screen.bins[0], {
    column: 9,
    row: 10,
    weightSec: 0.033,
    sampleCount: 1,
  });
  assert.equal(summary.heatmaps.panorama.type, 'panorama');
  assert.deepEqual(summary.heatmaps.panorama.yawRange, [-180, 180]);
  assert.deepEqual(summary.heatmaps.panorama.pitchRange, [-90, 90]);
  assert.equal(Array.isArray(summary.heatmaps.panorama.bins), true);
  assert.equal(Array.isArray(summary.heatmaps.screen.bins), true);
  assert.deepEqual(summary.selectedCalibrationProfile, RESEARCH_39_PROFILE);
  assert.equal(summary.calibrationProfile, null);
  assert.equal(summary.calibrationProfileUsed, null);
  assert.equal(summary.selectedValidationPolicyId, 'research');
  assert.equal(summary.validationPolicyId, 'research');
  assert.equal(summary.policyPassed, false);
  assert.deepEqual(summary.policyFailures, [POLICY_FAILURE]);
  assert.equal(summary.validationGazeStreamQuality.effectiveHz, 40);
  assert.equal(summary.validationGazeStreamQuality.dataIntegrityPercent, 100);
  assert.equal(summary.faceQualityAvailable, false);
  assert.equal(summary.faceQualityUnavailableReason, 'provider-no-face-quality');
  assert.equal(summary.faceQualityBaseline, null);
  assert.deepEqual(summary.faceQualityInvalidations, []);
  assert.equal(summary.benchmark.participantId, null);
  assert.equal(summary.benchmark.device, null);
  assert.equal(summary.benchmark.accuracy, null);
  assert.equal(summary.benchmark.recordingSampleIntervalMs, RECORDING_SAMPLE_INTERVAL_MS);
  assert.equal(summary.benchmark.durationSec, 0.067);
  assert.equal(summary.benchmark.gazeStreamQuality.effectiveHz, 50);
  assert.equal(summary.benchmark.validationGazeStreamQuality.effectiveHz, 40);
  assert.deepEqual(summary.benchmark.selectedCalibrationProfile, RESEARCH_39_PROFILE);
  assert.equal(summary.benchmark.calibrationProfileUsed, null);
  assert.equal(summary.benchmark.selectedValidationPolicyId, 'research');
  assert.equal(summary.benchmark.validationPolicyId, 'research');
  assert.equal(summary.benchmark.policyPassed, false);
  assert.deepEqual(summary.benchmark.policyFailures, [POLICY_FAILURE]);
  assert.equal(summary.benchmark.faceQualityAvailable, false);
  assert.equal(summary.benchmark.faceQualityUnavailableReason, 'provider-no-face-quality');
  assert.equal(summary.benchmark.faceStabilityInvalidationCount, 0);
  assert.equal(summary.benchmark.samples, undefined);
  assert.equal(summary.sources.mouse, 2);
  assert.equal(summary.aoiHitCounts.logo, 2);
  assert.equal(summary.likelyAoiHitCounts.logo, 1);
  assert.equal(summary.possibleAoiHitCounts.logo, 1);
  assert.equal(summary.ambiguousSampleCount, 1);
  assert.equal(summary.trustedSampleCount, 2);
  assert.equal(summary.gazeStreamQuality.effectiveHz, 50);
  assert.notEqual(
    summary.validationGazeStreamQuality.effectiveHz,
    summary.gazeStreamQuality.effectiveHz,
    'Validation quality should summarize validation stats, not recording stats.',
  );
  assert.equal(summary.gazeStreamQuality.droppedReasons.stale, 1);
});

test('falls back to inferred or no screen heatmap dimensions when export dimensions are omitted', () => {
  const inferredSummary = buildExportSummary([
    {
      t: 0,
      source: 'mouse',
      screen: { x: 5, y: 7 },
      panorama: { yaw: 0, pitch: 0 },
      hits: [],
      likelyHits: [],
      possibleHits: [],
      ambiguousHits: [],
      quality: { trustedForAoiAnalysis: true },
    },
    {
      t: 0.1,
      source: 'mouse',
      screen: { x: 999, y: 999 },
      panorama: { yaw: 45, pitch: 10 },
      hits: [],
      likelyHits: [],
      possibleHits: [],
      ambiguousHits: [],
      quality: { trustedForAoiAnalysis: false },
    },
  ], {}, 100);
  const emptySummary = buildExportSummary([], {}, 100);

  assert.equal(inferredSummary.heatmaps.screen.dimensionSource, 'inferred');
  assert.equal(inferredSummary.heatmaps.screen.width, 6);
  assert.equal(inferredSummary.heatmaps.screen.height, 8);
  assert.equal(inferredSummary.heatmaps.screen.trustedOnly, true);
  assert.deepEqual(inferredSummary.heatmaps.screen.bins, [
    { column: 40, row: 23, weightSec: 0.1, sampleCount: 1 },
  ]);
  assert.equal(emptySummary.heatmaps.screen.dimensionSource, 'none');
  assert.equal(emptySummary.heatmaps.screen.width, null);
  assert.equal(emptySummary.heatmaps.screen.height, null);
  assert.deepEqual(emptySummary.heatmaps.screen.bins, []);
});

test('exports raw gaze diagnostic and stable AOI metadata', () => {
  const summary = buildExportSummary([], {
    rawGazeDiagnostic: {
      latestSummary: { quality: 'coarse', p90JitterPx: 88 },
    },
    aoiStability: {
      trustedForAoiAnalysis: true,
    },
  });

  assert.equal(summary.rawGazeDiagnostic.quality, 'coarse');
  assert.equal(summary.aoiStability.trustedForAoiAnalysis, true);
});

test('keeps selected policy separate from unused validation policy metadata', () => {
  const pendingValidationStreamStats = {
    events: [
      { atMs: 0, accepted: true },
      { atMs: 25, accepted: true },
    ],
  };
  const summary = buildExportSummary([], {
    accuracyValidated: false,
    correctedAccuracySummary: null,
    selectedValidationPolicyId: 'research',
    activeValidationPolicyId: 'research',
    validationPolicyId: null,
    policyPassed: null,
    policyFailures: [],
    gazeStreamStats: {
      events: [
        { atMs: 0, accepted: true },
        { atMs: 50, accepted: true },
      ],
    },
    validationGazeStreamStats: pendingValidationStreamStats,
  });
  const payload = buildExportPayload({
    sourceVideo: 'blob:demo',
    exportedAt: '2026-06-11T00:00:00.000Z',
    participant: null,
    project: {
      selectedValidationPolicyId: 'research',
      validationPolicyId: null,
    },
    video: { name: 'demo.mp4' },
    summary,
    namedAoiMetrics: {},
    aoiSource: 'manual',
    aois: [],
    state: {
      selectedValidationPolicyId: 'research',
      activeValidationPolicyId: 'research',
      validationPolicyId: null,
      policyPassed: null,
      policyFailures: [],
      validationGazeStreamStats: pendingValidationStreamStats,
      faceQualityAvailable: false,
      faceQualityBaseline: null,
      faceQualityInvalidations: [],
      gazeStreamStats: summary.gazeStreamStats,
      samples: [],
    },
  });

  assert.equal(summary.selectedValidationPolicyId, 'research');
  assert.equal(summary.validationPolicyId, null);
  assert.equal(summary.policyPassed, null);
  assert.equal(payload.selectedValidationPolicyId, 'research');
  assert.equal(payload.validationPolicyId, null);
  assert.equal(payload.policyPassed, null);
});

test('builds video package metadata from source info and video element', () => {
  const metadata = buildVideoPackageMetadata({
    sourceVideoInfo: { name: 'demo.mp4', kind: 'local-file', projection: 'flat', stereoLayout: 'mono' },
    sourceVideo: { duration: 12.345, videoWidth: 1280, videoHeight: 720, currentSrc: 'blob:demo' },
  });

  assert.equal(metadata.name, 'demo.mp4');
  assert.equal(metadata.durationSec, 12.345);
  assert.equal(metadata.projection, 'flat');
  assert.equal(metadata.stereoLayout, 'mono');
  assert.equal(metadata.width, 1280);
  assert.equal(metadata.height, 720);
});

test('builds project package with selected and used calibration profile metadata', () => {
  const project = buildProjectPackage({
    sourceVideoInfo: { name: 'demo.mp4', kind: 'local-file', projection: 'flat', stereoLayout: 'mono' },
    sourceVideo: { duration: 12.345, videoWidth: 1280, videoHeight: 720, currentSrc: 'blob:demo' },
    aoiSource: 'manual',
    aois: [{ id: 'front' }],
    selectedCalibrationProfile: RESEARCH_78_PROFILE,
    calibrationProfile: STANDARD_PROFILE,
    selectedValidationPolicyId: 'research',
    validationPolicyId: 'prototype',
  });

  assert.deepEqual(project.selectedCalibrationProfile, RESEARCH_78_PROFILE);
  assert.deepEqual(project.calibrationProfile, STANDARD_PROFILE);
  assert.deepEqual(project.calibrationProfileUsed, STANDARD_PROFILE);
  assert.equal(project.selectedValidationPolicyId, 'research');
  assert.equal(project.validationPolicyId, 'prototype');
});

test('builds export payload with state-derived accuracy and samples', () => {
  const payload = buildExportPayload({
    sourceVideo: 'blob:demo',
    exportedAt: '2026-06-11T00:00:00.000Z',
    participant: { id: 'p1', device: 'lab laptop' },
    project: { version: 1 },
    video: { name: 'demo.mp4' },
    summary: { totalSamples: 1, recordingSampleIntervalMs: 1000 / 30, durationSec: 0.033 },
    namedAoiMetrics: {
      session: {
        averageNumberOfAoisFixated: 1,
        overallProcessingEfficiency: 64,
      },
      perAoi: {
        front: {
          id: 'front',
          label: 'Front',
          fixationCount: 1,
          totalFixationDurationMs: 120,
          timeToFirstFixationMs: 80,
        },
      },
    },
    aoiSource: 'manual',
    aois: [{ id: 'front' }],
    state: {
      correctedAccuracySummary: { meanPx: 8 },
      selectedCalibrationProfile: RESEARCH_78_PROFILE,
      calibrationProfile: RESEARCH_39_PROFILE,
      selectedValidationPolicyId: 'research',
      validationPolicyId: 'research',
      policyPassed: true,
      policyFailures: [],
      validationGazeStreamStats: VALIDATION_STREAM_STATS,
      faceQualityAvailable: false,
      faceQualityUnavailableReason: 'provider-no-face-quality',
      faceQualityBaseline: null,
      faceQualityInvalidations: [],
      accuracySummary: { meanPx: 10 },
      refinementAccuracySummary: { meanPx: 9 },
      gazeCorrection: { dx: 1, dy: -1 },
      localAccuracyErrorModel: { cells: [] },
      accuracyValidated: true,
      accuracyInvalidationReason: null,
      liveGazeQuality: { status: 'ready' },
      gazeStreamStats: {
        events: [
          { atMs: 0, accepted: true },
          { atMs: 50, accepted: true },
        ],
      },
      droppedGazeSamples: 0,
      samples: [{ t: 0 }],
    },
  });

  assert.equal(payload.sourceVideo, 'blob:demo');
  assert.equal(payload.accuracy.meanPx, 8);
  assert.deepEqual(payload.selectedCalibrationProfile, RESEARCH_78_PROFILE);
  assert.deepEqual(payload.calibrationProfile, RESEARCH_39_PROFILE);
  assert.deepEqual(payload.calibrationProfileUsed, RESEARCH_39_PROFILE);
  assert.equal(payload.selectedValidationPolicyId, 'research');
  assert.equal(payload.validationPolicyId, 'research');
  assert.equal(payload.policyPassed, true);
  assert.deepEqual(payload.policyFailures, []);
  assert.equal(payload.validationGazeStreamQuality.effectiveHz, 40);
  assert.equal(payload.validationGazeStreamQuality.dataIntegrityPercent, 100);
  assert.equal(payload.faceQualityAvailable, false);
  assert.equal(payload.faceQualityUnavailableReason, 'provider-no-face-quality');
  assert.equal(payload.faceQualityBaseline, null);
  assert.deepEqual(payload.faceQualityInvalidations, []);
  assert.equal(payload.gazeStreamQuality.effectiveHz, 20);
  assert.equal(payload.benchmark.participantId, 'p1');
  assert.equal(payload.benchmark.device, 'lab laptop');
  assert.deepEqual(payload.benchmark.accuracy, { meanPx: 8 });
  assert.equal(payload.benchmark.gazeStreamQuality.effectiveHz, 20);
  assert.equal(payload.benchmark.validationGazeStreamQuality.effectiveHz, 40);
  assert.deepEqual(payload.benchmark.selectedCalibrationProfile, RESEARCH_78_PROFILE);
  assert.deepEqual(payload.benchmark.calibrationProfileUsed, RESEARCH_39_PROFILE);
  assert.equal(payload.benchmark.selectedValidationPolicyId, 'research');
  assert.equal(payload.benchmark.validationPolicyId, 'research');
  assert.equal(payload.benchmark.policyPassed, true);
  assert.deepEqual(payload.benchmark.policyFailures, []);
  assert.equal(payload.benchmark.recordingSampleIntervalMs, 1000 / 30);
  assert.equal(payload.benchmark.durationSec, 0.033);
  assert.equal(payload.benchmark.faceQualityAvailable, false);
  assert.equal(payload.benchmark.faceQualityUnavailableReason, 'provider-no-face-quality');
  assert.equal(payload.benchmark.faceStabilityInvalidationCount, 0);
  assert.equal(payload.benchmark.samples, undefined);
  assert.deepEqual(payload.samples, [{ t: 0 }]);
  assert.equal(typeof payload.statReport, 'object');
  assert.equal(payload.statReport.exportedAt, '2026-06-11T00:00:00.000Z');
  assert.equal(Array.isArray(payload.statReport.perAoiRows), true);
  assert.equal(payload.statReport.perAoiRows.length, 1);
  assert.equal(payload.statReport.perAoiRows[0].aoiId, 'front');
  assert.ok(payload.statReport.perAoiRows[0].stats.some((stat) => stat.id === 'fixationCount'));
  assert.ok(payload.statReport.sessionStats.some((stat) => stat.id === 'overallProcessingEfficiency'));
  assert.equal(Array.isArray(payload.statReport.caveats), true);
  assert.ok(payload.statReport.caveats.length > 0);
});

test('clones compact benchmark metadata without sample or nested quality references', () => {
  const accuracy = { meanPx: 42, p90Px: 80, maxPx: 120 };
  const gazeStreamQuality = {
    effectiveHz: 29.97,
    dataIntegrityPercent: 96.5,
    droppedReasons: { stale: 1 },
  };
  const validationGazeStreamQuality = {
    effectiveHz: 30,
    dataIntegrityPercent: 100,
    droppedReasons: {},
  };
  const summary = buildExportSummary([
    { t: 0, source: 'webcam', hits: [], likelyHits: [], possibleHits: [], ambiguousHits: [], quality: { trustedForAoiAnalysis: true } },
  ], {
    participant: { id: 'P007', device: 'desktop webcam' },
    accuracyValidated: true,
    correctedAccuracySummary: accuracy,
    selectedCalibrationProfile: RESEARCH_78_PROFILE,
    calibrationProfile: RESEARCH_39_PROFILE,
    selectedValidationPolicyId: 'research',
    validationPolicyId: 'research',
    policyPassed: false,
    policyFailures: [POLICY_FAILURE],
    gazeStreamQuality,
    validationGazeStreamQuality,
    faceQualityAvailable: true,
    faceQualityUnavailableReason: null,
    faceQualityInvalidations: [
      { atMs: 10, reason: 'face-pose-drift', reasons: ['center-shift'] },
      { atMs: 20, reason: 'face-pose-drift', reasons: ['scale-change'] },
    ],
  });

  summary.benchmark.accuracy.meanPx = 999;
  summary.benchmark.gazeStreamQuality.droppedReasons.stale = 999;
  summary.benchmark.policyFailures[0].actual = 999;

  assert.equal(accuracy.meanPx, 42);
  assert.equal(gazeStreamQuality.droppedReasons.stale, 1);
  assert.equal(POLICY_FAILURE.actual, 12);
  assert.equal(summary.benchmark.participantId, 'P007');
  assert.equal(summary.benchmark.device, 'desktop webcam');
  assert.equal(summary.benchmark.faceStabilityInvalidationCount, 2);
  assert.equal(summary.benchmark.samples, undefined);
});

test('clones face quality metadata in export summary', () => {
  const faceQualityBaseline = { centerX: 200, centerY: 130, width: 200, height: 160, area: 32000 };
  const faceQualityInvalidations = [{
    atMs: 1234,
    reason: 'face-pose-drift',
    reasons: ['center-shift'],
    centerShift: 0.42,
    scaleChange: 0.2,
  }];
  const summary = buildExportSummary([], {
    accuracyValidated: true,
    correctedAccuracySummary: null,
    faceQualityAvailable: true,
    faceQualityBaseline,
    faceQualityInvalidations,
    gazeStreamStats: { events: [] },
  });

  summary.faceQualityBaseline.centerX = 999;
  summary.faceQualityInvalidations[0].reasons.push('scale-change');

  assert.equal(faceQualityBaseline.centerX, 200);
  assert.deepEqual(faceQualityInvalidations[0].reasons, ['center-shift']);
});

test('clones face quality metadata in project package', () => {
  const faceQualityBaseline = { centerX: 200, centerY: 130, width: 200, height: 160, area: 32000 };
  const faceQualityInvalidations = [{
    atMs: 1234,
    reason: 'face-pose-drift',
    reasons: ['center-shift'],
  }];
  const project = buildProjectPackage({
    sourceVideoInfo: { name: 'demo.mp4', kind: 'local-file', projection: 'flat', stereoLayout: 'mono' },
    sourceVideo: { duration: 12.345, videoWidth: 1280, videoHeight: 720, currentSrc: 'blob:demo' },
    aoiSource: 'manual',
    aois: [],
    faceQualityAvailable: true,
    faceQualityBaseline,
    faceQualityInvalidations,
  });

  project.faceQualityBaseline.centerY = 777;
  project.faceQualityInvalidations[0].reasons.push('scale-change');

  assert.equal(faceQualityBaseline.centerY, 130);
  assert.deepEqual(faceQualityInvalidations[0].reasons, ['center-shift']);
});

test('clones face quality metadata in export payload', () => {
  const stateBaseline = { centerX: 200, centerY: 130, width: 200, height: 160, area: 32000 };
  const stateInvalidations = [{
    atMs: 1234,
    reason: 'face-pose-drift',
    reasons: ['center-shift'],
  }];
  const summaryBaseline = { centerX: 201, centerY: 131, width: 201, height: 161, area: 32361 };
  const projectBaseline = { centerX: 202, centerY: 132, width: 202, height: 162, area: 32724 };
  const payload = buildExportPayload({
    sourceVideo: 'blob:demo',
    exportedAt: '2026-06-11T00:00:00.000Z',
    participant: null,
    project: {
      faceQualityBaseline: projectBaseline,
      faceQualityInvalidations: [{ reason: 'face-pose-drift', reasons: ['project'] }],
    },
    video: { name: 'demo.mp4' },
    summary: {
      faceQualityBaseline: summaryBaseline,
      faceQualityInvalidations: [{ reason: 'face-pose-drift', reasons: ['summary'] }],
    },
    namedAoiMetrics: {},
    aoiSource: 'manual',
    aois: [],
    state: {
      faceQualityAvailable: true,
      faceQualityBaseline: stateBaseline,
      faceQualityInvalidations: stateInvalidations,
      samples: [],
    },
  });

  payload.faceQualityBaseline.width = 999;
  payload.faceQualityInvalidations[0].reasons.push('scale-change');

  assert.equal(stateBaseline.width, 200);
  assert.deepEqual(stateInvalidations[0].reasons, ['center-shift']);
  assert.equal(summaryBaseline.width, 201);
  assert.equal(projectBaseline.width, 202);
});
