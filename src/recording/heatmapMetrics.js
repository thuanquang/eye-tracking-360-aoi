import { DEFAULT_RECORDING_SAMPLE_INTERVAL_MS } from './sampleScheduler.js';

const DEFAULT_SCREEN_COLUMNS = 48;
const DEFAULT_SCREEN_ROWS = 27;
const DEFAULT_PANORAMA_COLUMNS = 72;
const DEFAULT_PANORAMA_ROWS = 36;
const PANORAMA_YAW_RANGE = [-180, 180];
const PANORAMA_PITCH_RANGE = [-90, 90];

function roundNumber(value, digits = 3) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  const rounded = Number(value.toFixed(digits));
  return Object.is(rounded, -0) ? 0 : rounded;
}

function positiveNumber(value, fallback) {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function gridSize(value, fallback) {
  return Number.isFinite(value) && value > 0
    ? Math.max(1, Math.floor(value))
    : fallback;
}

function fallbackSampleDurationSec(sampleIntervalMs) {
  return positiveNumber(sampleIntervalMs, DEFAULT_RECORDING_SAMPLE_INTERVAL_MS) / 1000;
}

function orderedTimedSamples(samples) {
  return (Array.isArray(samples) ? samples : [])
    .map((sample, index) => ({ sample, index, t: sample?.t }))
    .filter((entry) => Number.isFinite(entry.t))
    .sort((a, b) => a.t - b.t || a.index - b.index);
}

function getSampleDurations(timedSamples, sampleIntervalMs) {
  const fallbackSec = fallbackSampleDurationSec(sampleIntervalMs);

  return timedSamples.map((entry, index) => {
    const next = timedSamples[index + 1];
    const durationSec = next ? next.t - entry.t : fallbackSec;

    return Number.isFinite(durationSec) && durationSec > 0
      ? durationSec
      : fallbackSec;
  });
}

function shouldIncludeSample(sample, trustedOnly, sampleFilter = null) {
  const trusted = !trustedOnly || Boolean(sample?.quality?.trustedForAoiAnalysis);
  const matchesFilter = typeof sampleFilter === 'function' ? sampleFilter(sample) : true;

  return trusted && matchesFilter;
}

function hasFiniteScreenPosition(sample) {
  return Number.isFinite(sample?.screen?.x) && Number.isFinite(sample?.screen?.y);
}

function finitePositiveNumber(value) {
  return Number.isFinite(value) && value > 0 ? value : null;
}

function inferScreenDimension(screenEntries, getCoordinate) {
  const max = screenEntries.reduce((largest, { sample }) => {
    const coordinate = getCoordinate(sample);
    return Number.isFinite(coordinate) ? Math.max(largest, coordinate) : largest;
  }, -Infinity);

  return Number.isFinite(max) ? Math.max(1, Math.ceil(max + 1)) : null;
}

function getScreenContributorEntries(timedSamples, durations, trustedOnly, sampleFilter) {
  return timedSamples
    .map((entry, index) => ({ ...entry, durationSec: durations[index] }))
    .filter(({ sample }) => (
      hasFiniteScreenPosition(sample) &&
      shouldIncludeSample(sample, trustedOnly, sampleFilter)
    ));
}

function resolveScreenDimensions(requestedWidth, requestedHeight, screenEntries) {
  const providedWidth = finitePositiveNumber(requestedWidth);
  const providedHeight = finitePositiveNumber(requestedHeight);
  const width = providedWidth ?? inferScreenDimension(screenEntries, (sample) => sample.screen.x);
  const height = providedHeight ?? inferScreenDimension(screenEntries, (sample) => sample.screen.y);

  if (!width || !height) {
    return { width, height, dimensionSource: 'none' };
  }

  return {
    width,
    height,
    dimensionSource: providedWidth && providedHeight ? 'provided' : 'inferred',
  };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function coordinateToBin(coordinate, dimension, binCount) {
  const normalized = clamp(coordinate / dimension, 0, 1);
  return clamp(Math.floor(normalized * binCount), 0, binCount - 1);
}

function yawToColumn(yaw, columns) {
  const wrappedYaw = ((((yaw + 180) % 360) + 360) % 360);
  return clamp(Math.floor((wrappedYaw / 360) * columns), 0, columns - 1);
}

function pitchToRow(pitch, rows) {
  const clampedPitch = clamp(pitch, -90, 90);
  const normalized = (90 - clampedPitch) / 180;
  return clamp(Math.floor(normalized * rows), 0, rows - 1);
}

function addBin(bins, column, row, durationSec) {
  const key = `${row}:${column}`;
  const bin = bins.get(key) || {
    column,
    row,
    weightSec: 0,
    sampleCount: 0,
  };

  bin.weightSec += durationSec;
  bin.sampleCount += 1;
  bins.set(key, bin);
}

function serializeBins(bins) {
  return [...bins.values()]
    .sort((a, b) => a.row - b.row || a.column - b.column)
    .map((bin) => ({
      column: bin.column,
      row: bin.row,
      weightSec: roundNumber(bin.weightSec),
      sampleCount: bin.sampleCount,
    }));
}

export function buildScreenHeatmap(samples = [], options = {}) {
  const {
    width: requestedWidth,
    height: requestedHeight,
    columns: requestedColumns = DEFAULT_SCREEN_COLUMNS,
    rows: requestedRows = DEFAULT_SCREEN_ROWS,
    sampleIntervalMs = DEFAULT_RECORDING_SAMPLE_INTERVAL_MS,
    trustedOnly = false,
    sampleFilter = null,
  } = options;
  const columns = gridSize(requestedColumns, DEFAULT_SCREEN_COLUMNS);
  const rows = gridSize(requestedRows, DEFAULT_SCREEN_ROWS);
  const timedSamples = orderedTimedSamples(samples);
  const durations = getSampleDurations(timedSamples, sampleIntervalMs);
  const screenEntries = getScreenContributorEntries(timedSamples, durations, trustedOnly, sampleFilter);
  const { width, height, dimensionSource } = resolveScreenDimensions(
    requestedWidth,
    requestedHeight,
    screenEntries,
  );
  const bins = new Map();
  let totalWeightSec = 0;

  if (dimensionSource !== 'none') {
    screenEntries.forEach(({ sample, durationSec }) => {
      const { x, y } = sample.screen;
      const column = coordinateToBin(x, width, columns);
      const row = coordinateToBin(y, height, rows);

      addBin(bins, column, row, durationSec);
      totalWeightSec += durationSec;
    });
  }

  return {
    type: 'screen',
    columns,
    rows,
    width,
    height,
    dimensionSource,
    trustedOnly: Boolean(trustedOnly),
    totalWeightSec: roundNumber(totalWeightSec),
    bins: serializeBins(bins),
  };
}

export function buildPanoramaHeatmap(samples = [], options = {}) {
  const {
    columns: requestedColumns = DEFAULT_PANORAMA_COLUMNS,
    rows: requestedRows = DEFAULT_PANORAMA_ROWS,
    sampleIntervalMs = DEFAULT_RECORDING_SAMPLE_INTERVAL_MS,
    trustedOnly = false,
    sampleFilter = null,
  } = options;
  const columns = gridSize(requestedColumns, DEFAULT_PANORAMA_COLUMNS);
  const rows = gridSize(requestedRows, DEFAULT_PANORAMA_ROWS);
  const timedSamples = orderedTimedSamples(samples);
  const durations = getSampleDurations(timedSamples, sampleIntervalMs);
  const bins = new Map();
  let totalWeightSec = 0;

  timedSamples.forEach(({ sample }, index) => {
    const yaw = sample?.panorama?.yaw;
    const pitch = sample?.panorama?.pitch;

    if (
      !Number.isFinite(yaw) ||
      !Number.isFinite(pitch) ||
      !shouldIncludeSample(sample, trustedOnly, sampleFilter)
    ) {
      return;
    }

    const durationSec = durations[index];
    const column = yawToColumn(yaw, columns);
    const row = pitchToRow(pitch, rows);

    addBin(bins, column, row, durationSec);
    totalWeightSec += durationSec;
  });

  return {
    type: 'panorama',
    columns,
    rows,
    yawRange: [...PANORAMA_YAW_RANGE],
    pitchRange: [...PANORAMA_PITCH_RANGE],
    trustedOnly: Boolean(trustedOnly),
    totalWeightSec: roundNumber(totalWeightSec),
    bins: serializeBins(bins),
  };
}
