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

const STANDARD_PROFILE = { id: 'standard', label: 'Standard', pointCount: 14 };
const RESEARCH_39_PROFILE = { id: 'research-39', label: 'Research 39', pointCount: 39 };
const RESEARCH_78_PROFILE = { id: 'research-78', label: 'Research 78', pointCount: 78 };

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

test('builds summary counts and duration from samples', () => {
  const summary = buildExportSummary([
    { t: 0, source: 'mouse', hits: ['logo'], likelyHits: ['logo'], possibleHits: [], ambiguousHits: [], quality: { trustedForAoiAnalysis: true } },
    { t: RECORDING_SAMPLE_INTERVAL_MS / 1000, source: 'mouse', hits: ['logo'], likelyHits: [], possibleHits: ['logo'], ambiguousHits: ['logo'], quality: { trustedForAoiAnalysis: true } },
  ], {
    accuracyValidated: false,
    correctedAccuracySummary: null,
    selectedCalibrationProfile: RESEARCH_39_PROFILE,
    calibrationProfile: null,
    gazeStreamStats: {
      events: [
        { atMs: 0, accepted: true },
        { atMs: 20, accepted: false, reason: 'stale' },
        { atMs: 40, accepted: true },
      ],
    },
  });

  assert.equal(summary.totalSamples, 2);
  assert.equal(summary.durationSec, 0.067);
  assert.equal(summary.recordingSampleIntervalMs, RECORDING_SAMPLE_INTERVAL_MS);
  assert.deepEqual(summary.selectedCalibrationProfile, RESEARCH_39_PROFILE);
  assert.equal(summary.calibrationProfile, null);
  assert.equal(summary.calibrationProfileUsed, null);
  assert.equal(summary.sources.mouse, 2);
  assert.equal(summary.aoiHitCounts.logo, 2);
  assert.equal(summary.likelyAoiHitCounts.logo, 1);
  assert.equal(summary.possibleAoiHitCounts.logo, 1);
  assert.equal(summary.ambiguousSampleCount, 1);
  assert.equal(summary.trustedSampleCount, 2);
  assert.equal(summary.gazeStreamQuality.effectiveHz, 50);
  assert.equal(summary.gazeStreamQuality.droppedReasons.stale, 1);
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
  });

  assert.deepEqual(project.selectedCalibrationProfile, RESEARCH_78_PROFILE);
  assert.deepEqual(project.calibrationProfile, STANDARD_PROFILE);
  assert.deepEqual(project.calibrationProfileUsed, STANDARD_PROFILE);
});

test('builds export payload with state-derived accuracy and samples', () => {
  const payload = buildExportPayload({
    sourceVideo: 'blob:demo',
    exportedAt: '2026-06-11T00:00:00.000Z',
    participant: { id: 'p1' },
    project: { version: 1 },
    video: { name: 'demo.mp4' },
    summary: { totalSamples: 1 },
    namedAoiMetrics: { Front: { samples: 1 } },
    aoiSource: 'manual',
    aois: [{ id: 'front' }],
    state: {
      correctedAccuracySummary: { meanPx: 8 },
      selectedCalibrationProfile: RESEARCH_78_PROFILE,
      calibrationProfile: RESEARCH_39_PROFILE,
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
  assert.equal(payload.gazeStreamQuality.effectiveHz, 20);
  assert.deepEqual(payload.samples, [{ t: 0 }]);
});
