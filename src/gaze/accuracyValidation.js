import {
  applyViewportCalibration,
  buildAccuracyCorrection,
  buildLocalAccuracyErrorModel,
  hasSufficientSpatialCoverage,
  isAccuracyValidationUsable,
  normalizeAccuracySample,
  summarizeAccuracy,
} from './gazeQuality.js';

function normalizeSamples(samples) {
  return samples.map((sample) => normalizeAccuracySample(sample, sample.viewport));
}

function buildFailedResult(reason) {
  return {
    validationPassed: false,
    reason,
    accuracySummary: summarizeAccuracy([]),
  };
}

export function evaluateAccuracyCheck({
  refinementSamples,
  validationSamples,
  minAcceptedRefinementTargets,
  minAcceptedValidationTargets,
}) {
  if (
    refinementSamples.length < minAcceptedRefinementTargets ||
    validationSamples.length < minAcceptedValidationTargets
  ) {
    return buildFailedResult('too-few-targets');
  }

  const normalizedRefinementSamples = normalizeSamples(refinementSamples);
  const normalizedValidationSamples = normalizeSamples(validationSamples);

  if (
    !hasSufficientSpatialCoverage(normalizedRefinementSamples, { minXRange: 0.45, minYRange: 0.45 }) ||
    !hasSufficientSpatialCoverage(normalizedValidationSamples, { minXRange: 0.22, minYRange: 0.22 })
  ) {
    return buildFailedResult('insufficient-coverage');
  }

  const refinement = buildAccuracyCorrection(normalizedRefinementSamples, {
    maxCorrectedMeanPx: 0.2,
  });
  const correctedValidationSamples = validationSamples.map((sample) => ({
    ...sample,
    gaze: applyViewportCalibration(sample.gaze, refinement.calibration, sample.viewport),
  }));
  const validationSummary = summarizeAccuracy(validationSamples);
  const correctedValidationSummary = summarizeAccuracy(correctedValidationSamples);
  const validationPassed = isAccuracyValidationUsable(correctedValidationSummary, {
    minSamples: minAcceptedValidationTargets,
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

  return {
    validationPassed,
    reason: validationPassed ? null : 'failed-validation-thresholds',
    refinement,
    validationSummary,
    accuracySummary: validationSummary,
    correctedValidationSummary,
    correctedValidationSamples,
    liveCalibration,
    localAccuracyErrorModel: validationPassed
      ? buildLocalAccuracyErrorModel(correctedValidationSamples)
      : null,
  };
}
