import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createDefaultAois,
  createInitialAppState,
  createInitialVideoInfo,
} from '../src/app/state.js';

test('creates fresh app state without shared mutable arrays', () => {
  const first = createInitialAppState();
  const second = createInitialAppState();

  first.samples.push({ t: 1 });
  first.accuracyTargetRejectCounts.push(1);
  first.gaze.x = 123;
  first.rawGazeDiagnostic.targets.push({ id: 'x' });
  first.aoiStability.scores.sign = 1;

  assert.equal(second.samples.length, 0);
  assert.deepEqual(second.accuracyTargetRejectCounts, []);
  assert.equal(second.gaze.x, 0);
  assert.equal(second.gaze.visible, false);
  assert.equal(second.webcamCalibrationTrained, false);
  assert.deepEqual(second.selectedCalibrationProfile, {
    id: 'standard',
    label: 'Standard',
    pointCount: 9,
    samplesPerPoint: 2,
  });
  assert.equal(second.calibrationProfile, null);
  assert.equal(second.selectedValidationPolicyId, 'prototype');
  assert.equal(second.validationPolicyId, null);
  assert.equal(second.policyPassed, null);
  assert.deepEqual(second.policyFailures, []);
  assert.equal(second.activeValidationPolicyId, null);
  assert.equal(second.validationGazeStreamStats, null);
  assert.equal(second.validationGazeStreamQuality, null);
  assert.equal(second.faceQualityAvailable, false);
  assert.equal(second.faceQualityUnavailableReason, null);
  assert.equal(second.faceQualityBaseline, null);
  assert.deepEqual(second.faceQualityInvalidations, []);
  assert.deepEqual(second.rawGazeDiagnostic.targets, []);
  assert.equal(second.rawGazeDiagnostic.latestSummary, null);
  assert.deepEqual(second.aoiStability, {
    scores: {},
    stableIds: [],
    stableHits: [],
    candidateAois: [],
    trustedForAoiAnalysis: false,
  });
});

test('creates initial video metadata for the default study video', () => {
  assert.deepEqual(createInitialVideoInfo(), {
    kind: 'study-video',
    id: 'nguyen-hue-360-0500',
    name: 'nguyen-hue-360-0500-0530.mp4',
    path: 'assets/replacement-videos/nguyen-hue-360-0500-0530.mp4',
    type: 'video/mp4',
    size: null,
    lastModified: null,
    projection: 'equirectangular',
    stereoLayout: 'mono',
  });
});

test('creates fresh default AOI definitions', () => {
  const first = createDefaultAois();
  const second = createDefaultAois();

  first[0].label = 'Changed';

  assert.notEqual(second[0].label, 'Changed');
  assert.equal(second.some((aoi) => aoi.id === 'front-center'), true);
});
