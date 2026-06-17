import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyAffineCalibration,
  applyViewportCalibration,
  buildLocalAccuracyErrorModel,
  buildAccuracyCorrection,
  computeAffineCalibration,
  denormalizePointFromViewport,
  distanceBetweenPoints,
  estimateLocalAccuracyErrorPx,
  getAdaptiveSmoothingAlpha,
  getRobustPointAverage,
  hasSufficientSpatialCoverage,
  summarizeTargetSamples,
  isGazeInsideViewport,
  normalizeAccuracySample,
  normalizePointToViewport,
  isPlausibleGazeJump,
  isAccuracyValidationUsable,
  isValidationFresh,
  shouldCaptureFreshGazeSample,
  shouldContinueTargetSampleCapture,
  shouldTrainFreshGazeSample,
  updateLiveGazeQuality,
  resolveGazeUpdate,
  smoothGazePoint,
  summarizeAccuracy,
} from '../src/gaze/gazeQuality.js';

test('smooths webcam gaze toward the newest point', () => {
  const result = smoothGazePoint(
    { x: 100, y: 200, visible: true, source: 'webcam' },
    { x: 200, y: 260, visible: true, source: 'webcam' },
    0.25,
  );

  assert.deepEqual(result, {
    x: 125,
    y: 215,
    visible: true,
    source: 'webcam',
  });
});

test('increases smoothing alpha for larger intentional gaze movement', () => {
  const previous = { x: 100, y: 100, visible: true };
  const smallMoveAlpha = getAdaptiveSmoothingAlpha(previous, { x: 112, y: 100 }, {
    minAlpha: 0.16,
    maxAlpha: 0.56,
    fastDistancePx: 240,
  });
  const largeMoveAlpha = getAdaptiveSmoothingAlpha(previous, { x: 340, y: 100 }, {
    minAlpha: 0.16,
    maxAlpha: 0.56,
    fastDistancePx: 240,
  });

  assert.equal(smallMoveAlpha < largeMoveAlpha, true);
  assert.equal(Math.round(largeMoveAlpha * 100), 56);
});

test('keeps first gaze point unchanged when there is no previous point', () => {
  const next = { x: 240, y: 320, visible: true, source: 'webcam' };

  assert.deepEqual(smoothGazePoint(null, next, 0.25), next);
});

test('uses median-centered robust point averages to reduce outlier impact', () => {
  const average = getRobustPointAverage([
    { x: 100, y: 100 },
    { x: 104, y: 98 },
    { x: 96, y: 102 },
    { x: 500, y: 500 },
  ]);

  assert.deepEqual(average, { x: 100, y: 100 });
});

test('summarizes target sample quality with robust average and dispersion', () => {
  const summary = summarizeTargetSamples([
    { x: 100, y: 100 },
    { x: 102, y: 98 },
    { x: 98, y: 102 },
    { x: 101, y: 99 },
  ]);

  assert.equal(summary.accepted, true);
  assert.equal(summary.count, 4);
  assert.ok(distanceBetweenPoints(summary.gaze, { x: 100, y: 100 }) < 2);
  assert.ok(summary.dispersionPx < 3);
});

test('rejects target sample groups that are too sparse or unstable', () => {
  const sparse = summarizeTargetSamples([{ x: 100, y: 100 }, { x: 102, y: 99 }], {
    minSamples: 3,
    maxDispersionPx: 80,
  });
  const unstable = summarizeTargetSamples([
    { x: 100, y: 100 },
    { x: 210, y: 100 },
    { x: 340, y: 100 },
    { x: 460, y: 100 },
  ], {
    minSamples: 3,
    maxDispersionPx: 80,
  });

  assert.equal(sparse.accepted, false);
  assert.equal(sparse.reason, 'too-few-samples');
  assert.equal(unstable.accepted, false);
  assert.equal(unstable.reason, 'unstable');
});

test('continues target capture after nominal slots only while samples are too sparse', () => {
  assert.equal(shouldContinueTargetSampleCapture({
    sampleSlots: 12,
    acceptedSamples: 6,
    nominalSampleSlots: 12,
    minAcceptedSamples: 7,
    elapsedMs: 700,
    maxDurationMs: 1320,
  }), true);

  assert.equal(shouldContinueTargetSampleCapture({
    sampleSlots: 12,
    acceptedSamples: 7,
    nominalSampleSlots: 12,
    minAcceptedSamples: 7,
    elapsedMs: 700,
    maxDurationMs: 1320,
  }), false);

  assert.equal(shouldContinueTargetSampleCapture({
    sampleSlots: 13,
    acceptedSamples: 6,
    nominalSampleSlots: 12,
    minAcceptedSamples: 7,
    elapsedMs: 1320,
    maxDurationMs: 1320,
  }), false);
});

test('rejects implausibly large gaze jumps', () => {
  const previous = { x: 100, y: 100 };

  assert.equal(isPlausibleGazeJump(previous, { x: 230, y: 120 }, 260), true);
  assert.equal(isPlausibleGazeJump(previous, { x: 900, y: 700 }, 260), false);
});

test('checks gaze viewport bounds with optional margin', () => {
  const viewport = { width: 900, height: 500 };

  assert.equal(isGazeInsideViewport({ x: 450, y: 250 }, viewport), true);
  assert.equal(isGazeInsideViewport({ x: 930, y: 250 }, viewport), false);
  assert.equal(isGazeInsideViewport({ x: 930, y: 250 }, viewport, 40), true);
  assert.equal(isGazeInsideViewport({ x: 1300, y: 250 }, viewport, 40), false);
});

test('captures only fresh in-bounds raw gaze samples for calibration and accuracy checks', () => {
  const viewport = { width: 900, height: 500 };
  const now = 1000;

  assert.equal(shouldCaptureFreshGazeSample({
    gaze: { x: 450, y: 250 },
    capturedAt: 900,
    now,
    maxAgeMs: 180,
    viewport,
    boundsMarginPx: 40,
  }), true);
  assert.equal(shouldCaptureFreshGazeSample({
    gaze: { x: 450, y: 250 },
    capturedAt: 700,
    now,
    maxAgeMs: 180,
    viewport,
    boundsMarginPx: 40,
  }), false);
  assert.equal(shouldCaptureFreshGazeSample({
    gaze: { x: 1300, y: 250 },
    capturedAt: 900,
    now,
    maxAgeMs: 180,
    viewport,
    boundsMarginPx: 40,
  }), false);
});

test('trains only from fresh gaze that stays near the accepted target cluster', () => {
  const viewport = { width: 900, height: 500 };
  const acceptedGaze = { x: 450, y: 250 };
  const now = 1000;

  assert.equal(shouldTrainFreshGazeSample({
    gaze: { x: 470, y: 260 },
    acceptedGaze,
    capturedAt: 940,
    now,
    maxAgeMs: 180,
    viewport,
    boundsMarginPx: 40,
    maxDistanceFromAcceptedPx: 80,
  }), true);
  assert.equal(shouldTrainFreshGazeSample({
    gaze: { x: 470, y: 260 },
    acceptedGaze,
    capturedAt: 700,
    now,
    maxAgeMs: 180,
    viewport,
    boundsMarginPx: 40,
    maxDistanceFromAcceptedPx: 80,
  }), false);
  assert.equal(shouldTrainFreshGazeSample({
    gaze: { x: 650, y: 250 },
    acceptedGaze,
    capturedAt: 940,
    now,
    maxAgeMs: 180,
    viewport,
    boundsMarginPx: 40,
    maxDistanceFromAcceptedPx: 80,
  }), false);
});

test('drops out-of-bounds gaze samples without making right-edge drift sticky', () => {
  const viewport = { width: 900, height: 500 };
  const outOfBounds = resolveGazeUpdate({
    previous: null,
    next: { x: 1260, y: 240, visible: true, source: 'webcam' },
    viewport,
    alpha: 0.2,
    maxJumpPx: 360,
  });

  assert.equal(outOfBounds.accepted, false);
  assert.equal(outOfBounds.reason, 'out-of-bounds');
  assert.deepEqual(outOfBounds.gaze, {
    x: 0,
    y: 0,
    visible: false,
    source: 'webcam',
  });

  const recovered = resolveGazeUpdate({
    previous: outOfBounds.gaze,
    next: { x: 450, y: 250, visible: true, source: 'webcam' },
    viewport,
    alpha: 0.2,
    maxJumpPx: 360,
  });

  assert.equal(recovered.accepted, true);
  assert.deepEqual(recovered.gaze, {
    x: 450,
    y: 250,
    visible: true,
    source: 'webcam',
  });
});

test('marks live gaze quality unreliable after sustained tracking failures', () => {
  let quality = null;

  for (let index = 0; index < 6; index += 1) {
    quality = updateLiveGazeQuality(quality, {
      accepted: true,
      reason: null,
    }, {
      maxEvents: 10,
      minEvents: 6,
      maxBadRate: 0.5,
      maxConsecutiveBad: 4,
    });
  }

  assert.equal(quality.unreliable, false);

  for (let index = 0; index < 4; index += 1) {
    quality = updateLiveGazeQuality(quality, {
      accepted: false,
      reason: 'raw-out-of-bounds',
    }, {
      maxEvents: 10,
      minEvents: 6,
      maxBadRate: 0.5,
      maxConsecutiveBad: 4,
    });
  }

  assert.equal(quality.unreliable, true);
  assert.equal(quality.consecutiveBad, 4);
  assert.equal(quality.reason, 'consecutive-bad-gaze');
});

test('computes affine gaze calibration that corrects offset and scale bias', () => {
  const calibration = computeAffineCalibration([
    { gaze: { x: 150, y: 100 }, target: { x: 100, y: 80 } },
    { gaze: { x: 1050, y: 100 }, target: { x: 820, y: 80 } },
    { gaze: { x: 150, y: 600 }, target: { x: 100, y: 480 } },
    { gaze: { x: 1050, y: 600 }, target: { x: 820, y: 480 } },
    { gaze: { x: 600, y: 350 }, target: { x: 460, y: 280 } },
  ]);

  assert.equal(calibration.isIdentity, false);

  const corrected = applyAffineCalibration(
    { x: 600, y: 350, visible: true, source: 'webcam' },
    calibration,
  );

  assert.equal(Math.round(corrected.x), 460);
  assert.equal(Math.round(corrected.y), 280);
  assert.equal(corrected.visible, true);
  assert.equal(corrected.source, 'webcam');
});

test('applies affine calibration in normalized viewport space across resize', () => {
  const originalViewport = { width: 1000, height: 500 };
  const resizedViewport = { width: 500, height: 250 };
  const normalizedSamples = [
    normalizeAccuracySample(
      { gaze: { x: 150, y: 100 }, target: { x: 100, y: 80 } },
      originalViewport,
    ),
    normalizeAccuracySample(
      { gaze: { x: 850, y: 100 }, target: { x: 780, y: 80 } },
      originalViewport,
    ),
    normalizeAccuracySample(
      { gaze: { x: 150, y: 420 }, target: { x: 100, y: 380 } },
      originalViewport,
    ),
    normalizeAccuracySample(
      { gaze: { x: 850, y: 420 }, target: { x: 780, y: 380 } },
      originalViewport,
    ),
    normalizeAccuracySample(
      { gaze: { x: 500, y: 260 }, target: { x: 440, y: 230 } },
      originalViewport,
    ),
  ];
  const calibration = computeAffineCalibration(normalizedSamples);
  const corrected = applyViewportCalibration(
    { x: 250, y: 130, visible: true, source: 'webcam' },
    calibration,
    resizedViewport,
  );

  assert.equal(Math.round(corrected.x), 220);
  assert.equal(Math.round(corrected.y), 115);
  assert.equal(corrected.visible, true);
});

test('normalizes and denormalizes viewport points without losing metadata', () => {
  const viewport = { width: 800, height: 400 };
  const normalized = normalizePointToViewport(
    { x: 200, y: 100, visible: true, source: 'webcam' },
    viewport,
  );

  assert.deepEqual(normalized, {
    x: 0.25,
    y: 0.25,
    visible: true,
    source: 'webcam',
  });
  assert.deepEqual(denormalizePointFromViewport(normalized, viewport), {
    x: 200,
    y: 100,
    visible: true,
    source: 'webcam',
  });
});

test('accepts accuracy correction only when it materially improves validation error', () => {
  const refinement = buildAccuracyCorrection([
    { gaze: { x: 150, y: 100 }, target: { x: 100, y: 80 } },
    { gaze: { x: 1050, y: 100 }, target: { x: 820, y: 80 } },
    { gaze: { x: 150, y: 600 }, target: { x: 100, y: 480 } },
    { gaze: { x: 1050, y: 600 }, target: { x: 820, y: 480 } },
    { gaze: { x: 600, y: 350 }, target: { x: 460, y: 280 } },
  ]);

  assert.equal(refinement.accepted, true);
  assert.ok(refinement.correctedSummary.meanPx < refinement.rawSummary.meanPx);
});

test('fits accuracy correction from the stable subset when one refinement target is an outlier', () => {
  const goodSamples = [
    { gaze: { x: 0.18, y: 0.18 }, target: { x: 0.10, y: 0.23 } },
    { gaze: { x: 0.48, y: 0.18 }, target: { x: 0.40, y: 0.23 } },
    { gaze: { x: 0.78, y: 0.18 }, target: { x: 0.70, y: 0.23 } },
    { gaze: { x: 0.18, y: 0.58 }, target: { x: 0.10, y: 0.63 } },
    { gaze: { x: 0.48, y: 0.58 }, target: { x: 0.40, y: 0.63 } },
    { gaze: { x: 0.78, y: 0.58 }, target: { x: 0.70, y: 0.63 } },
    { gaze: { x: 0.48, y: 0.38 }, target: { x: 0.40, y: 0.43 } },
  ];
  const refinement = buildAccuracyCorrection(
    [
      ...goodSamples,
      { gaze: { x: 0.82, y: 0.82 }, target: { x: 0.12, y: 0.12 } },
    ],
    { maxCorrectedMeanPx: 0.05 },
  );
  const correctedGoodSummary = summarizeAccuracy(goodSamples.map((sample) => ({
    ...sample,
    gaze: applyAffineCalibration(sample.gaze, refinement.calibration),
  })));

  assert.equal(refinement.accepted, true);
  assert.equal(refinement.rejectedSampleCount, 1);
  assert.ok(correctedGoodSummary.meanPx < 0.01);
});

test('uses local residual anchors to reduce nonlinear webcam gaze distortion', () => {
  const curvedGazeForTarget = (target) => ({
    x: target.x + Math.sin(target.x * Math.PI * 2) * 0.045,
    y: target.y + Math.cos(target.y * Math.PI * 2) * 0.035,
  });
  const targets = [
    { x: 0.18, y: 0.18 },
    { x: 0.50, y: 0.18 },
    { x: 0.82, y: 0.18 },
    { x: 0.18, y: 0.50 },
    { x: 0.50, y: 0.50 },
    { x: 0.82, y: 0.50 },
    { x: 0.18, y: 0.82 },
    { x: 0.50, y: 0.82 },
    { x: 0.82, y: 0.82 },
  ];
  const samples = targets.map((target) => ({
    target,
    gaze: curvedGazeForTarget(target),
  }));
  const affineOnly = computeAffineCalibration(samples);
  const refinement = buildAccuracyCorrection(samples, {
    maxCorrectedMeanPx: 0.03,
    minImprovementRatio: 0.01,
  });
  const heldOutTarget = { x: 0.36, y: 0.50 };
  const heldOutGaze = curvedGazeForTarget(heldOutTarget);
  const affineError = distanceBetweenPoints(
    heldOutTarget,
    applyAffineCalibration(heldOutGaze, affineOnly),
  );
  const localError = distanceBetweenPoints(
    heldOutTarget,
    applyAffineCalibration(heldOutGaze, refinement.calibration),
  );

  assert.equal(refinement.accepted, true);
  assert.ok(refinement.calibration.residuals?.anchors.length >= targets.length);
  assert.ok(localError < affineError * 0.6);
});

test('selects local residual radius that improves between-target curved distortion', () => {
  const barrelGazeForTarget = (target) => {
    const dx = target.x - 0.5;
    const dy = target.y - 0.5;
    const radiusSquared = dx * dx + dy * dy;

    return {
      x: target.x + dx * radiusSquared * 1.7,
      y: target.y + dy * radiusSquared * 1.4,
    };
  };
  const targets = [
    { x: 0.15, y: 0.15 },
    { x: 0.5, y: 0.15 },
    { x: 0.85, y: 0.15 },
    { x: 0.15, y: 0.5 },
    { x: 0.85, y: 0.5 },
    { x: 0.15, y: 0.85 },
    { x: 0.5, y: 0.85 },
    { x: 0.85, y: 0.85 },
  ];
  const holdoutTargets = [
    { x: 0.35, y: 0.35 },
    { x: 0.65, y: 0.35 },
    { x: 0.35, y: 0.65 },
    { x: 0.65, y: 0.65 },
    { x: 0.5, y: 0.3 },
    { x: 0.3, y: 0.5 },
    { x: 0.7, y: 0.5 },
    { x: 0.5, y: 0.7 },
  ];
  const refinement = buildAccuracyCorrection(
    targets.map((target) => ({
      target,
      gaze: barrelGazeForTarget(target),
    })),
    {
      maxCorrectedMeanPx: 0.1,
      minImprovementRatio: 0.01,
    },
  );
  const holdoutErrors = holdoutTargets.map((target) => distanceBetweenPoints(
    target,
    applyAffineCalibration(barrelGazeForTarget(target), refinement.calibration),
  ));
  const holdoutMean = holdoutErrors.reduce((sum, error) => sum + error, 0) / holdoutErrors.length;

  assert.equal(refinement.accepted, true);
  assert.ok(holdoutMean < 0.012);
  assert.ok(Math.max(...holdoutErrors) < 0.017);
});

test('rejects accuracy correction when validation samples are degenerate', () => {
  const refinement = buildAccuracyCorrection([
    { gaze: { x: 100, y: 100 }, target: { x: 100, y: 80 } },
    { gaze: { x: 100, y: 100 }, target: { x: 820, y: 80 } },
    { gaze: { x: 100, y: 100 }, target: { x: 100, y: 480 } },
  ]);

  assert.equal(refinement.accepted, false);
  assert.equal(refinement.calibration.isIdentity, true);
});

test('falls back to identity affine calibration for degenerate samples', () => {
  const calibration = computeAffineCalibration([
    { gaze: { x: 100, y: 100 }, target: { x: 120, y: 120 } },
    { gaze: { x: 100, y: 100 }, target: { x: 120, y: 120 } },
  ]);

  assert.equal(calibration.isIdentity, true);
  assert.deepEqual(applyAffineCalibration({ x: 42, y: 36 }, calibration), { x: 42, y: 36 });
  assert.deepEqual(applyAffineCalibration({ x: 42, y: 36 }, null), { x: 42, y: 36 });
});

test('summarizes validation accuracy with mean median and quality label', () => {
  const summary = summarizeAccuracy([
    { target: { x: 100, y: 100 }, gaze: { x: 130, y: 140 }, dispersionPx: 12 },
    { target: { x: 500, y: 300 }, gaze: { x: 600, y: 300 }, dispersionPx: 30 },
    { target: { x: 900, y: 700 }, gaze: { x: 1120, y: 700 }, dispersionPx: 60 },
  ]);

  assert.equal(Math.round(distanceBetweenPoints({ x: 100, y: 100 }, { x: 130, y: 140 })), 50);
  assert.equal(summary.count, 3);
  assert.equal(Math.round(summary.meanPx), 123);
  assert.equal(Math.round(summary.medianPx), 100);
  assert.equal(Math.round(summary.p90Px), 196);
  assert.equal(Math.round(summary.maxPx), 220);
  assert.equal(Math.round(summary.meanDispersionPx), 34);
  assert.equal(Math.round(summary.p90DispersionPx), 54);
  assert.equal(summary.maxDispersionPx, 60);
  assert.equal(summary.quality, 'usable');
});

test('estimates larger uncertainty near locally bad validation targets', () => {
  const model = buildLocalAccuracyErrorModel([
    { target: { x: 100, y: 100 }, gaze: { x: 112, y: 100 }, dispersionPx: 16 },
    { target: { x: 500, y: 100 }, gaze: { x: 518, y: 100 }, dispersionPx: 18 },
    { target: { x: 900, y: 100 }, gaze: { x: 1060, y: 100 }, dispersionPx: 24 },
    { target: { x: 100, y: 500 }, gaze: { x: 114, y: 500 }, dispersionPx: 18 },
    { target: { x: 900, y: 500 }, gaze: { x: 1065, y: 500 }, dispersionPx: 28 },
  ]);

  const stableRegion = estimateLocalAccuracyErrorPx({ x: 120, y: 115 }, model, 40);
  const badRegion = estimateLocalAccuracyErrorPx({ x: 890, y: 115 }, model, 40);
  const uncoveredRegion = estimateLocalAccuracyErrorPx({ x: 500, y: 500 }, model, 40);

  assert.ok(stableRegion < 60);
  assert.ok(badRegion > 140);
  assert.equal(uncoveredRegion, 40);
});

test('rejects validation summaries with severe local misses even when mean error is usable', () => {
  const mostlyGoodWithOneBadRegion = summarizeAccuracy([
    { target: { x: 100, y: 100 }, gaze: { x: 120, y: 100 } },
    { target: { x: 200, y: 100 }, gaze: { x: 220, y: 100 } },
    { target: { x: 300, y: 100 }, gaze: { x: 320, y: 100 } },
    { target: { x: 400, y: 100 }, gaze: { x: 420, y: 100 } },
    { target: { x: 500, y: 100 }, gaze: { x: 520, y: 100 } },
    { target: { x: 600, y: 100 }, gaze: { x: 620, y: 100 } },
    { target: { x: 700, y: 100 }, gaze: { x: 720, y: 100 } },
    { target: { x: 800, y: 100 }, gaze: { x: 1280, y: 100 } },
  ]);
  const consistentlyUsable = summarizeAccuracy([
    { target: { x: 100, y: 100 }, gaze: { x: 170, y: 100 } },
    { target: { x: 200, y: 100 }, gaze: { x: 270, y: 100 } },
    { target: { x: 300, y: 100 }, gaze: { x: 370, y: 100 } },
    { target: { x: 400, y: 100 }, gaze: { x: 470, y: 100 } },
    { target: { x: 500, y: 100 }, gaze: { x: 570, y: 100 } },
  ]);

  assert.equal(['good', 'usable'].includes(mostlyGoodWithOneBadRegion.quality), true);
  assert.equal(isAccuracyValidationUsable(mostlyGoodWithOneBadRegion), false);
  assert.equal(isAccuracyValidationUsable(consistentlyUsable), true);
});

test('rejects validation summaries with unstable target captures even when error is low', () => {
  const lowErrorButShaky = summarizeAccuracy([
    { target: { x: 100, y: 100 }, gaze: { x: 115, y: 100 }, dispersionPx: 92 },
    { target: { x: 200, y: 100 }, gaze: { x: 215, y: 100 }, dispersionPx: 88 },
    { target: { x: 300, y: 100 }, gaze: { x: 315, y: 100 }, dispersionPx: 90 },
    { target: { x: 400, y: 100 }, gaze: { x: 415, y: 100 }, dispersionPx: 94 },
    { target: { x: 500, y: 100 }, gaze: { x: 515, y: 100 }, dispersionPx: 86 },
  ]);
  const lowErrorAndStable = summarizeAccuracy([
    { target: { x: 100, y: 100 }, gaze: { x: 115, y: 100 }, dispersionPx: 24 },
    { target: { x: 200, y: 100 }, gaze: { x: 215, y: 100 }, dispersionPx: 28 },
    { target: { x: 300, y: 100 }, gaze: { x: 315, y: 100 }, dispersionPx: 22 },
    { target: { x: 400, y: 100 }, gaze: { x: 415, y: 100 }, dispersionPx: 26 },
    { target: { x: 500, y: 100 }, gaze: { x: 515, y: 100 }, dispersionPx: 20 },
  ]);

  assert.equal(lowErrorButShaky.quality, 'good');
  assert.equal(isAccuracyValidationUsable(lowErrorButShaky), false);
  assert.equal(isAccuracyValidationUsable(lowErrorAndStable), true);
});

test('requires accepted accuracy samples to cover enough of the player', () => {
  const clusteredSamples = [
    { target: { x: 0.42, y: 0.44 }, gaze: { x: 0.43, y: 0.44 } },
    { target: { x: 0.48, y: 0.45 }, gaze: { x: 0.49, y: 0.45 } },
    { target: { x: 0.52, y: 0.53 }, gaze: { x: 0.53, y: 0.53 } },
    { target: { x: 0.56, y: 0.55 }, gaze: { x: 0.57, y: 0.55 } },
  ];
  const coveredSamples = [
    { target: { x: 0.18, y: 0.20 }, gaze: { x: 0.20, y: 0.20 } },
    { target: { x: 0.82, y: 0.20 }, gaze: { x: 0.84, y: 0.20 } },
    { target: { x: 0.18, y: 0.80 }, gaze: { x: 0.20, y: 0.80 } },
    { target: { x: 0.82, y: 0.80 }, gaze: { x: 0.84, y: 0.80 } },
  ];

  assert.equal(hasSufficientSpatialCoverage(clusteredSamples), false);
  assert.equal(hasSufficientSpatialCoverage(coveredSamples), true);
});

test('expires webcam validation after the configured age limit', () => {
  assert.equal(isValidationFresh({
    validatedAt: 1000,
    now: 1499,
    maxAgeMs: 500,
  }), true);
  assert.equal(isValidationFresh({
    validatedAt: 1000,
    now: 1501,
    maxAgeMs: 500,
  }), false);
  assert.equal(isValidationFresh({
    validatedAt: null,
    now: 1501,
    maxAgeMs: 500,
  }), false);
});
