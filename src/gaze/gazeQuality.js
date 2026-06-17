export function distanceBetweenPoints(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

const IDENTITY_AFFINE_CALIBRATION = {
  isIdentity: true,
  sampleCount: 0,
  x: [1, 0, 0],
  y: [0, 1, 0],
};
const MIN_RESIDUAL_RADIUS = 1e-6;

function meanPoint(points) {
  const sum = points.reduce(
    (accumulator, point) => ({
      x: accumulator.x + point.x,
      y: accumulator.y + point.y,
    }),
    { x: 0, y: 0 },
  );

  return {
    x: sum.x / points.length,
    y: sum.y / points.length,
  };
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function percentile(sortedValues, ratio) {
  if (!sortedValues.length) {
    return null;
  }

  const clampedRatio = Math.min(1, Math.max(0, ratio));
  const index = (sortedValues.length - 1) * clampedRatio;
  const lowerIndex = Math.floor(index);
  const upperIndex = Math.ceil(index);

  if (lowerIndex === upperIndex) {
    return sortedValues[lowerIndex];
  }

  const fraction = index - lowerIndex;
  return sortedValues[lowerIndex] + (sortedValues[upperIndex] - sortedValues[lowerIndex]) * fraction;
}

export function getRobustPointAverage(points, keepRatio = 0.75) {
  const finitePoints = points.filter((point) => (
    Number.isFinite(point?.x) && Number.isFinite(point?.y)
  ));

  if (!finitePoints.length) {
    return null;
  }

  if (finitePoints.length <= 2) {
    return meanPoint(finitePoints);
  }

  const center = {
    x: median(finitePoints.map((point) => point.x)),
    y: median(finitePoints.map((point) => point.y)),
  };
  const keepCount = Math.max(3, Math.ceil(finitePoints.length * Math.min(1, Math.max(0.2, keepRatio))));
  const keptPoints = finitePoints
    .map((point) => ({
      point,
      distance: distanceBetweenPoints(point, center),
    }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, Math.min(keepCount, finitePoints.length))
    .map((entry) => entry.point);

  return meanPoint(keptPoints);
}

export function summarizeTargetSamples(
  points,
  {
    minSamples = 4,
    maxDispersionPx = 90,
    keepRatio = 0.75,
  } = {},
) {
  const finitePoints = points.filter((point) => (
    Number.isFinite(point?.x) && Number.isFinite(point?.y)
  ));

  if (finitePoints.length < minSamples) {
    return {
      accepted: false,
      reason: 'too-few-samples',
      count: finitePoints.length,
      gaze: null,
      dispersionPx: null,
    };
  }

  const gaze = getRobustPointAverage(finitePoints, keepRatio);
  const dispersionPx = finitePoints.reduce(
    (sum, point) => sum + distanceBetweenPoints(point, gaze),
    0,
  ) / finitePoints.length;

  if (dispersionPx > maxDispersionPx) {
    return {
      accepted: false,
      reason: 'unstable',
      count: finitePoints.length,
      gaze,
      dispersionPx,
    };
  }

  return {
    accepted: true,
    reason: null,
    count: finitePoints.length,
    gaze,
    dispersionPx,
  };
}

export function shouldContinueTargetSampleCapture({
  sampleSlots,
  acceptedSamples,
  nominalSampleSlots,
  minAcceptedSamples,
  elapsedMs,
  maxDurationMs,
}) {
  if (sampleSlots < nominalSampleSlots) {
    return true;
  }

  return acceptedSamples < minAcceptedSamples && elapsedMs < maxDurationMs;
}

export function smoothGazePoint(previous, next, alpha = 0.25) {
  if (!previous?.visible) {
    return next;
  }

  const weight = Math.min(1, Math.max(0, alpha));

  return {
    ...next,
    x: previous.x + (next.x - previous.x) * weight,
    y: previous.y + (next.y - previous.y) * weight,
  };
}

export function getAdaptiveSmoothingAlpha(
  previous,
  next,
  {
    minAlpha = 0.16,
    maxAlpha = 0.56,
    fastDistancePx = 240,
  } = {},
) {
  if (!previous?.visible || fastDistancePx <= 0) {
    return Math.min(1, Math.max(0, maxAlpha));
  }

  const min = Math.min(1, Math.max(0, minAlpha));
  const max = Math.min(1, Math.max(min, maxAlpha));
  const movementRatio = Math.min(1, distanceBetweenPoints(previous, next) / fastDistancePx);

  return min + (max - min) * movementRatio;
}

export function isPlausibleGazeJump(previous, next, maxDistancePx = 320) {
  if (!previous) {
    return true;
  }

  return distanceBetweenPoints(previous, next) <= maxDistancePx;
}

function solveThreeByThree(matrix, vector) {
  const augmented = matrix.map((row, index) => [...row, vector[index]]);

  for (let pivotIndex = 0; pivotIndex < 3; pivotIndex += 1) {
    let bestRow = pivotIndex;

    for (let row = pivotIndex + 1; row < 3; row += 1) {
      if (Math.abs(augmented[row][pivotIndex]) > Math.abs(augmented[bestRow][pivotIndex])) {
        bestRow = row;
      }
    }

    if (Math.abs(augmented[bestRow][pivotIndex]) < 1e-9) {
      return null;
    }

    if (bestRow !== pivotIndex) {
      [augmented[pivotIndex], augmented[bestRow]] = [augmented[bestRow], augmented[pivotIndex]];
    }

    const pivot = augmented[pivotIndex][pivotIndex];
    for (let column = pivotIndex; column < 4; column += 1) {
      augmented[pivotIndex][column] /= pivot;
    }

    for (let row = 0; row < 3; row += 1) {
      if (row === pivotIndex) {
        continue;
      }

      const factor = augmented[row][pivotIndex];
      for (let column = pivotIndex; column < 4; column += 1) {
        augmented[row][column] -= factor * augmented[pivotIndex][column];
      }
    }
  }

  return augmented.map((row) => row[3]);
}

function fitAffineAxis(samples, targetKey) {
  const normalMatrix = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  const targetVector = [0, 0, 0];

  samples.forEach((sample) => {
    const row = [sample.gaze.x, sample.gaze.y, 1];
    const target = sample.target[targetKey];

    for (let i = 0; i < 3; i += 1) {
      targetVector[i] += row[i] * target;
      for (let j = 0; j < 3; j += 1) {
        normalMatrix[i][j] += row[i] * row[j];
      }
    }
  });

  return solveThreeByThree(normalMatrix, targetVector);
}

export function computeAffineCalibration(samples) {
  const finiteSamples = samples.filter((sample) => (
    Number.isFinite(sample?.gaze?.x) &&
    Number.isFinite(sample?.gaze?.y) &&
    Number.isFinite(sample?.target?.x) &&
    Number.isFinite(sample?.target?.y)
  ));

  if (finiteSamples.length < 3) {
    return { ...IDENTITY_AFFINE_CALIBRATION };
  }

  const x = fitAffineAxis(finiteSamples, 'x');
  const y = fitAffineAxis(finiteSamples, 'y');

  if (!x || !y) {
    return { ...IDENTITY_AFFINE_CALIBRATION, sampleCount: finiteSamples.length };
  }

  return {
    isIdentity: false,
    sampleCount: finiteSamples.length,
    x,
    y,
  };
}

function applyAffineOnly(point, calibration = IDENTITY_AFFINE_CALIBRATION) {
  if (!calibration || calibration.isIdentity) {
    return { ...point };
  }

  const x = calibration.x[0] * point.x + calibration.x[1] * point.y + calibration.x[2];
  const y = calibration.y[0] * point.x + calibration.y[1] * point.y + calibration.y[2];

  return {
    ...point,
    x,
    y,
  };
}

function estimateResidualRadius(samples) {
  const points = samples
    .flatMap((sample) => [sample.gaze, sample.target])
    .filter((point) => Number.isFinite(point?.x) && Number.isFinite(point?.y));

  if (points.length < 2) {
    return MIN_RESIDUAL_RADIUS;
  }

  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const diagonal = Math.hypot(
    Math.max(...xs) - Math.min(...xs),
    Math.max(...ys) - Math.min(...ys),
  );

  return Math.max(MIN_RESIDUAL_RADIUS, diagonal * 0.35);
}

function buildResidualAnchors(samples, affineCalibration) {
  return samples
    .map((sample) => {
      const corrected = applyAffineOnly(sample.gaze, affineCalibration);
      const dx = sample.target.x - corrected.x;
      const dy = sample.target.y - corrected.y;

      return {
        x: corrected.x,
        y: corrected.y,
        dx,
        dy,
      };
    })
    .filter((anchor) => (
      Number.isFinite(anchor.x) &&
      Number.isFinite(anchor.y) &&
      Number.isFinite(anchor.dx) &&
      Number.isFinite(anchor.dy)
    ));
}

function addLocalResidualCorrection(
  calibration,
  samples,
  {
    residualRadius = null,
  } = {},
) {
  if (!calibration || calibration.isIdentity) {
    return calibration ? { ...calibration } : { ...IDENTITY_AFFINE_CALIBRATION };
  }

  const anchors = buildResidualAnchors(samples, calibration);

  if (!anchors.length) {
    return { ...calibration };
  }

  return {
    ...calibration,
    residuals: {
      radius: Number.isFinite(residualRadius) && residualRadius > 0
        ? residualRadius
        : estimateResidualRadius(samples),
      anchors,
    },
  };
}

function getResidualRadiusCandidates(samples) {
  const baseRadius = estimateResidualRadius(samples);
  const candidates = [
    baseRadius * 0.45,
    baseRadius * 0.55,
    baseRadius * 0.65,
    baseRadius * 0.8,
    baseRadius,
    baseRadius * 1.25,
    baseRadius * 1.6,
  ];

  return [...new Set(candidates
    .filter((candidate) => Number.isFinite(candidate) && candidate > 0)
    .map((candidate) => Number(candidate.toPrecision(12))))];
}

function estimateResidualSpacingRadius(samples) {
  const targets = samples
    .map((sample) => sample.target)
    .filter((target) => Number.isFinite(target?.x) && Number.isFinite(target?.y));

  if (targets.length < 2) {
    return MIN_RESIDUAL_RADIUS;
  }

  const nearestDistances = targets
    .map((target, targetIndex) => {
      const distances = targets
        .filter((_, index) => index !== targetIndex)
        .map((other) => distanceBetweenPoints(target, other))
        .filter(Number.isFinite)
        .sort((a, b) => a - b);

      return distances[0] ?? null;
    })
    .filter(Number.isFinite)
    .sort((a, b) => a - b);

  if (!nearestDistances.length) {
    return MIN_RESIDUAL_RADIUS;
  }

  return Math.max(MIN_RESIDUAL_RADIUS, percentile(nearestDistances, 0.75) * 0.9);
}

function scoreResidualRadius(samples, residualRadius) {
  const errors = [];

  samples.forEach((heldOutSample, heldOutIndex) => {
    const trainingSamples = samples.filter((_, index) => index !== heldOutIndex);
    const affineCalibration = computeAffineCalibration(trainingSamples);

    if (affineCalibration.isIdentity) {
      return;
    }

    const calibration = addLocalResidualCorrection(
      affineCalibration,
      trainingSamples,
      { residualRadius },
    );
    const corrected = applyAffineCalibration(heldOutSample.gaze, calibration);
    const error = distanceBetweenPoints(heldOutSample.target, corrected);

    if (Number.isFinite(error)) {
      errors.push(error);
    }
  });

  if (!errors.length) {
    return {
      residualRadius,
      mean: Infinity,
      median: Infinity,
      p90: Infinity,
    };
  }

  const sortedErrors = [...errors].sort((a, b) => a - b);

  return {
    residualRadius,
    mean: errors.reduce((sum, error) => sum + error, 0) / errors.length,
    median: median(sortedErrors),
    p90: percentile(sortedErrors, 0.9),
  };
}

function selectResidualRadius(samples, explicitRadius = null) {
  if (Number.isFinite(explicitRadius) && explicitRadius > 0) {
    return explicitRadius;
  }

  if (samples.length < 5) {
    return estimateResidualRadius(samples);
  }

  const bestScore = getResidualRadiusCandidates(samples)
    .map((candidate) => scoreResidualRadius(samples, candidate))
    .sort((a, b) => (
      a.p90 - b.p90 ||
      a.mean - b.mean ||
      a.median - b.median
    ))[0];

  return bestScore
    ? Math.max(bestScore.residualRadius, estimateResidualSpacingRadius(samples))
    : estimateResidualRadius(samples);
}

function getWeightedResidual(point, residuals) {
  const anchors = Array.isArray(residuals?.anchors) ? residuals.anchors : [];
  const radius = Number.isFinite(residuals?.radius) && residuals.radius > 0
    ? residuals.radius
    : MIN_RESIDUAL_RADIUS;

  let totalWeight = 0;
  let dx = 0;
  let dy = 0;

  for (const anchor of anchors) {
    const distance = distanceBetweenPoints(point, anchor);

    if (distance <= MIN_RESIDUAL_RADIUS) {
      return {
        dx: anchor.dx,
        dy: anchor.dy,
      };
    }

    if (distance > radius) {
      continue;
    }

    const taper = 1 - distance / radius;
    const weight = (taper * taper) / distance;
    totalWeight += weight;
    dx += anchor.dx * weight;
    dy += anchor.dy * weight;
  }

  if (totalWeight <= 0) {
    return null;
  }

  return {
    dx: dx / totalWeight,
    dy: dy / totalWeight,
  };
}

export function applyAffineCalibration(point, calibration = IDENTITY_AFFINE_CALIBRATION) {
  const affinePoint = applyAffineOnly(point, calibration);
  const residual = getWeightedResidual(affinePoint, calibration?.residuals);

  if (!residual) {
    return affinePoint;
  }

  return {
    ...affinePoint,
    x: affinePoint.x + residual.dx,
    y: affinePoint.y + residual.dy,
  };
}

function assertViewport(viewport) {
  if (
    !Number.isFinite(viewport?.width) ||
    !Number.isFinite(viewport?.height) ||
    viewport.width <= 0 ||
    viewport.height <= 0
  ) {
    throw new Error('Viewport width and height must be positive.');
  }
}

export function normalizePointToViewport(point, viewport) {
  assertViewport(viewport);

  return {
    ...point,
    x: point.x / viewport.width,
    y: point.y / viewport.height,
  };
}

export function denormalizePointFromViewport(point, viewport) {
  assertViewport(viewport);

  return {
    ...point,
    x: point.x * viewport.width,
    y: point.y * viewport.height,
  };
}

export function normalizeAccuracySample(sample, viewport) {
  return {
    ...sample,
    gaze: normalizePointToViewport(sample.gaze, viewport),
    target: normalizePointToViewport(sample.target, viewport),
  };
}

export function hasSufficientSpatialCoverage(
  samples,
  {
    minXRange = 0.3,
    minYRange = 0.3,
  } = {},
) {
  const targets = samples
    .map((sample) => sample?.target)
    .filter((target) => Number.isFinite(target?.x) && Number.isFinite(target?.y));

  if (targets.length < 3) {
    return false;
  }

  const xs = targets.map((target) => target.x);
  const ys = targets.map((target) => target.y);

  return (
    Math.max(...xs) - Math.min(...xs) >= minXRange &&
    Math.max(...ys) - Math.min(...ys) >= minYRange
  );
}

export function applyViewportCalibration(point, calibration, viewport) {
  return denormalizePointFromViewport(
    applyAffineCalibration(normalizePointToViewport(point, viewport), calibration),
    viewport,
  );
}

function isFiniteAccuracySample(sample) {
  return (
    Number.isFinite(sample?.gaze?.x) &&
    Number.isFinite(sample?.gaze?.y) &&
    Number.isFinite(sample?.target?.x) &&
    Number.isFinite(sample?.target?.y)
  );
}

function applyCalibrationToSamples(samples, calibration) {
  return samples.map((sample) => ({
    ...sample,
    gaze: applyAffineCalibration(sample.gaze, calibration),
  }));
}

function scoreCalibration(samples, calibration) {
  const summary = summarizeAccuracy(applyCalibrationToSamples(samples, calibration));

  return {
    calibration,
    summary,
    mean: summary.meanPx ?? Infinity,
    median: summary.medianPx ?? Infinity,
  };
}

function findBestCalibrationCandidate(samples) {
  const candidates = [
    scoreCalibration(samples, computeAffineCalibration(samples)),
  ];

  if (samples.length > 3) {
    samples.forEach((_, droppedIndex) => {
      const subset = samples.filter((__, index) => index !== droppedIndex);
      candidates.push(scoreCalibration(samples, computeAffineCalibration(subset)));
    });
  }

  return candidates.sort((a, b) => (
    a.median - b.median ||
    a.mean - b.mean
  ))[0];
}

function selectCorrectionInliers(samples, calibration, maxCorrectedMeanPx) {
  const correctedSamples = applyCalibrationToSamples(samples, calibration);
  const errors = correctedSamples
    .map((sample, index) => ({
      sample: samples[index],
      distance: distanceBetweenPoints(sample.target, sample.gaze),
    }))
    .filter((entry) => Number.isFinite(entry.distance));

  if (errors.length < 4) {
    return samples;
  }

  const medianError = median(errors.map((entry) => entry.distance));
  const threshold = Math.max(maxCorrectedMeanPx, medianError * 3, 1e-9);
  const inliers = errors
    .filter((entry) => entry.distance <= threshold)
    .map((entry) => entry.sample);

  return inliers.length >= 3 ? inliers : samples;
}

export function buildAccuracyCorrection(
  samples,
  {
    maxCorrectedMeanPx = 180,
    minImprovementRatio = 0.15,
    localResidualRadius = null,
  } = {},
) {
  const finiteSamples = samples.filter(isFiniteAccuracySample);
  const bestCandidate = findBestCalibrationCandidate(finiteSamples);
  const inlierSamples = selectCorrectionInliers(
    finiteSamples,
    bestCandidate.calibration,
    maxCorrectedMeanPx,
  );
  const rawSummary = summarizeAccuracy(inlierSamples);
  const proposedAffineCalibration = computeAffineCalibration(inlierSamples);
  const residualRadius = selectResidualRadius(inlierSamples, localResidualRadius);
  const proposedCalibration = addLocalResidualCorrection(
    proposedAffineCalibration,
    inlierSamples,
    { residualRadius },
  );
  const correctedSamples = applyCalibrationToSamples(inlierSamples, proposedCalibration);
  const correctedSummary = summarizeAccuracy(correctedSamples);
  const hasUsableError = (
    rawSummary.meanPx !== null &&
    correctedSummary.meanPx !== null
  );
  const accepted = (
    hasUsableError &&
    !proposedCalibration.isIdentity &&
    correctedSummary.meanPx <= maxCorrectedMeanPx &&
    correctedSummary.meanPx <= rawSummary.meanPx * (1 - minImprovementRatio)
  );

  return {
    accepted,
    calibration: accepted
      ? proposedCalibration
      : { ...IDENTITY_AFFINE_CALIBRATION, sampleCount: proposedCalibration.sampleCount },
    proposedCalibration,
    rawSummary,
    correctedSummary,
    allRawSummary: summarizeAccuracy(finiteSamples),
    usedSampleCount: inlierSamples.length,
    rejectedSampleCount: finiteSamples.length - inlierSamples.length,
  };
}

export function isGazeInsideViewport(point, viewport, marginPx = 0) {
  if (
    !point ||
    !Number.isFinite(point.x) ||
    !Number.isFinite(point.y) ||
    !Number.isFinite(viewport?.width) ||
    !Number.isFinite(viewport?.height) ||
    viewport.width <= 0 ||
    viewport.height <= 0
  ) {
    return false;
  }

  const margin = Math.max(0, marginPx);

  return (
    point.x >= -margin &&
    point.y >= -margin &&
    point.x <= viewport.width + margin &&
    point.y <= viewport.height + margin
  );
}

export function shouldCaptureFreshGazeSample({
  gaze,
  capturedAt,
  now,
  maxAgeMs,
  viewport,
  boundsMarginPx = 0,
}) {
  return (
    Number.isFinite(capturedAt) &&
    Number.isFinite(now) &&
    now - capturedAt <= Math.max(0, maxAgeMs) &&
    isGazeInsideViewport(gaze, viewport, boundsMarginPx)
  );
}

export function shouldTrainFreshGazeSample({
  gaze,
  acceptedGaze,
  capturedAt,
  now,
  maxAgeMs,
  viewport,
  boundsMarginPx = 0,
  maxDistanceFromAcceptedPx = 120,
}) {
  return (
    shouldCaptureFreshGazeSample({
      gaze,
      capturedAt,
      now,
      maxAgeMs,
      viewport,
      boundsMarginPx,
    }) &&
    Number.isFinite(acceptedGaze?.x) &&
    Number.isFinite(acceptedGaze?.y) &&
    distanceBetweenPoints(gaze, acceptedGaze) <= maxDistanceFromAcceptedPx
  );
}

export function isValidationFresh({
  validatedAt,
  now,
  maxAgeMs,
}) {
  return (
    Number.isFinite(validatedAt) &&
    Number.isFinite(now) &&
    Number.isFinite(maxAgeMs) &&
    maxAgeMs > 0 &&
    now - validatedAt <= maxAgeMs
  );
}

function hiddenGaze(source = 'webcam') {
  return {
    x: 0,
    y: 0,
    visible: false,
    source,
  };
}

export function updateLiveGazeQuality(
  previous,
  event,
  {
    maxEvents = 24,
    minEvents = 12,
    maxBadRate = 0.5,
    maxConsecutiveBad = 8,
  } = {},
) {
  const bad = !event?.accepted;
  const events = [
    ...(previous?.events || []),
    {
      bad,
      reason: bad ? event?.reason || 'rejected' : null,
    },
  ].slice(-Math.max(1, maxEvents));
  const badCount = events.filter((entry) => entry.bad).length;
  const badRate = badCount / events.length;
  const consecutiveBad = bad
    ? (previous?.consecutiveBad || 0) + 1
    : 0;
  const hasEnoughEvents = events.length >= Math.max(1, minEvents);
  const tooManyConsecutiveBad = consecutiveBad >= Math.max(1, maxConsecutiveBad);
  const tooManyBadFrames = hasEnoughEvents && badRate > Math.max(0, maxBadRate);
  const unreliable = tooManyConsecutiveBad || tooManyBadFrames;

  return {
    events,
    badCount,
    badRate,
    consecutiveBad,
    unreliable,
    reason: unreliable
      ? tooManyConsecutiveBad ? 'consecutive-bad-gaze' : 'high-bad-gaze-rate'
      : null,
  };
}

export function resolveGazeUpdate({
  previous,
  next,
  viewport,
  alpha = 0.25,
  maxJumpPx = 320,
  boundsMarginPx = 0,
  adaptiveSmoothing = false,
  adaptiveSmoothingOptions = {},
}) {
  const source = next?.source || previous?.source || 'webcam';

  if (!isGazeInsideViewport(next, viewport, boundsMarginPx)) {
    return {
      accepted: false,
      reason: 'out-of-bounds',
      gaze: hiddenGaze(source),
    };
  }

  const usablePrevious = previous?.visible && isGazeInsideViewport(previous, viewport, boundsMarginPx)
    ? previous
    : null;

  if (!isPlausibleGazeJump(usablePrevious, next, maxJumpPx)) {
    return {
      accepted: false,
      reason: 'jump',
      gaze: usablePrevious || hiddenGaze(source),
    };
  }

  return {
    accepted: true,
    reason: null,
    gaze: smoothGazePoint(
      usablePrevious,
      next,
      adaptiveSmoothing
        ? getAdaptiveSmoothingAlpha(usablePrevious, next, {
          minAlpha: alpha,
          ...adaptiveSmoothingOptions,
        })
        : alpha,
    ),
  };
}

function qualityForMeanError(meanPx) {
  if (meanPx <= 90) {
    return 'good';
  }

  if (meanPx <= 180) {
    return 'usable';
  }

  return 'poor';
}

export function summarizeAccuracy(samples) {
  if (!samples.length) {
    return {
      count: 0,
      meanPx: null,
      medianPx: null,
      p90Px: null,
      maxPx: null,
      meanDispersionPx: null,
      p90DispersionPx: null,
      maxDispersionPx: null,
      quality: 'untested',
    };
  }

  const distances = samples
    .map((sample) => distanceBetweenPoints(sample.target, sample.gaze))
    .sort((a, b) => a - b);
  const dispersions = samples
    .map((sample) => sample.dispersionPx)
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);
  const meanPx = distances.reduce((sum, distance) => sum + distance, 0) / distances.length;
  const middle = Math.floor(distances.length / 2);
  const medianPx = distances.length % 2 === 0
    ? (distances[middle - 1] + distances[middle]) / 2
    : distances[middle];
  const meanDispersionPx = dispersions.length
    ? dispersions.reduce((sum, dispersion) => sum + dispersion, 0) / dispersions.length
    : null;

  return {
    count: samples.length,
    meanPx,
    medianPx,
    p90Px: percentile(distances, 0.9),
    maxPx: distances[distances.length - 1],
    meanDispersionPx,
    p90DispersionPx: percentile(dispersions, 0.9),
    maxDispersionPx: dispersions.length ? dispersions[dispersions.length - 1] : null,
    quality: qualityForMeanError(meanPx),
  };
}

export function isAccuracyValidationUsable(
  summary,
  {
    maxMeanPx = 180,
    maxP90Px = 260,
    maxSinglePointPx = 360,
    maxP90DispersionPx = 80,
    maxSingleTargetDispersionPx = 100,
    minSamples = 1,
  } = {},
) {
  const hasDispersion = (
    summary?.p90DispersionPx !== null &&
    summary?.maxDispersionPx !== null
  );

  return (
    Number.isFinite(summary?.meanPx) &&
    Number.isFinite(summary?.p90Px) &&
    Number.isFinite(summary?.maxPx) &&
    summary.count >= minSamples &&
    summary.meanPx <= maxMeanPx &&
    summary.p90Px <= maxP90Px &&
    summary.maxPx <= maxSinglePointPx &&
    (
      !hasDispersion ||
      (
        summary.p90DispersionPx <= maxP90DispersionPx &&
        summary.maxDispersionPx <= maxSingleTargetDispersionPx
      )
    )
  );
}

function estimateLocalErrorRadius(anchors) {
  if (anchors.length < 2) {
    return MIN_RESIDUAL_RADIUS;
  }

  const nearestDistances = anchors
    .map((anchor, anchorIndex) => {
      const distances = anchors
        .filter((_, index) => index !== anchorIndex)
        .map((other) => distanceBetweenPoints(anchor, other))
        .filter(Number.isFinite)
        .sort((a, b) => a - b);

      return distances[0] ?? null;
    })
    .filter(Number.isFinite)
    .sort((a, b) => a - b);

  if (!nearestDistances.length) {
    return MIN_RESIDUAL_RADIUS;
  }

  return Math.max(MIN_RESIDUAL_RADIUS, percentile(nearestDistances, 0.75) * 0.65);
}

export function buildLocalAccuracyErrorModel(
  samples,
  {
    radius = null,
    minErrorPx = 0,
  } = {},
) {
  const anchors = samples
    .filter(isFiniteAccuracySample)
    .map((sample) => ({
      x: sample.target.x,
      y: sample.target.y,
      errorPx: Math.max(
        distanceBetweenPoints(sample.target, sample.gaze),
        Number.isFinite(sample.dispersionPx) ? sample.dispersionPx : 0,
        minErrorPx,
      ),
    }))
    .filter((anchor) => (
      Number.isFinite(anchor.x) &&
      Number.isFinite(anchor.y) &&
      Number.isFinite(anchor.errorPx)
    ));

  return {
    radius: Number.isFinite(radius) && radius > 0 ? radius : estimateLocalErrorRadius(anchors),
    anchors,
  };
}

export function estimateLocalAccuracyErrorPx(point, model, fallbackPx = 0) {
  const anchors = Array.isArray(model?.anchors) ? model.anchors : [];
  const radius = Number.isFinite(model?.radius) && model.radius > 0
    ? model.radius
    : MIN_RESIDUAL_RADIUS;
  const fallback = Number.isFinite(fallbackPx) ? Math.max(0, fallbackPx) : 0;

  if (
    !anchors.length ||
    !Number.isFinite(point?.x) ||
    !Number.isFinite(point?.y)
  ) {
    return fallback;
  }

  let totalWeight = 0;
  let weightedError = 0;

  for (const anchor of anchors) {
    const distance = distanceBetweenPoints(point, anchor);

    if (distance <= MIN_RESIDUAL_RADIUS) {
      return Math.max(fallback, anchor.errorPx);
    }

    if (distance > radius) {
      continue;
    }

    const taper = 1 - distance / radius;
    const weight = (taper * taper) / distance;
    totalWeight += weight;
    weightedError += anchor.errorPx * weight;
  }

  if (totalWeight <= 0) {
    return fallback;
  }

  return Math.max(fallback, weightedError / totalWeight);
}
