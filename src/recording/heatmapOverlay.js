import { normalizeHeatmapBins } from './heatmapRender.js';

function toFiniteNumber(value) {
  if (
    value === null ||
    value === undefined ||
    (typeof value === 'string' && value.trim() === '') ||
    (typeof value !== 'number' && typeof value !== 'string')
  ) {
    return null;
  }

  const number = Number(value);

  return Number.isFinite(number) ? number : null;
}

function isPositiveNumber(value) {
  const number = Number(value);

  return Number.isFinite(number) && number > 0;
}

function getViewerDimensions(dimensions) {
  const width = toFiniteNumber(dimensions?.width);
  const height = toFiniteNumber(dimensions?.height);

  if (!isPositiveNumber(width) || !isPositiveNumber(height)) {
    return null;
  }

  return { width, height };
}

function getGrid(heatmap) {
  const columns = toFiniteNumber(heatmap?.columns);
  const rows = toFiniteNumber(heatmap?.rows);

  if (!Number.isInteger(columns) || !Number.isInteger(rows) || columns <= 0 || rows <= 0) {
    return null;
  }

  return { columns, rows };
}

function getBinCoordinate(bin, grid) {
  const column = toFiniteNumber(bin?.column);
  const row = toFiniteNumber(bin?.row);

  if (
    !Number.isInteger(column) ||
    !Number.isInteger(row) ||
    column < 0 ||
    row < 0 ||
    column >= grid.columns ||
    row >= grid.rows
  ) {
    return null;
  }

  return { column, row };
}

function pointInBounds(point, dimensions) {
  return (
    Number.isFinite(point?.x) &&
    Number.isFinite(point?.y) &&
    point.x >= 0 &&
    point.y >= 0 &&
    point.x <= dimensions.width &&
    point.y <= dimensions.height
  );
}

function getSampleCount(bin) {
  const sampleCount = Number(bin?.sampleCount);

  return Number.isFinite(sampleCount) ? sampleCount : 0;
}

function buildOverlayPoint(point, bin, weightSec) {
  return {
    x: point.x,
    y: point.y,
    weightMs: weightSec * 1000,
    intensity: Number(bin.intensity) || 0,
    sampleCount: getSampleCount(bin),
  };
}

function getScreenBinPoint({ heatmap, bin, dimensions }) {
  const grid = getGrid(heatmap);

  if (!grid) {
    return null;
  }

  const coordinate = getBinCoordinate(bin, grid);

  if (!coordinate) {
    return null;
  }

  return {
    x: ((coordinate.column + 0.5) / grid.columns) * dimensions.width,
    y: ((coordinate.row + 0.5) / grid.rows) * dimensions.height,
  };
}

function getPanoramaBinPoint({ heatmap, bin, projectPanoramaPoint }) {
  if (typeof projectPanoramaPoint !== 'function') {
    return null;
  }

  const grid = getGrid(heatmap);

  if (!grid || !getBinCoordinate(bin, grid)) {
    return null;
  }

  const center = getHeatmapBinCenterYawPitch({ heatmap, bin });

  if (!Number.isFinite(center.yaw) || !Number.isFinite(center.pitch)) {
    return null;
  }

  const projected = projectPanoramaPoint(center);

  if (projected?.visible !== true) {
    return null;
  }

  const x = toFiniteNumber(projected.x);
  const y = toFiniteNumber(projected.y);

  return x === null || y === null ? null : { x, y };
}

export function getHeatmapBinCenterYawPitch({ heatmap, bin }) {
  const columns = Number(heatmap?.columns);
  const rows = Number(heatmap?.rows);
  const column = Number(bin?.column);
  const row = Number(bin?.row);
  const yawMin = Number(heatmap?.yawRange?.[0]);
  const yawMax = Number(heatmap?.yawRange?.[1]);
  const pitchMin = Number(heatmap?.pitchRange?.[0]);
  const pitchMax = Number(heatmap?.pitchRange?.[1]);

  return {
    yaw: yawMin + ((column + 0.5) / columns) * (yawMax - yawMin),
    pitch: pitchMax - ((row + 0.5) / rows) * (pitchMax - pitchMin),
  };
}

export function buildMergedHeatmapOverlayPoints({
  heatmap,
  dimensions,
  projectPanoramaPoint = null,
} = {}) {
  const viewerDimensions = getViewerDimensions(dimensions);

  if (!viewerDimensions) {
    return [];
  }

  return normalizeHeatmapBins(heatmap).reduce((points, bin) => {
    const weightSec = Number(bin?.weightSec);

    if (!isPositiveNumber(weightSec)) {
      return points;
    }

    let point = null;

    if (heatmap?.type === 'screen') {
      point = getScreenBinPoint({ heatmap, bin, dimensions: viewerDimensions });
    } else if (heatmap?.type === 'panorama') {
      point = getPanoramaBinPoint({ heatmap, bin, projectPanoramaPoint });
    }

    if (!point || !pointInBounds(point, viewerDimensions)) {
      return points;
    }

    points.push(buildOverlayPoint(point, bin, weightSec));

    return points;
  }, []);
}
