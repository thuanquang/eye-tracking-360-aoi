function roundNumber(value, digits = 3) {
  return Number(value.toFixed(digits));
}

function getIds(items = []) {
  return items.map((item) => item.id);
}

function buildActiveAoiSnapshot(aoi) {
  return {
    id: aoi.id,
    label: aoi.label,
    yawMin: roundNumber(aoi.yawMin),
    yawMax: roundNumber(aoi.yawMax),
    pitchMin: roundNumber(aoi.pitchMin),
    pitchMax: roundNumber(aoi.pitchMax),
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
  activeAois = [],
  classification = null,
  uncertainty = null,
  quality,
}) {
  return {
    t: roundNumber(timeSec),
    source,
    quality,
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
    activeAois: activeAois.map(buildActiveAoiSnapshot),
    likelyHits: getIds(classification?.likelyHits || []),
    possibleHits: getIds(classification?.possibleHits || []),
    ambiguousHits: getIds(classification?.ambiguousHits || []),
    gazeUncertainty: uncertainty || { px: 0, yawRadius: 0, pitchRadius: 0 },
  };
}
