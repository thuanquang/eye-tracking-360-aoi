function finitePoint(point) {
  return Number.isFinite(point?.x) && Number.isFinite(point?.y);
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function percentile(values, ratio) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const index = (sorted.length - 1) * Math.min(1, Math.max(0, ratio));
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

function meanPoint(points) {
  const total = points.reduce((sum, point) => ({
    x: sum.x + point.x,
    y: sum.y + point.y,
  }), { x: 0, y: 0 });

  return {
    x: total.x / points.length,
    y: total.y / points.length,
  };
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function qualityForTarget({ medianJitterPx, p90JitterPx, biasPx, effectiveHz, missingRate }) {
  if (
    missingRate > 0.35 ||
    medianJitterPx > 70 ||
    p90JitterPx > 140 ||
    biasPx > 220
  ) {
    return 'unusable';
  }

  if (
    effectiveHz < 22 ||
    missingRate > 0.2 ||
    medianJitterPx > 35 ||
    p90JitterPx > 80 ||
    biasPx > 140
  ) {
    return 'coarse';
  }

  return 'good';
}

export function summarizeDiagnosticTarget({
  target,
  samples = [],
  durationMs = 0,
  expectedSampleCount = null,
} = {}) {
  const finiteSamples = samples.filter(finitePoint);
  const center = finiteSamples.length ? meanPoint(finiteSamples) : null;
  const jitter = center ? finiteSamples.map((sample) => distance(sample, center)) : [];
  const sampleCount = finiteSamples.length;
  const effectiveHz = durationMs > 0 ? (sampleCount / durationMs) * 1000 : 0;
  const expected = Number.isFinite(expectedSampleCount) && expectedSampleCount > 0
    ? expectedSampleCount
    : sampleCount;
  const missingRate = expected > 0 ? Math.max(0, 1 - sampleCount / expected) : 1;
  const medianJitterPx = median(jitter) ?? Infinity;
  const p90JitterPx = percentile(jitter, 0.9) ?? Infinity;
  const biasPx = center && finitePoint(target) ? distance(center, target) : Infinity;

  return {
    target,
    sampleCount,
    durationMs,
    effectiveHz,
    missingRate,
    center,
    medianJitterPx,
    p90JitterPx,
    biasPx,
    quality: qualityForTarget({
      medianJitterPx,
      p90JitterPx,
      biasPx,
      effectiveHz,
      missingRate,
    }),
  };
}

function worstQuality(qualities) {
  if (qualities.includes('unusable')) return 'unusable';
  if (qualities.includes('coarse')) return 'coarse';
  return 'good';
}

function getUnusableReason({ p90JitterPx, p90BiasPx, effectiveHz, missingRate }) {
  if (missingRate > 0.35) {
    return `Raw gaze missing rate ${Math.round(missingRate * 100)}% is too high for recording.`;
  }

  if (p90BiasPx > 220) {
    return `Raw gaze bias ${Math.round(p90BiasPx)}px is too high for recording.`;
  }

  return `Raw gaze jitter ${Math.round(p90JitterPx)}px is too high for recording.`;
}

function getCoarseReason({ p90JitterPx, p90BiasPx, effectiveHz, missingRate }) {
  if (effectiveHz < 22) {
    return `Raw gaze is coarse: sample rate ${Math.round(effectiveHz)} Hz.`;
  }

  if (missingRate > 0.2) {
    return `Raw gaze is coarse: missing rate ${Math.round(missingRate * 100)}%.`;
  }

  if (p90BiasPx > 140) {
    return `Raw gaze is coarse: p90 bias ${Math.round(p90BiasPx)}px.`;
  }

  return `Raw gaze is coarse: p90 jitter ${Math.round(p90JitterPx)}px.`;
}

export function summarizeRawGazeDiagnostic({ targets = [] } = {}) {
  const medianJitterPx = median(targets.map((target) => target.medianJitterPx)) ?? Infinity;
  const p90JitterPx = percentile(targets.map((target) => target.p90JitterPx), 0.9) ?? Infinity;
  const p90BiasPx = percentile(targets.map((target) => target.biasPx), 0.9) ?? Infinity;
  const effectiveHz = median(targets.map((target) => target.effectiveHz)) ?? 0;
  const missingRate = median(targets.map((target) => target.missingRate)) ?? 1;
  const quality = worstQuality(targets.map((target) => target.quality));
  const shouldBlockRecording = quality === 'unusable';
  const reason = shouldBlockRecording
    ? getUnusableReason({ p90JitterPx, p90BiasPx, effectiveHz, missingRate })
    : quality === 'coarse'
      ? getCoarseReason({ p90JitterPx, p90BiasPx, effectiveHz, missingRate })
      : 'Raw gaze diagnostic passed.';

  return {
    targetCount: targets.length,
    quality,
    shouldBlockRecording,
    reason,
    medianJitterPx,
    p90JitterPx,
    p90BiasPx,
    effectiveHz,
    missingRate,
    targets,
  };
}
