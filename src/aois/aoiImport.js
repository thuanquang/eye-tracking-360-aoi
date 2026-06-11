import { AOI_SPACES } from './aoiSchema.js';

export function isFiniteNumber(value) {
  return Number.isFinite(Number(value));
}

export function getAoiSpace(aoi) {
  return aoi?.space === AOI_SPACES.video ? AOI_SPACES.video : AOI_SPACES.panorama;
}

export function isValidVideoAoiBounds(aoi) {
  return (
    isFiniteNumber(aoi.xMin) &&
    isFiniteNumber(aoi.xMax) &&
    isFiniteNumber(aoi.yMin) &&
    isFiniteNumber(aoi.yMax)
  );
}

export function isValidPanoramaAoiBounds(aoi) {
  return (
    isFiniteNumber(aoi.yawMin) &&
    isFiniteNumber(aoi.yawMax) &&
    isFiniteNumber(aoi.pitchMin) &&
    isFiniteNumber(aoi.pitchMax)
  );
}

export function isValidAoiBounds(aoi, space = getAoiSpace(aoi)) {
  return space === AOI_SPACES.video
    ? isValidVideoAoiBounds(aoi)
    : isValidPanoramaAoiBounds(aoi);
}

export function isValidAoiKeyframes(aoi) {
  if (!Array.isArray(aoi.keyframes)) {
    return true;
  }

  const space = getAoiSpace(aoi);

  return (
    aoi.keyframes.length > 0 &&
    aoi.keyframes.every((keyframe) => (
      isFiniteNumber(keyframe.t) &&
      isValidAoiBounds(keyframe, space)
    ))
  );
}

export function isValidAoi(aoi) {
  return (
    typeof aoi?.id === 'string' &&
    typeof aoi?.label === 'string' &&
    typeof aoi?.color === 'string' &&
    isValidAoiBounds(aoi) &&
    isValidAoiKeyframes(aoi)
  );
}

export function extractProjectMetadataFromJson(json) {
  if (!json || Array.isArray(json) || typeof json !== 'object') {
    return {};
  }

  return {
    video: json.video && typeof json.video === 'object' ? { ...json.video } : null,
  };
}

export function extractAoisFromJson(json) {
  if (Array.isArray(json)) {
    return json;
  }

  if (Array.isArray(json?.aois)) {
    return json.aois;
  }

  throw new Error('AOI JSON must be an array or an object with an aois array.');
}
