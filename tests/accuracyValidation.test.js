import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ACCURACY_REFINEMENT_POINTS,
  ACCURACY_VALIDATION_POINTS,
  CALIBRATION_POINTS,
  getTargetPointsForMode,
} from '../src/gaze/calibrationTargets.js';
import { evaluateAccuracyCheck } from '../src/gaze/accuracyValidation.js';
import { getValidationPolicy } from '../src/gaze/validationPolicy.js';

const VIEWPORT = { width: 1000, height: 800 };

function targetPercentToPixels(point) {
  return {
    x: (point.x / 100) * VIEWPORT.width,
    y: (point.y / 100) * VIEWPORT.height,
  };
}

function gazeForTarget(target) {
  return {
    x: target.x + 80,
    y: target.y - 40,
  };
}

function sampleFromTargetPoint(point) {
  const target = targetPercentToPixels(point);

  return {
    target,
    gaze: gazeForTarget(target),
    sampleCount: 8,
    dispersionPx: 12,
    errorPx: Math.hypot(80, -40),
    viewport: VIEWPORT,
  };
}

test('exports calibration and accuracy target sets', () => {
  assert.equal(CALIBRATION_POINTS.length, 9);
  assert.equal(ACCURACY_REFINEMENT_POINTS.length, 9);
  assert.equal(ACCURACY_VALIDATION_POINTS.length, 8);
  assert.equal(getTargetPointsForMode('accuracy').length, 17);
  assert.equal(getTargetPointsForMode('calibration').length, CALIBRATION_POINTS.length);
});

test('calibration and accuracy targets cover the horizontal edges', () => {
  assert.equal(Math.min(...CALIBRATION_POINTS.map((point) => point.x)) <= 15, true);
  assert.equal(Math.max(...CALIBRATION_POINTS.map((point) => point.x)) >= 85, true);
  assert.equal(Math.min(...ACCURACY_REFINEMENT_POINTS.map((point) => point.x)) <= 14, true);
  assert.equal(Math.max(...ACCURACY_REFINEMENT_POINTS.map((point) => point.x)) >= 86, true);
  assert.equal(Math.min(...ACCURACY_VALIDATION_POINTS.map((point) => point.x)) <= 25, true);
  assert.equal(Math.max(...ACCURACY_VALIDATION_POINTS.map((point) => point.x)) >= 75, true);
});

test('passes accuracy check using separate holdout validation targets', () => {
  const result = evaluateAccuracyCheck({
    refinementSamples: ACCURACY_REFINEMENT_POINTS.map(sampleFromTargetPoint),
    validationSamples: ACCURACY_VALIDATION_POINTS.map(sampleFromTargetPoint),
    minAcceptedRefinementTargets: 8,
    minAcceptedValidationTargets: 7,
  });

  assert.equal(result.validationPassed, true);
  assert.equal(result.validationPolicyId, 'prototype');
  assert.equal(result.policyPassed, true);
  assert.deepEqual(result.policyFailures, []);
  assert.equal(result.reason, null);
  assert.equal(result.correctedValidationSummary.quality, 'good');
  assert.equal(result.correctedValidationSummary.count, ACCURACY_VALIDATION_POINTS.length);
  assert.equal(Boolean(result.liveCalibration), true);
  assert.equal(Boolean(result.localAccuracyErrorModel), true);
});

test('reports research policy failures with stream quality details', () => {
  const result = evaluateAccuracyCheck({
    refinementSamples: ACCURACY_REFINEMENT_POINTS.map(sampleFromTargetPoint),
    validationSamples: ACCURACY_VALIDATION_POINTS.map(sampleFromTargetPoint),
    minAcceptedRefinementTargets: 8,
    minAcceptedValidationTargets: 7,
    policy: getValidationPolicy('research'),
    streamQuality: { effectiveHz: 12, dataIntegrityPercent: 92 },
  });

  assert.equal(result.validationPassed, false);
  assert.equal(result.reason, 'failed-validation-policy');
  assert.equal(result.validationPolicyId, 'research');
  assert.equal(result.policyPassed, false);
  assert.deepEqual(result.policyFailures.map((failure) => failure.metric), ['effectiveHz']);
  assert.equal(result.policyFailures[0].actual, 12);
  assert.equal(result.policyFailures[0].limit, 20);
});

test('reports too few accepted accuracy targets', () => {
  const result = evaluateAccuracyCheck({
    refinementSamples: ACCURACY_REFINEMENT_POINTS.slice(0, 4).map(sampleFromTargetPoint),
    validationSamples: ACCURACY_VALIDATION_POINTS.slice(0, 4).map(sampleFromTargetPoint),
    minAcceptedRefinementTargets: 8,
    minAcceptedValidationTargets: 7,
  });

  assert.equal(result.validationPassed, false);
  assert.equal(result.reason, 'too-few-targets');
  assert.equal(result.accuracySummary.quality, 'untested');
});

test('reports insufficient spatial coverage before fitting correction', () => {
  const clusteredRefinementSamples = Array.from({ length: 8 }, (_, index) => (
    sampleFromTargetPoint({ x: 48 + index * 0.5, y: 48 + index * 0.5 })
  ));
  const clusteredValidationSamples = Array.from({ length: 7 }, (_, index) => (
    sampleFromTargetPoint({ x: 49 + index * 0.4, y: 49 + index * 0.4 })
  ));

  const result = evaluateAccuracyCheck({
    refinementSamples: clusteredRefinementSamples,
    validationSamples: clusteredValidationSamples,
    minAcceptedRefinementTargets: 8,
    minAcceptedValidationTargets: 7,
  });

  assert.equal(result.validationPassed, false);
  assert.equal(result.reason, 'insufficient-coverage');
  assert.equal(result.accuracySummary.quality, 'untested');
});
