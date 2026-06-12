const DEFAULT_MAX_DISPERSION_PX = 45;
const DEFAULT_MIN_DURATION_MS = 100;

function isFiniteScreenSample(sample) {
  return Number.isFinite(sample?.t)
    && Number.isFinite(sample?.screen?.x)
    && Number.isFinite(sample?.screen?.y);
}

function getDispersion(samples) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  samples.forEach((sample) => {
    minX = Math.min(minX, sample.screen.x);
    maxX = Math.max(maxX, sample.screen.x);
    minY = Math.min(minY, sample.screen.y);
    maxY = Math.max(maxY, sample.screen.y);
  });

  return (maxX - minX) + (maxY - minY);
}

function buildFixation(samples) {
  const startSec = samples[0].t;
  const endSec = samples[samples.length - 1].t;
  const centroid = samples.reduce((sum, sample) => ({
    x: sum.x + sample.screen.x,
    y: sum.y + sample.screen.y,
  }), { x: 0, y: 0 });

  return {
    startSec,
    endSec,
    durationMs: Math.round((endSec - startSec) * 1000),
    centroid: {
      x: centroid.x / samples.length,
      y: centroid.y / samples.length,
    },
    sampleCount: samples.length,
    dispersionPx: getDispersion(samples),
  };
}

export function detectFixationsByDispersion(
  samples,
  { maxDispersionPx = DEFAULT_MAX_DISPERSION_PX, minDurationMs = DEFAULT_MIN_DURATION_MS } = {},
) {
  const dispersionLimit = Number.isFinite(maxDispersionPx) && maxDispersionPx >= 0
    ? maxDispersionPx
    : DEFAULT_MAX_DISPERSION_PX;
  const durationLimit = Number.isFinite(minDurationMs) && minDurationMs >= 0
    ? minDurationMs
    : DEFAULT_MIN_DURATION_MS;
  const validSamples = Array.isArray(samples)
    ? samples.filter(isFiniteScreenSample).sort((a, b) => a.t - b.t)
    : [];
  const fixations = [];
  let startIndex = 0;

  while (startIndex < validSamples.length) {
    let endIndex = startIndex;

    while (
      endIndex + 1 < validSamples.length
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
