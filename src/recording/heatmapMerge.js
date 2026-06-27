function roundNumber(value, digits = 3) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  const rounded = Number(value.toFixed(digits));
  return Object.is(rounded, -0) ? 0 : rounded;
}

function rangeKey(range) {
  return Array.isArray(range) ? range.join(',') : '';
}

function hasOwn(value, property) {
  return Object.prototype.hasOwnProperty.call(value, property);
}

function isObject(value) {
  return value !== null && typeof value === 'object';
}

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function isScreenDimension(value) {
  return value === null || (Number.isFinite(value) && value > 0);
}

function isFiniteRange(range) {
  return (
    Array.isArray(range) &&
    range.length === 2 &&
    range.every((value) => Number.isFinite(value))
  );
}

function assertValidHeatmap(heatmap, index) {
  if (
    !isObject(heatmap) ||
    !isPositiveInteger(heatmap.columns) ||
    !isPositiveInteger(heatmap.rows)
  ) {
    throw new Error(`Invalid heatmap at index ${index}`);
  }

  if (heatmap.type === 'screen') {
    if (
      !hasOwn(heatmap, 'width') ||
      !hasOwn(heatmap, 'height') ||
      !isScreenDimension(heatmap.width) ||
      !isScreenDimension(heatmap.height)
    ) {
      throw new Error(`Invalid heatmap at index ${index}`);
    }

    return;
  }

  if (heatmap.type === 'panorama') {
    if (!isFiniteRange(heatmap.yawRange) || !isFiniteRange(heatmap.pitchRange)) {
      throw new Error(`Invalid heatmap at index ${index}`);
    }

    return;
  }

  throw new Error(`Invalid heatmap at index ${index}`);
}

export function getHeatmapCompatibilityKey(heatmap) {
  const type = heatmap?.type;
  const gridKey = `${heatmap?.columns}x${heatmap?.rows}`;

  if (type === 'screen') {
    return `${type}|${gridKey}|${heatmap?.width}x${heatmap?.height}`;
  }

  if (type === 'panorama') {
    return `${type}|${gridKey}|${rangeKey(heatmap?.yawRange)}|${rangeKey(heatmap?.pitchRange)}`;
  }

  return `${type}|${gridKey}`;
}

function hasValidGridCoordinate(column, row, heatmap) {
  return (
    Number.isInteger(column) &&
    Number.isInteger(row) &&
    column >= 0 &&
    row >= 0 &&
    column < heatmap.columns &&
    row < heatmap.rows
  );
}

function addMergedBin(bins, bin, heatmap) {
  const { column, row } = bin || {};

  if (!hasValidGridCoordinate(column, row, heatmap)) {
    return;
  }

  const key = `${row}:${column}`;
  const existing = bins.get(key) || {
    column,
    row,
    weightSec: 0,
    sampleCount: 0,
  };

  existing.weightSec += Number.isFinite(bin.weightSec) ? bin.weightSec : 0;
  existing.sampleCount += Number.isFinite(bin.sampleCount) ? bin.sampleCount : 0;
  bins.set(key, existing);
}

function serializeMergedBins(bins) {
  return [...bins.values()]
    .sort((a, b) => a.row - b.row || a.column - b.column)
    .map((bin) => ({
      column: bin.column,
      row: bin.row,
      weightSec: roundNumber(bin.weightSec),
      sampleCount: bin.sampleCount,
    }));
}

function cloneMetadata(heatmap) {
  const metadata = { ...heatmap };

  if (Array.isArray(heatmap?.yawRange)) {
    metadata.yawRange = [...heatmap.yawRange];
  }

  if (Array.isArray(heatmap?.pitchRange)) {
    metadata.pitchRange = [...heatmap.pitchRange];
  }

  return metadata;
}

export function mergeCompatibleHeatmaps(heatmaps) {
  if (!Array.isArray(heatmaps) || heatmaps.length === 0) {
    throw new Error('No heatmaps to merge.');
  }

  heatmaps.forEach((heatmap, index) => {
    assertValidHeatmap(heatmap, index);
  });

  const compatibilityKey = getHeatmapCompatibilityKey(heatmaps[0]);
  const bins = new Map();

  heatmaps.forEach((heatmap, index) => {
    const actualKey = getHeatmapCompatibilityKey(heatmap);

    if (actualKey !== compatibilityKey) {
      throw new Error(
        `Incompatible heatmap grids at index ${index}: expected ${compatibilityKey}, actual ${actualKey}`,
      );
    }

    (Array.isArray(heatmap.bins) ? heatmap.bins : []).forEach((bin) => {
      addMergedBin(bins, bin, heatmap);
    });
  });

  const totalWeightSec = roundNumber(
    [...bins.values()].reduce((sum, bin) => sum + bin.weightSec, 0),
  );
  const mergedBins = serializeMergedBins(bins);

  return {
    ...cloneMetadata(heatmaps[0]),
    sourceHeatmapCount: heatmaps.length,
    totalWeightSec,
    bins: mergedBins,
  };
}
