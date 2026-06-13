function roundNumber(value, digits = 3) {
  return Number(value.toFixed(digits));
}

function getIds(items = []) {
  return items.map((item) => item.id);
}

function serializeAoiCoordinate(value) {
  return Number.isFinite(Number(value)) ? Number(Number(value).toFixed(3)) : null;
}

function serializeAoiPoints(points) {
  return Array.isArray(points)
    ? points.map((point) => (
      point && typeof point === 'object'
        ? { ...point }
        : point
    ))
    : null;
}

function getAoiSpace(aoi) {
  return aoi?.space === 'video' ? 'video' : 'panorama';
}

function buildActiveAoiSnapshot(aoi) {
  const snapshot = {
    id: aoi.id,
    label: aoi.label,
    color: aoi.color,
    space: getAoiSpace(aoi),
    shape: aoi.shape || 'box',
    points: serializeAoiPoints(aoi.points),
    yawMin: serializeAoiCoordinate(aoi.yawMin),
    yawMax: serializeAoiCoordinate(aoi.yawMax),
    pitchMin: serializeAoiCoordinate(aoi.pitchMin),
    pitchMax: serializeAoiCoordinate(aoi.pitchMax),
    xMin: serializeAoiCoordinate(aoi.xMin),
    xMax: serializeAoiCoordinate(aoi.xMax),
    yMin: serializeAoiCoordinate(aoi.yMin),
    yMax: serializeAoiCoordinate(aoi.yMax),
  };
  const analysisPaddingPx = serializeAoiCoordinate(aoi.analysisPaddingPx);
  const analysisPadding = serializeAoiCoordinate(aoi.analysisPadding);

  if (analysisPaddingPx != null) {
    snapshot.analysisPaddingPx = analysisPaddingPx;
  }

  if (analysisPadding != null) {
    snapshot.analysisPadding = analysisPadding;
  }

  return snapshot;
}

function buildSampleQuality(quality, gazeStreamQuality) {
  if (!gazeStreamQuality) {
    return quality;
  }

  return {
    ...(quality || {}),
    gazeStreamQuality,
  };
}

export function buildRecordingSample({
  timeSec,
  source,
  gaze,
  rawGaze = null,
  camera,
  panorama,
  hits = [],
  stableHits = [],
  activeAois = [],
  classification = null,
  aoiStability = null,
  uncertainty = null,
  quality,
  gazeStreamQuality = null,
}) {
  const sampleQuality = buildSampleQuality(quality, gazeStreamQuality) || {};
  if (aoiStability) {
    sampleQuality.trustedForAoiAnalysis = Boolean(aoiStability.trustedForAoiAnalysis);
  }

  return {
    t: roundNumber(timeSec),
    source,
    quality: sampleQuality,
    screen: {
      x: Math.round(gaze.x),
      y: Math.round(gaze.y),
    },
    rawScreen: rawGaze ? {
      x: Math.round(rawGaze.x),
      y: Math.round(rawGaze.y),
    } : null,
    camera: {
      yaw: roundNumber(camera.yaw),
      pitch: roundNumber(camera.pitch),
      fov: camera.fov,
    },
    panorama: {
      yaw: roundNumber(panorama.yaw),
      pitch: roundNumber(panorama.pitch),
    },
    hits: getIds(hits),
    stableHits: getIds(stableHits),
    activeAois: activeAois.map(buildActiveAoiSnapshot),
    likelyHits: getIds(classification?.likelyHits || []),
    possibleHits: getIds(classification?.possibleHits || []),
    ambiguousHits: getIds(classification?.ambiguousHits || []),
    aoiStability: aoiStability ? {
      candidateAois: Array.isArray(aoiStability.candidateAois)
        ? aoiStability.candidateAois.map((candidate) => ({ ...candidate }))
        : [],
      trustedForAoiAnalysis: Boolean(aoiStability.trustedForAoiAnalysis),
    } : null,
    gazeUncertainty: uncertainty || { px: 0, yawRadius: 0, pitchRadius: 0 },
  };
}
