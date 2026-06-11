const VALID_VIDEO_PROJECTIONS = new Set(['equirectangular', 'flat']);
const VALID_STEREO_LAYOUT_CONTROLS = new Set(['mono', 'side-by-side', 'top-bottom']);

export function normalizeVideoProjection(value) {
  return value === 'flat' ? 'flat' : 'equirectangular';
}

export function normalizeStereoLayout(value) {
  return value === 'top-bottom' ? 'top-bottom' : 'mono';
}

export function getCurrentProjection({ controlValue, metadataProjection } = {}) {
  return VALID_VIDEO_PROJECTIONS.has(controlValue)
    ? controlValue
    : normalizeVideoProjection(metadataProjection);
}

export function getCurrentStereoLayout({ controlValue, metadataStereoLayout } = {}) {
  return VALID_STEREO_LAYOUT_CONTROLS.has(controlValue)
    ? controlValue
    : normalizeStereoLayout(metadataStereoLayout);
}
