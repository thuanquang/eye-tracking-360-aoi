const VALID_VIDEO_PROJECTIONS = new Set(['equirectangular', 'flat']);
const VALID_STEREO_LAYOUT_CONTROLS = new Set(['mono', 'side-by-side', 'top-bottom']);

function round(value) {
  return Number(value.toFixed(6));
}

export function normalizeVideoProjection(value) {
  return value === 'flat' ? 'flat' : 'equirectangular';
}

export function normalizeStereoLayout(value) {
  if (value === 'top-bottom' || value === 'side-by-side') {
    return value;
  }

  return 'mono';
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

export function getContainedMediaRect({
  containerWidth,
  containerHeight,
  mediaWidth,
  mediaHeight,
}) {
  const safeContainerWidth = Number(containerWidth);
  const safeContainerHeight = Number(containerHeight);
  const safeMediaWidth = Number(mediaWidth);
  const safeMediaHeight = Number(mediaHeight);

  if (
    safeContainerWidth <= 0 ||
    safeContainerHeight <= 0 ||
    safeMediaWidth <= 0 ||
    safeMediaHeight <= 0
  ) {
    return {
      x: 0,
      y: 0,
      width: Math.max(0, safeContainerWidth) || 0,
      height: Math.max(0, safeContainerHeight) || 0,
    };
  }

  const containerRatio = safeContainerWidth / safeContainerHeight;
  const mediaRatio = safeMediaWidth / safeMediaHeight;
  const width = mediaRatio > containerRatio
    ? safeContainerWidth
    : safeContainerHeight * mediaRatio;
  const height = mediaRatio > containerRatio
    ? safeContainerWidth / mediaRatio
    : safeContainerHeight;

  return {
    x: round((safeContainerWidth - width) / 2),
    y: round((safeContainerHeight - height) / 2),
    width: round(width),
    height: round(height),
  };
}

export function getStereoTextureTransform(stereoLayout = 'mono', eye = 'left') {
  if (stereoLayout === 'top-bottom') {
    if (['top-left', 'top-right', 'bottom-left', 'bottom-right'].includes(eye)) {
      return {
        offsetX: eye.endsWith('right') ? 0.5 : 0,
        offsetY: eye.startsWith('bottom') ? 0 : 0.5,
        repeatX: 0.5,
        repeatY: 0.5,
      };
    }

    return {
      offsetX: 0,
      offsetY: eye === 'right' ? 0 : 0.5,
      repeatX: 1,
      repeatY: 0.5,
    };
  }

  if (stereoLayout === 'side-by-side') {
    return {
      offsetX: eye === 'right' ? 0.5 : 0,
      offsetY: 0,
      repeatX: 0.5,
      repeatY: 1,
    };
  }

  return {
    offsetX: 0,
    offsetY: 0,
    repeatX: 1,
    repeatY: 1,
  };
}

export function getProjectionTextureTransform({
  projection = 'equirectangular',
  stereoLayout = 'mono',
  eye = 'left',
} = {}) {
  return getStereoTextureTransform(
    projection === 'flat' ? normalizeStereoLayout(stereoLayout) : stereoLayout,
    eye,
  );
}
