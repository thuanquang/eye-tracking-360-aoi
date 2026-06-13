import { normalizeYaw } from './aoiMath.js';

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

function isVideoAoi(aoi) {
  return aoi?.space === 'video';
}

function rotateYaw(value, yawOffsetDegrees) {
  const numeric = Number(value);
  return Number.isFinite(numeric)
    ? Number(normalizeYaw(numeric + yawOffsetDegrees).toFixed(6))
    : value;
}

function rotatePointYaw(point, yawOffsetDegrees) {
  if (!point || typeof point !== 'object' || !Number.isFinite(Number(point.yaw))) {
    return point;
  }

  return {
    ...point,
    yaw: rotateYaw(point.yaw, yawOffsetDegrees),
  };
}

function rotateYawFields(value, yawOffsetDegrees) {
  const rotated = { ...value };

  if (Number.isFinite(Number(rotated.yaw))) {
    rotated.yaw = rotateYaw(rotated.yaw, yawOffsetDegrees);
  }

  if (Number.isFinite(Number(rotated.yawMin))) {
    rotated.yawMin = rotateYaw(rotated.yawMin, yawOffsetDegrees);
  }

  if (Number.isFinite(Number(rotated.yawMax))) {
    rotated.yawMax = rotateYaw(rotated.yawMax, yawOffsetDegrees);
  }

  if (Array.isArray(rotated.points)) {
    rotated.points = rotated.points.map((point) => rotatePointYaw(point, yawOffsetDegrees));
  }

  return rotated;
}

export function rotatePanoramaAoiYaw(aoi, yawOffsetDegrees = -90) {
  if (!aoi || typeof aoi !== 'object' || isVideoAoi(aoi)) {
    return stableClone(aoi);
  }

  const rotated = rotateYawFields(stableClone(aoi), yawOffsetDegrees);

  if (Array.isArray(rotated.keyframes)) {
    rotated.keyframes = rotated.keyframes.map((keyframe) => (
      keyframe && typeof keyframe === 'object'
        ? rotateYawFields(keyframe, yawOffsetDegrees)
        : keyframe
    ));
  }

  return rotated;
}

export function rotatePanoramaProjectYaw(project, yawOffsetDegrees = -90) {
  const repaired = stableClone(project);
  repaired.source = normalizeProjectSource(repaired.source);

  if (repaired?.video?.projection !== 'equirectangular' || !Array.isArray(repaired.aois)) {
    return repaired;
  }

  repaired.aois = repaired.aois.map((aoi) => rotatePanoramaAoiYaw(aoi, yawOffsetDegrees));
  repaired.source = {
    ...repaired.source,
    coordinateRepair: {
      yawOffsetDegrees,
      reason: 'align-runpod-panorama-yaw-to-app-viewer',
    },
  };

  return repaired;
}
