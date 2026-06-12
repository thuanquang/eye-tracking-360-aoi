import { DEFAULT_RECORDING_SAMPLE_INTERVAL_MS } from './sampleScheduler.js';

const DEFAULT_MAX_DISPERSION_PX = 45;
const DEFAULT_MIN_DURATION_MS = 100;
const DEFAULT_MAX_GAP_MS = DEFAULT_RECORDING_SAMPLE_INTERVAL_MS * 3;

function isFiniteScreenSample(sample) {
  return Number.isFinite(sample?.t)
    && Number.isFinite(sample?.screen?.x)
    && Number.isFinite(sample?.screen?.y);
}

function finitePositiveNumber(value) {
  return Number.isFinite(value) && value > 0 ? value : null;
}

function getDispersion(sampleItems) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  sampleItems.forEach(({ sample }) => {
    minX = Math.min(minX, sample.screen.x);
    maxX = Math.max(maxX, sample.screen.x);
    minY = Math.min(minY, sample.screen.y);
    maxY = Math.max(maxY, sample.screen.y);
  });

  return (maxX - minX) + (maxY - minY);
}

function getDurationMs(sampleItems) {
  const durationSec = sampleItems.reduce((sum, item) => {
    if (!Number.isFinite(sum) || !Number.isFinite(item.durationSec)) {
      return null;
    }

    return sum + item.durationSec;
  }, 0);

  if (Number.isFinite(durationSec)) {
    return Math.round(durationSec * 1000);
  }

  const startSec = sampleItems[0].sample.t;
  const endSec = sampleItems[sampleItems.length - 1].sample.t;
  return Math.round((endSec - startSec) * 1000);
}

function buildFixation(sampleItems) {
  const startSec = sampleItems[0].sample.t;
  const endSec = sampleItems[sampleItems.length - 1].sample.t;
  const centroid = sampleItems.reduce((sum, { sample }) => ({
    x: sum.x + sample.screen.x,
    y: sum.y + sample.screen.y,
  }), { x: 0, y: 0 });

  return {
    startSec,
    endSec,
    durationMs: getDurationMs(sampleItems),
    centroid: {
      x: centroid.x / sampleItems.length,
      y: centroid.y / sampleItems.length,
    },
    sampleCount: sampleItems.length,
    dispersionPx: getDispersion(sampleItems),
  };
}

export function detectFixationsByDispersion(
  samples,
  {
    maxDispersionPx = DEFAULT_MAX_DISPERSION_PX,
    minDurationMs = DEFAULT_MIN_DURATION_MS,
    maxGapMs = DEFAULT_MAX_GAP_MS,
    sampleDurationsSec = [],
  } = {},
) {
  const dispersionLimit = Number.isFinite(maxDispersionPx) && maxDispersionPx >= 0
    ? maxDispersionPx
    : DEFAULT_MAX_DISPERSION_PX;
  const durationLimit = Number.isFinite(minDurationMs) && minDurationMs >= 0
    ? minDurationMs
    : DEFAULT_MIN_DURATION_MS;
  const gapLimitSec = Number.isFinite(maxGapMs) && maxGapMs >= 0
    ? maxGapMs / 1000
    : DEFAULT_MAX_GAP_MS / 1000;
  const validSamples = Array.isArray(samples)
    ? samples
      .map((sample, index) => ({
        sample,
        durationSec: finitePositiveNumber(sampleDurationsSec[index]),
      }))
      .filter(({ sample }) => isFiniteScreenSample(sample))
      .sort((a, b) => a.sample.t - b.sample.t)
    : [];
  const fixations = [];
  let startIndex = 0;

  while (startIndex < validSamples.length) {
    let endIndex = startIndex;

    while (
      endIndex + 1 < validSamples.length
      && validSamples[endIndex + 1].sample.t - validSamples[endIndex].sample.t <= gapLimitSec
      && getDispersion(validSamples.slice(startIndex, endIndex + 2)) <= dispersionLimit
    ) {
      endIndex += 1;
    }

    const window = validSamples.slice(startIndex, endIndex + 1);
    const fixation = buildFixation(window);

    if (fixation.durationMs >= durationLimit) {
      fixations.push(fixation);
      startIndex = endIndex + 1;
    } else {
      startIndex += 1;
    }
  }

  return fixations;
}
