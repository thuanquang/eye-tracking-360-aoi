import { AOI_SPACES } from './aoiSchema.js';
import { getAoiSpace } from './aoiImport.js';
import { filterGeneratedSceneBackgroundAois } from './generatedAoiFilter.js';

const DEFAULT_OPTIONS = {
  autoRegionMinKeyframes: 3,
  containmentThreshold: 0.8,
  duplicateContainmentThreshold: 0.8,
  iouThreshold: 0.8,
  maxAverageArea: 0.95,
  maxAois: null,
  minAverageArea: 0.00005,
  minKeyframes: 2,
  overlapTimeThreshold: 0.8,
  sameTimeToleranceSeconds: 0.35,
  smallAoiMergeContainmentThreshold: 0.8,
  smallAoiMergeDiameterPx: 50,
  suppressContainedSemanticAois: false,
};

const DEDUPE_LABEL_ALIASES = new Map([
  ['bicycle', 'bicycle'],
  ['bike', 'bicycle'],
  ['building facade', 'building'],
  ['car', 'car'],
  ['facade', 'building'],
  ['flower', 'plant'],
  ['lamp post', 'street light'],
  ['motorbike', 'motorcycle'],
  ['motorcycle', 'motorcycle'],
  ['pedestrian', 'person'],
  ['person', 'person'],
  ['scooter', 'motorcycle'],
  ['security guard', 'person'],
  ['shop sign', 'sign'],
  ['storefront sign', 'sign'],
  ['street lamp', 'street light'],
  ['street light', 'street light'],
  ['street sign', 'sign'],
  ['street vendor', 'person'],
  ['taxi', 'car'],
  ['tourist', 'person'],
  ['traffic sign', 'sign'],
]);

const CONTAINMENT_SUPPRESSION_RULES = new Map([
  ['costume', new Set(['person'])],
  ['dress', new Set(['costume', 'person'])],
  ['flower', new Set(['flower bed', 'plant', 'planter'])],
  ['hat', new Set(['person'])],
  ['plant', new Set(['flower bed', 'planter', 'tree'])],
  ['shoe', new Set(['person'])],
  ['shoreline', new Set(['riverbank', 'shoreline riverbank'])],
  ['window', new Set(['building', 'building facade', 'facade', 'storefront', 'temple'])],
]);

const DEDUPE_LABEL_DISPLAY = new Map([
  ['bicycle', 'bicycle'],
  ['building', 'building'],
  ['car', 'car'],
  ['motorcycle', 'motorcycle'],
  ['person', 'person'],
  ['plant', 'plant'],
  ['sign', 'sign'],
  ['street light', 'street light'],
]);

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

function dedupeLabelKey(label) {
  const normalized = normalizeLabel(label);
  return DEDUPE_LABEL_ALIASES.get(normalized) || normalized;
}

function displayLabelForDedupeKey(key, fallback) {
  return DEDUPE_LABEL_DISPLAY.get(key) || fallback;
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
  const intersection = intersectionArea(first, second);
  const union = first.area + second.area - intersection;

  return union > 0 ? intersection / union : 0;
}

function intersectionArea(first, second) {
  const xOverlap = Math.max(0, Math.min(first.xMax, second.xMax) - Math.max(first.xMin, second.xMin));
  const yOverlap = Math.max(0, Math.min(first.yMax, second.yMax) - Math.max(first.yMin, second.yMin));
  return xOverlap * yOverlap;
}

function smallerBoxOverlapRatio(first, second) {
  const smallerArea = Math.min(first.area, second.area);
  return smallerArea > 0 ? intersectionArea(first, second) / smallerArea : 0;
}

function bestTimedOverlapRatios(sourceBoxes, targetBoxes, options, ratioForPair) {
  const ratios = [];

  for (const sourceEntry of sourceBoxes) {
    let bestRatio = null;

    for (const targetEntry of targetBoxes) {
      if (Math.abs(sourceEntry.t - targetEntry.t) <= options.sameTimeToleranceSeconds) {
        const ratio = ratioForPair(sourceEntry.box, targetEntry.box);
        bestRatio = bestRatio === null ? ratio : Math.max(bestRatio, ratio);
      }
    }

    if (bestRatio !== null) {
      ratios.push(bestRatio);
    }
  }

  return ratios;
}

function hasSustainedOverlap(ratios, overlapThreshold, timeThreshold) {
  if (ratios.length === 0) {
    return false;
  }

  const qualifyingFrames = ratios.filter((ratio) => ratio >= overlapThreshold).length;
  return qualifyingFrames / ratios.length >= timeThreshold;
}

function timedOverlapCoverage(sourceBoxes, targetBoxes, options, ratioForPair, overlapThreshold) {
  if (sourceBoxes.length === 0) {
    return 0;
  }

  let qualifyingFrames = 0;

  for (const sourceEntry of sourceBoxes) {
    let bestRatio = 0;

    for (const targetEntry of targetBoxes) {
      if (Math.abs(sourceEntry.t - targetEntry.t) <= options.sameTimeToleranceSeconds) {
        bestRatio = Math.max(bestRatio, ratioForPair(sourceEntry.box, targetEntry.box));
      }
    }

    if (bestRatio >= overlapThreshold) {
      qualifyingFrames += 1;
    }
  }

  return qualifyingFrames / sourceBoxes.length;
}

function hasMutualSustainedOverlap(firstBoxes, secondBoxes, options, ratioForPair, overlapThreshold) {
  return (
    timedOverlapCoverage(firstBoxes, secondBoxes, options, ratioForPair, overlapThreshold)
      >= options.overlapTimeThreshold
    && timedOverlapCoverage(secondBoxes, firstBoxes, options, ratioForPair, overlapThreshold)
      >= options.overlapTimeThreshold
  );
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
  const firstDedupeKey = dedupeLabelKey(first.label);
  const secondDedupeKey = dedupeLabelKey(second.label);

  if (firstDedupeKey !== secondDedupeKey) {
    return false;
  }

  if (getAoiSpace(first) !== getAoiSpace(second)) {
    return false;
  }

  const firstBoxes = aoiBoxes(first);
  const secondBoxes = aoiBoxes(second);

  return hasMutualSustainedOverlap(
    firstBoxes,
    secondBoxes,
    options,
    smallerBoxOverlapRatio,
    options.duplicateContainmentThreshold,
  );
}

function frameKey(frame) {
  return Number(frame.t ?? 0).toFixed(3);
}

function mergeAoiPair(first, second) {
  const preferred = aoiQualityScore(first) >= aoiQualityScore(second) ? first : second;
  const merged = stableClone(preferred);
  const framesByTime = new Map();
  const dedupeKey = dedupeLabelKey(preferred.label);
  const mergedFrom = new Set([
    first.id,
    second.id,
    ...(first.metadata?.postprocess?.mergedFrom || []),
    ...(second.metadata?.postprocess?.mergedFrom || []),
  ]);

  for (const frame of [...keyframesForAoi(first), ...keyframesForAoi(second)]) {
    const key = frameKey(frame);
    const current = framesByTime.get(key);
    if (!current || pointsForFrame(preferred, frame).length >= pointsForFrame(preferred, current).length) {
      framesByTime.set(key, stableClone(frame));
    }
  }

  merged.keyframes = [...framesByTime.values()].sort((a, b) => Number(a.t ?? 0) - Number(b.t ?? 0));
  merged.points = stableClone(pointsForFrame(merged, merged.keyframes[0]));
  merged.label = displayLabelForDedupeKey(dedupeKey, merged.label);
  merged.metadata = {
    ...(merged.metadata || {}),
    postprocess: {
      ...(merged.metadata?.postprocess || {}),
      dedupeLabelKey: dedupeKey,
      mergedFrom: [...mergedFrom],
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

function firstPositiveNumber(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) {
      return number;
    }
  }

  return null;
}

function pixelDimensionsForProject(project, options) {
  const video = project?.video || {};
  const metadata = video.metadata || {};
  const dimensions = video.dimensions || {};
  const width = firstPositiveNumber(
    options.videoWidthPx,
    options.referenceWidthPx,
    video.width,
    video.videoWidth,
    video.sourceWidth,
    video.naturalWidth,
    metadata.width,
    metadata.videoWidth,
    dimensions.width,
  );
  const height = firstPositiveNumber(
    options.videoHeightPx,
    options.referenceHeightPx,
    video.height,
    video.videoHeight,
    video.sourceHeight,
    video.naturalHeight,
    metadata.height,
    metadata.videoHeight,
    dimensions.height,
  );

  if (width && height) {
    return { width, height };
  }

  if (normalizeLabel(video.projection) === 'equirectangular') {
    return { width: 3840, height: 1920 };
  }

  return { width: 1920, height: 1080 };
}

function pixelDiameterForBox(box, dimensions) {
  const widthPx = Math.max(0, box.xMax - box.xMin) * dimensions.width;
  const heightPx = Math.max(0, box.yMax - box.yMin) * dimensions.height;
  return Math.hypot(widthPx, heightPx);
}

function averagePixelDiameter(aoi, dimensions) {
  const boxes = aoiBoxes(aoi);
  if (boxes.length === 0) {
    return 0;
  }

  return boxes.reduce((total, entry) => total + pixelDiameterForBox(entry.box, dimensions), 0) / boxes.length;
}

function absorbAoiIntoContainer(container, absorbed) {
  const merged = stableClone(container);
  const dedupeKey = dedupeLabelKey(container.label);
  const mergedFrom = new Set([
    container.id,
    absorbed.id,
    ...(container.metadata?.postprocess?.mergedFrom || []),
    ...(absorbed.metadata?.postprocess?.mergedFrom || []),
  ]);

  merged.label = displayLabelForDedupeKey(dedupeKey, merged.label);
  merged.metadata = {
    ...(merged.metadata || {}),
    postprocess: {
      ...(merged.metadata?.postprocess || {}),
      dedupeLabelKey: dedupeKey,
      mergedFrom: [...mergedFrom],
      smallMergedFrom: [
        ...(merged.metadata?.postprocess?.smallMergedFrom || []),
        absorbed.id,
      ],
    },
  };

  return refreshAoiBounds(merged);
}

function smallMergeMatch(candidate, container, options, dimensions) {
  if (dedupeLabelKey(candidate.label) !== dedupeLabelKey(container.label)) {
    return null;
  }

  if (getAoiSpace(candidate) !== getAoiSpace(container)) {
    return null;
  }

  const candidateDiameter = averagePixelDiameter(candidate, dimensions);
  const containerDiameter = averagePixelDiameter(container, dimensions);

  if (
    candidateDiameter <= 0
    || candidateDiameter > options.smallAoiMergeDiameterPx
    || containerDiameter <= options.smallAoiMergeDiameterPx
    || containerDiameter <= candidateDiameter
  ) {
    return null;
  }

  const coverage = timedOverlapCoverage(
    aoiBoxes(candidate),
    aoiBoxes(container),
    options,
    containmentRatio,
    options.smallAoiMergeContainmentThreshold,
  );

  if (coverage < options.overlapTimeThreshold) {
    return null;
  }

  return {
    candidateDiameter,
    containerDiameter,
    coverage,
  };
}

function mergeSmallAois(aois, options, dimensions) {
  if (!Number.isFinite(options.smallAoiMergeDiameterPx) || options.smallAoiMergeDiameterPx <= 0) {
    return { aois, smallMergedCount: 0 };
  }

  const remaining = aois.map(stableClone);
  let smallMergedCount = 0;
  let changed = true;

  while (changed) {
    changed = false;

    outer: for (let i = 0; i < remaining.length; i += 1) {
      let bestTarget = null;

      for (let j = 0; j < remaining.length; j += 1) {
        if (i === j) {
          continue;
        }

        const match = smallMergeMatch(remaining[i], remaining[j], options, dimensions);
        if (!match) {
          continue;
        }

        const score = match.coverage * 1000 + match.containerDiameter + aoiQualityScore(remaining[j]);
        if (!bestTarget || score > bestTarget.score) {
          bestTarget = { index: j, score };
        }
      }

      if (bestTarget) {
        remaining[bestTarget.index] = absorbAoiIntoContainer(remaining[bestTarget.index], remaining[i]);
        remaining.splice(i, 1);
        smallMergedCount += 1;
        changed = true;
        break outer;
      }
    }
  }

  return { aois: remaining, smallMergedCount };
}

function containmentRatio(candidateBox, containerBox) {
  return candidateBox.area > 0 ? intersectionArea(candidateBox, containerBox) / candidateBox.area : 0;
}

function canSuppressContainedAoi(candidate, container, options) {
  const candidateLabel = normalizeLabel(candidate.label);
  const allowedContainers = CONTAINMENT_SUPPRESSION_RULES.get(candidateLabel);
  if (!allowedContainers || !allowedContainers.has(normalizeLabel(container.label))) {
    return false;
  }

  if (getAoiSpace(candidate) !== getAoiSpace(container)) {
    return false;
  }

  const candidateBoxes = aoiBoxes(candidate);
  const containerBoxes = aoiBoxes(container);
  const ratios = bestTimedOverlapRatios(candidateBoxes, containerBoxes, options, containmentRatio);

  return hasSustainedOverlap(ratios, options.containmentThreshold, options.overlapTimeThreshold);
}

function suppressContainedAois(aois, options) {
  if (!options.suppressContainedSemanticAois) {
    return { aois, suppressedCount: 0 };
  }

  const suppressedIndexes = new Set();

  for (let i = 0; i < aois.length; i += 1) {
    if (suppressedIndexes.has(i)) {
      continue;
    }

    for (let j = 0; j < aois.length; j += 1) {
      if (i === j || suppressedIndexes.has(j)) {
        continue;
      }

      if (canSuppressContainedAoi(aois[i], aois[j], options)) {
        suppressedIndexes.add(i);
        break;
      }
    }
  }

  return {
    aois: aois.filter((_, index) => !suppressedIndexes.has(index)),
    suppressedCount: suppressedIndexes.size,
  };
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
  const dimensions = pixelDimensionsForProject(project, options);
  const sceneFilteredAois = filterGeneratedSceneBackgroundAois(inputAois);
  const filteredAois = sceneFilteredAois.filter((aoi) => shouldKeepAoi(aoi, options)).map(refreshAoiBounds);
  const { aois: mergedAois, mergedCount } = mergeDuplicates(filteredAois, options);
  const { aois: smallMergedAois, smallMergedCount } = mergeSmallAois(mergedAois, options, dimensions);
  const { aois: suppressedAois, suppressedCount } = suppressContainedAois(smallMergedAois, options);
  const { aois: cappedAois, cappedCount } = applyQualityCap(suppressedAois, options);
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
        filteredAois: inputAois.length - filteredAois.length + suppressedCount + cappedCount,
        mergedAois: mergedCount,
        smallMergedAois: smallMergedCount,
        suppressedAois: suppressedCount,
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
    smallMergedAois: postprocess.smallMergedAois ?? 0,
  };
}
