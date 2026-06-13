import { AOI_SPACES } from './aoiSchema.js';
import { getAoiSpace } from './aoiImport.js';

const DEFAULT_OPTIONS = {
  autoRegionMinKeyframes: 3,
  iouThreshold: 0.55,
  maxAverageArea: 0.95,
  maxAois: 80,
  minAverageArea: 0.00005,
  minKeyframes: 2,
  sameTimeToleranceSeconds: 0.35,
};

function stableClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function sourceMethodFromIndexedCharacters(source) {
  const entries = Object.entries(source)
    .filter(([key, value]) => /^\d+$/.test(key) && typeof value === 'string')
    .sort(([first], [second]) => Number(first) - Number(second));

  return entries.length ? entries.map(([, value]) => value).join('') : '';
}

function normalizeProjectSource(source) {
  if (source && typeof source === 'object' && !Array.isArray(source)) {
    const normalized = { ...source };
    const method = normalized.method || sourceMethodFromIndexedCharacters(normalized);

    Object.keys(normalized).forEach((key) => {
      if (/^\d+$/.test(key)) {
        delete normalized[key];
      }
    });

    return method ? { method, ...normalized } : normalized;
  }

  if (typeof source === 'string' && source.trim()) {
    return { method: source };
  }

  return {};
}

function normalizeLabel(label) {
  return String(label || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function isAutoRegion(aoi) {
  return normalizeLabel(aoi.label).startsWith('auto-region-');
}

function keyframesForAoi(aoi) {
  if (Array.isArray(aoi.keyframes) && aoi.keyframes.length > 0) {
    return aoi.keyframes;
  }

  return [{ t: 0, ...aoi }];
}

function pointsForFrame(aoi, frame) {
  if (aoi.shape === 'polygon') {
    return frame.points || aoi.points || [];
  }

  const space = getAoiSpace(aoi);
  if (space === AOI_SPACES.video) {
    return [
      { x: frame.xMin ?? aoi.xMin, y: frame.yMin ?? aoi.yMin },
      { x: frame.xMax ?? aoi.xMax, y: frame.yMin ?? aoi.yMin },
      { x: frame.xMax ?? aoi.xMax, y: frame.yMax ?? aoi.yMax },
      { x: frame.xMin ?? aoi.xMin, y: frame.yMax ?? aoi.yMax },
    ];
  }

  return [
    { yaw: frame.yawMin ?? aoi.yawMin, pitch: frame.pitchMin ?? aoi.pitchMin },
    { yaw: frame.yawMax ?? aoi.yawMax, pitch: frame.pitchMin ?? aoi.pitchMin },
    { yaw: frame.yawMax ?? aoi.yawMax, pitch: frame.pitchMax ?? aoi.pitchMax },
    { yaw: frame.yawMin ?? aoi.yawMin, pitch: frame.pitchMax ?? aoi.pitchMax },
  ];
}

function pointToUnit(point, space) {
  if (space === AOI_SPACES.video) {
    return { x: Number(point.x), y: Number(point.y) };
  }

  return {
    x: (Number(point.yaw) + 180) / 360,
    y: (90 - Number(point.pitch)) / 180,
  };
}

function boundsForPoints(points, space) {
  const unitPoints = points
    .map((point) => pointToUnit(point, space))
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));

  if (unitPoints.length === 0) {
    return null;
  }

  const xs = unitPoints.map((point) => point.x);
  const ys = unitPoints.map((point) => point.y);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);

  if (xMax <= xMin || yMax <= yMin) {
    return null;
  }

  return { xMin, xMax, yMin, yMax, area: (xMax - xMin) * (yMax - yMin) };
}

function frameBox(aoi, frame) {
  return boundsForPoints(pointsForFrame(aoi, frame), getAoiSpace(aoi));
}

function aoiBoxes(aoi) {
  return keyframesForAoi(aoi)
    .map((frame) => ({ t: Number(frame.t ?? 0), box: frameBox(aoi, frame) }))
    .filter((entry) => Number.isFinite(entry.t) && entry.box);
}

function intersectionOverUnion(first, second) {
  const xOverlap = Math.max(0, Math.min(first.xMax, second.xMax) - Math.max(first.xMin, second.xMin));
  const yOverlap = Math.max(0, Math.min(first.yMax, second.yMax) - Math.max(first.yMin, second.yMin));
  const intersection = xOverlap * yOverlap;
  const union = first.area + second.area - intersection;

  return union > 0 ? intersection / union : 0;
}

function averageArea(aoi) {
  const boxes = aoiBoxes(aoi);
  if (boxes.length === 0) {
    return 0;
  }

  return boxes.reduce((total, entry) => total + entry.box.area, 0) / boxes.length;
}

function shouldKeepAoi(aoi, options) {
  const keyframeCount = keyframesForAoi(aoi).length;
  const requiredKeyframes = isAutoRegion(aoi) ? options.autoRegionMinKeyframes : options.minKeyframes;
  const area = averageArea(aoi);

  return (
    keyframeCount >= requiredKeyframes &&
    area >= options.minAverageArea &&
    area <= options.maxAverageArea
  );
}

function aoiQualityScore(aoi) {
  const keyframeCount = keyframesForAoi(aoi).length;
  const area = averageArea(aoi);
  const sourceScore = Number(aoi.metadata?.meanScore ?? aoi.confidence ?? 0);

  return keyframeCount * 10 + Math.min(area, 0.25) * 20 + sourceScore;
}

function canMergeAois(first, second, options) {
  if (normalizeLabel(first.label) !== normalizeLabel(second.label)) {
    return false;
  }

  if (getAoiSpace(first) !== getAoiSpace(second)) {
    return false;
  }

  const firstBoxes = aoiBoxes(first);
  const secondBoxes = aoiBoxes(second);
  const overlaps = [];

  for (const a of firstBoxes) {
    for (const b of secondBoxes) {
      if (Math.abs(a.t - b.t) <= options.sameTimeToleranceSeconds) {
        overlaps.push(intersectionOverUnion(a.box, b.box));
      }
    }
  }

  return overlaps.length > 0 && Math.max(...overlaps) >= options.iouThreshold;
}

function frameKey(frame) {
  return Number(frame.t ?? 0).toFixed(3);
}

function mergeAoiPair(first, second) {
  const preferred = aoiQualityScore(first) >= aoiQualityScore(second) ? first : second;
  const merged = stableClone(preferred);
  const framesByTime = new Map();

  for (const frame of [...keyframesForAoi(first), ...keyframesForAoi(second)]) {
    const key = frameKey(frame);
    const current = framesByTime.get(key);
    if (!current || pointsForFrame(preferred, frame).length >= pointsForFrame(preferred, current).length) {
      framesByTime.set(key, stableClone(frame));
    }
  }

  merged.keyframes = [...framesByTime.values()].sort((a, b) => Number(a.t ?? 0) - Number(b.t ?? 0));
  merged.points = stableClone(pointsForFrame(merged, merged.keyframes[0]));
  merged.metadata = {
    ...(merged.metadata || {}),
    postprocess: {
      ...(merged.metadata?.postprocess || {}),
      mergedFrom: [...new Set([first.id, second.id, ...(merged.metadata?.postprocess?.mergedFrom || [])])],
    },
  };

  return refreshAoiBounds(merged);
}

function mergeDuplicates(aois, options) {
  const remaining = aois.map(stableClone);
  let mergedCount = 0;
  let changed = true;

  while (changed) {
    changed = false;

    outer: for (let i = 0; i < remaining.length; i += 1) {
      for (let j = i + 1; j < remaining.length; j += 1) {
        if (canMergeAois(remaining[i], remaining[j], options)) {
          remaining[i] = mergeAoiPair(remaining[i], remaining[j]);
          remaining.splice(j, 1);
          mergedCount += 1;
          changed = true;
          break outer;
        }
      }
    }
  }

  return { aois: remaining, mergedCount };
}

function refreshAoiBounds(aoi) {
  const refreshed = stableClone(aoi);
  const space = getAoiSpace(refreshed);
  const allPoints = keyframesForAoi(refreshed).flatMap((frame) => pointsForFrame(refreshed, frame));

  if (space === AOI_SPACES.video) {
    const xs = allPoints.map((point) => Number(point.x)).filter(Number.isFinite);
    const ys = allPoints.map((point) => Number(point.y)).filter(Number.isFinite);
    refreshed.xMin = Math.min(...xs);
    refreshed.xMax = Math.max(...xs);
    refreshed.yMin = Math.min(...ys);
    refreshed.yMax = Math.max(...ys);
  } else {
    const yaws = allPoints.map((point) => Number(point.yaw)).filter(Number.isFinite);
    const pitches = allPoints.map((point) => Number(point.pitch)).filter(Number.isFinite);
    refreshed.yawMin = Math.min(...yaws);
    refreshed.yawMax = Math.max(...yaws);
    refreshed.pitchMin = Math.min(...pitches);
    refreshed.pitchMax = Math.max(...pitches);
  }

  return refreshed;
}

function applyQualityCap(aois, options) {
  if (!Number.isFinite(options.maxAois) || options.maxAois <= 0 || aois.length <= options.maxAois) {
    return { aois, cappedCount: 0 };
  }

  const sorted = [...aois].sort((a, b) => aoiQualityScore(b) - aoiQualityScore(a));
  return {
    aois: sorted.slice(0, options.maxAois),
    cappedCount: sorted.length - options.maxAois,
  };
}

export function postprocessAoiProject(project, optionOverrides = {}) {
  const options = { ...DEFAULT_OPTIONS, ...optionOverrides };
  const inputAois = Array.isArray(project?.aois) ? project.aois : [];
  const filteredAois = inputAois.filter((aoi) => shouldKeepAoi(aoi, options)).map(refreshAoiBounds);
  const { aois: mergedAois, mergedCount } = mergeDuplicates(filteredAois, options);
  const { aois: cappedAois, cappedCount } = applyQualityCap(mergedAois, options);
  const outputAois = cappedAois
    .map(refreshAoiBounds)
    .sort((a, b) => normalizeLabel(a.label).localeCompare(normalizeLabel(b.label)) || a.id.localeCompare(b.id));

  return {
    ...stableClone(project),
    generatedAt: new Date().toISOString(),
    source: {
      ...normalizeProjectSource(project.source),
      postprocess: 'aoiPostprocess',
    },
    aois: outputAois,
    stats: {
      ...(project.stats || {}),
      postprocess: {
        inputAois: inputAois.length,
        outputAois: outputAois.length,
        filteredAois: inputAois.length - filteredAois.length + cappedCount,
        mergedAois: mergedCount,
        cappedAois: cappedCount,
        options,
      },
    },
  };
}

export function summarizeAoiProjectCleanup(project) {
  const postprocess = project?.stats?.postprocess || {};

  return {
    inputAois: postprocess.inputAois ?? 0,
    outputAois: Array.isArray(project?.aois) ? project.aois.length : 0,
    filteredAois: postprocess.filteredAois ?? 0,
    mergedAois: postprocess.mergedAois ?? 0,
  };
}
