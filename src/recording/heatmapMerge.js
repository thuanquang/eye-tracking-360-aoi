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

function addMergedBin(bins, bin) {
  const { column, row } = bin || {};

  if (!Number.isFinite(column) || !Number.isFinite(row)) {
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

  const compatibilityKey = getHeatmapCompatibilityKey(heatmaps[0]);
  const bins = new Map();

  heatmaps.forEach((heatmap) => {
    if (getHeatmapCompatibilityKey(heatmap) !== compatibilityKey) {
      throw new Error('Incompatible heatmap grids');
    }

    (Array.isArray(heatmap.bins) ? heatmap.bins : []).forEach((bin) => {
      addMergedBin(bins, bin);
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
