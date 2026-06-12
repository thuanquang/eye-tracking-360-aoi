import {
  applyViewportCalibration,
  buildAccuracyCorrection,
  buildLocalAccuracyErrorModel,
  hasSufficientSpatialCoverage,
  isAccuracyValidationUsable,
  normalizeAccuracySample,
  summarizeAccuracy,
} from './gazeQuality.js';
import {
  getValidationPolicy,
  getValidationPolicyFailures,
} from './validationPolicy.js';

function normalizeSamples(samples) {
  return samples.map((sample) => normalizeAccuracySample(sample, sample.viewport));
}

function buildValidationFailure(reason) {
  return {
    metric: 'validation',
    actual: reason,
    limit: 'pass',
    comparator: '==',
  };
}

function buildFailedResult(reason, policy) {
  const validationPolicy = getValidationPolicy(policy);

  return {
    validationPassed: false,
    reason,
    validationPolicyId: validationPolicy.id,
    policyPassed: false,
    policyFailures: [buildValidationFailure(reason)],
    accuracySummary: summarizeAccuracy([]),
  };
}

export function evaluateAccuracyCheck({
  refinementSamples,
  validationSamples,
  minAcceptedRefinementTargets,
  minAcceptedValidationTargets,
  policy = getValidationPolicy(),
  streamQuality = null,
}) {
  const validationPolicy = getValidationPolicy(policy);

  if (
    refinementSamples.length < minAcceptedRefinementTargets ||
    validationSamples.length < minAcceptedValidationTargets
  ) {
    return buildFailedResult('too-few-targets', validationPolicy);
  }

  const normalizedRefinementSamples = normalizeSamples(refinementSamples);
  const normalizedValidationSamples = normalizeSamples(validationSamples);

  if (
    !hasSufficientSpatialCoverage(normalizedRefinementSamples, { minXRange: 0.45, minYRange: 0.45 }) ||
    !hasSufficientSpatialCoverage(normalizedValidationSamples, { minXRange: 0.22, minYRange: 0.22 })
  ) {
    return buildFailedResult('insufficient-coverage', validationPolicy);
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
  const accuracyThresholdsPassed = isAccuracyValidationUsable(correctedValidationSummary, {
    minSamples: minAcceptedValidationTargets,
  });
  const policyFailures = getValidationPolicyFailures({
    summary: correctedValidationSummary,
    streamQuality,
    policy: validationPolicy,
  });
  const policyPassed = policyFailures.length === 0;
  const validationPassed = accuracyThresholdsPassed && policyPassed;
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
    reason: validationPassed
      ? null
      : accuracyThresholdsPassed ? 'failed-validation-policy' : 'failed-validation-thresholds',
    validationPolicyId: validationPolicy.id,
    policyPassed,
    policyFailures,
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
