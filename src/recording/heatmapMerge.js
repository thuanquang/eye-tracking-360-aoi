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

function getPayloadVideo(payload) {
  return payload?.video ?? payload?.project?.video ?? null;
}

function normalizeVideoKeyPart(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function isBlobUrl(value) {
  return typeof value === 'string' && value.trim().toLowerCase().startsWith('blob:');
}

function getStableVideoSource(video) {
  if (!video) {
    return null;
  }

  if (video.src && !isBlobUrl(video.src)) {
    return video.src;
  }

  return video.path ?? null;
}

export function getHeatmapVideoKey(payload) {
  const video = getPayloadVideo(payload);
  let parts = [];

  if (video?.kind === 'local-file') {
    parts = [
      normalizeVideoKeyPart(video.name),
      normalizeVideoKeyPart(video.size),
      normalizeVideoKeyPart(video.lastModified),
    ].filter(Boolean);
  } else {
    const id = normalizeVideoKeyPart(video?.id);

    if (id) {
      return id;
    }

    parts = [
      normalizeVideoKeyPart(video?.name),
      normalizeVideoKeyPart(getStableVideoSource(video)),
    ].filter(Boolean);
  }

  return parts.length > 0 ? parts.join('|') : null;
}

function cloneVideoMetadata(video) {
  return isObject(video) ? { ...video } : null;
}

function getParticipantId(payload) {
  return payload?.participant?.id
    ?? payload?.participant?.participantId
    ?? payload?.participantId
    ?? null;
}

function getExportedAt(payload) {
  return payload?.exportedAt ?? null;
}

function getEntryHeatmaps(entry) {
  const heatmaps = entry?.payload?.summary?.heatmaps;
  return isObject(heatmaps) ? heatmaps : null;
}

function getMergeErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function addIncompatibleHeatmapSkip(skipped, groupKey, heatmapPath, sourceFiles, error) {
  skipped.push({
    reason: 'incompatible-heatmap-grid',
    groupKey,
    heatmapPath,
    sourceFiles,
    message: getMergeErrorMessage(error),
  });
}

function mergeHeatmapPath({ group, heatmapPath, getHeatmap, setHeatmap, skipped }) {
  const heatmapEntries = group.entries
    .map((entry) => ({
      fileName: entry.fileName,
      heatmap: getHeatmap(entry.heatmaps),
    }))
    .filter((entry) => Boolean(entry.heatmap));
  const heatmaps = heatmapEntries.map((entry) => entry.heatmap);

  if (heatmaps.length === 0) {
    return;
  }

  try {
    setHeatmap(mergeCompatibleHeatmaps(heatmaps));
  } catch (error) {
    addIncompatibleHeatmapSkip(
      skipped,
      group.groupKey,
      heatmapPath,
      heatmapEntries.map((entry) => entry.fileName),
      error,
    );
  }
}

function buildMergedGroupHeatmaps(group, skipped) {
  const heatmaps = {};
  const heatmapTypes = ['screen', 'panorama'];
  const variantNames = ['trusted', 'likely', 'possible'];

  heatmapTypes.forEach((type) => {
    mergeHeatmapPath({
      group,
      heatmapPath: type,
      getHeatmap: (sourceHeatmaps) => sourceHeatmaps?.[type],
      setHeatmap: (mergedHeatmap) => {
        heatmaps[type] = mergedHeatmap;
      },
      skipped,
    });
  });

  const variants = {};

  variantNames.forEach((variantName) => {
    const variantHeatmaps = {};

    heatmapTypes.forEach((type) => {
      mergeHeatmapPath({
        group,
        heatmapPath: `variants.${variantName}.${type}`,
        getHeatmap: (sourceHeatmaps) => sourceHeatmaps?.variants?.[variantName]?.[type],
        setHeatmap: (mergedHeatmap) => {
          variantHeatmaps[type] = mergedHeatmap;
        },
        skipped,
      });
    });

    if (Object.keys(variantHeatmaps).length > 0) {
      variants[variantName] = variantHeatmaps;
    }
  });

  if (Object.keys(variants).length > 0) {
    heatmaps.variants = variants;
  }

  return heatmaps;
}

function buildMergedGroup(group, skipped) {
  return {
    groupKey: group.groupKey,
    video: group.video,
    sourceCount: group.entries.length,
    sources: group.entries.map((entry) => ({
      fileName: entry.fileName,
      exportedAt: getExportedAt(entry.payload),
      participantId: getParticipantId(entry.payload),
    })),
    summary: {
      heatmaps: buildMergedGroupHeatmaps(group, skipped),
    },
  };
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

export async function readHeatmapExportFiles(files) {
  const sourceFiles = Array.isArray(files) ? files : Array.from(files || []);
  const results = await Promise.all(sourceFiles.map(async (file) => {
    const fileName = file?.name || 'heatmap.json';

    try {
      const payload = JSON.parse(await file.text());
      return {
        entry: {
          fileName,
          payload,
        },
      };
    } catch (error) {
      return {
        skipped: {
          fileName,
          reason: 'invalid-json',
          message: getMergeErrorMessage(error),
        },
      };
    }
  }));

  const entries = [];
  const skipped = [];

  results.forEach((result) => {
    if (result.entry) {
      entries.push(result.entry);
    } else if (result.skipped) {
      skipped.push(result.skipped);
    }
  });

  return {
    sourceFileCount: sourceFiles.length,
    entries,
    skipped,
  };
}

export function isMergedHeatmapExport(payload) {
  return (
    isObject(payload) &&
    payload.kind === 'merged-heatmaps' &&
    Array.isArray(payload.groups)
  );
}

function assertMergedHeatmapObject(value, groupIndex, path) {
  if (!isObject(value) || Array.isArray(value)) {
    throw new Error(`Invalid merged heatmap export: group ${groupIndex} has invalid ${path}.`);
  }
}

function assertMergedHeatmapPath(heatmap, groupIndex, path) {
  try {
    assertValidHeatmap(heatmap, 0);
  } catch (error) {
    throw new Error(
      `Invalid merged heatmap export: group ${groupIndex} has invalid ${path}: ${
        getMergeErrorMessage(error)
      }`,
    );
  }
}

function assertMergedHeatmapGroup(group, groupIndex) {
  if (!isObject(group)) {
    throw new Error(`Invalid merged heatmap export: group ${groupIndex} is invalid.`);
  }

  const heatmaps = group.summary?.heatmaps;
  assertMergedHeatmapObject(heatmaps, groupIndex, 'summary.heatmaps');

  let hasRenderableHeatmap = false;

  ['screen', 'panorama'].forEach((type) => {
    if (!hasOwn(heatmaps, type)) {
      return;
    }

    assertMergedHeatmapPath(heatmaps[type], groupIndex, type);
    hasRenderableHeatmap = true;
  });

  if (hasOwn(heatmaps, 'variants')) {
    assertMergedHeatmapObject(heatmaps.variants, groupIndex, 'variants');

    Object.entries(heatmaps.variants).forEach(([variantName, variantHeatmaps]) => {
      assertMergedHeatmapObject(variantHeatmaps, groupIndex, `variants.${variantName}`);

      ['screen', 'panorama'].forEach((type) => {
        if (!hasOwn(variantHeatmaps, type)) {
          return;
        }

        assertMergedHeatmapPath(
          variantHeatmaps[type],
          groupIndex,
          `variants.${variantName}.${type}`,
        );
        hasRenderableHeatmap = true;
      });
    });
  }

  if (!hasRenderableHeatmap) {
    throw new Error(`Invalid merged heatmap export: group ${groupIndex} has no renderable heatmaps.`);
  }
}

export function normalizeMergedHeatmapExport(payload) {
  if (!isMergedHeatmapExport(payload)) {
    throw new Error('Invalid merged heatmap export.');
  }

  payload.groups.forEach((group, groupIndex) => {
    assertMergedHeatmapGroup(group, groupIndex);
  });

  const groups = payload.groups;

  if (groups.length === 0) {
    throw new Error('Invalid merged heatmap export: no heatmap groups.');
  }

  return {
    ...payload,
    version: Number.isFinite(payload.version) ? payload.version : 1,
    sourceFileCount: Number.isFinite(payload.sourceFileCount) ? payload.sourceFileCount : 0,
    groupCount: groups.length,
    groups,
    skipped: Array.isArray(payload.skipped) ? payload.skipped : [],
  };
}

export async function readMergedHeatmapPackageFile(file) {
  const fileName = file?.name || 'merged-heatmaps.json';
  let payload;

  try {
    payload = JSON.parse(await file.text());
  } catch (error) {
    throw new Error(`Invalid JSON in ${fileName}: ${getMergeErrorMessage(error)}`);
  }

  return {
    fileName,
    payload: normalizeMergedHeatmapExport(payload),
  };
}

export function buildMergedHeatmapExport(entries, options = {}) {
  const sourceEntries = Array.isArray(entries) ? entries : [];
  const skipped = Array.isArray(options.skipped)
    ? options.skipped.map((entry) => ({ ...entry }))
    : [];
  const groupsByKey = new Map();

  sourceEntries.forEach((entry) => {
    const heatmaps = getEntryHeatmaps(entry);

    if (!heatmaps) {
      skipped.push({
        fileName: entry?.fileName,
        reason: 'missing-summary-heatmaps',
      });
      return;
    }

    const payload = entry.payload;
    const groupKey = getHeatmapVideoKey(payload);

    if (!groupKey) {
      skipped.push({
        fileName: entry?.fileName,
        reason: 'missing-video-metadata',
      });
      return;
    }

    let group = groupsByKey.get(groupKey);

    if (!group) {
      group = {
        groupKey,
        video: cloneVideoMetadata(getPayloadVideo(payload)),
        entries: [],
      };
      groupsByKey.set(groupKey, group);
    }

    group.entries.push({
      fileName: entry.fileName,
      payload,
      heatmaps,
    });
  });

  const groups = [...groupsByKey.values()]
    .map((group) => buildMergedGroup(group, skipped));

  return {
    kind: 'merged-heatmaps',
    version: 1,
    exportedAt: options.exportedAt ?? new Date().toISOString(),
    sourceFileCount: Number.isFinite(options.sourceFileCount)
      ? options.sourceFileCount
      : sourceEntries.length,
    groupCount: groups.length,
    groups,
    skipped,
  };
}
