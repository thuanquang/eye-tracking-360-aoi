const MAX_SCREEN_RENDER_WIDTH = 1280;
const PANORAMA_RENDER_WIDTH = 1440;
export const MAX_HEATMAP_RENDER_DIMENSION = 4096;
export const MAX_HEATMAP_RENDER_AREA = MAX_HEATMAP_RENDER_DIMENSION * MAX_HEATMAP_RENDER_DIMENSION;
const DEFAULT_GRID_COLUMNS = 72;
const DEFAULT_GRID_ROWS = 36;

function isPositiveFiniteNumber(value) {
  return Number.isFinite(value) && value > 0;
}

function roundPixel(value) {
  return Math.max(1, Math.round(value));
}

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

function roundIntensity(value) {
  return Math.round(clamp01(value) * 1000) / 1000;
}

function boundRenderDimensions(width, height) {
  let scale = 1;
  const maxDimension = Math.max(width, height);
  const area = width * height;

  if (maxDimension > MAX_HEATMAP_RENDER_DIMENSION) {
    scale = Math.min(scale, MAX_HEATMAP_RENDER_DIMENSION / maxDimension);
  }

  if (area > MAX_HEATMAP_RENDER_AREA) {
    scale = Math.min(scale, Math.sqrt(MAX_HEATMAP_RENDER_AREA / area));
  }

  return {
    width: Math.min(MAX_HEATMAP_RENDER_DIMENSION, roundPixel(width * scale)),
    height: Math.min(MAX_HEATMAP_RENDER_DIMENSION, roundPixel(height * scale)),
  };
}

export function getHeatmapRenderDimensions(heatmap) {
  const width = Number(heatmap?.width);
  const height = Number(heatmap?.height);

  if (heatmap?.type === 'screen' && isPositiveFiniteNumber(width) && isPositiveFiniteNumber(height)) {
    if (width <= MAX_SCREEN_RENDER_WIDTH) {
      return boundRenderDimensions(width, height);
    }

    return boundRenderDimensions(MAX_SCREEN_RENDER_WIDTH, (MAX_SCREEN_RENDER_WIDTH * height) / width);
  }

  const columns = isPositiveFiniteNumber(Number(heatmap?.columns))
    ? Number(heatmap.columns)
    : DEFAULT_GRID_COLUMNS;
  const rows = isPositiveFiniteNumber(Number(heatmap?.rows))
    ? Number(heatmap.rows)
    : DEFAULT_GRID_ROWS;

  return boundRenderDimensions(PANORAMA_RENDER_WIDTH, (PANORAMA_RENDER_WIDTH * rows) / columns);
}

export function normalizeHeatmapBins(heatmap) {
  const bins = Array.isArray(heatmap?.bins) ? heatmap.bins : [];
  const maxWeight = bins.reduce((max, bin) => {
    const weight = Number(bin?.weightSec);

    return isPositiveFiniteNumber(weight) ? Math.max(max, weight) : max;
  }, 0);

  return bins.map((bin) => {
    const weight = Number(bin?.weightSec);
    const intensity = maxWeight > 0 && Number.isFinite(weight)
      ? roundIntensity(weight / maxWeight)
      : 0;

    return {
      ...bin,
      intensity,
    };
  });
}
