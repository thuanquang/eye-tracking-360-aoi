const MAX_SCREEN_RENDER_WIDTH = 1280;
const PANORAMA_RENDER_WIDTH = 1440;
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

export function getHeatmapRenderDimensions(heatmap) {
  const width = Number(heatmap?.width);
  const height = Number(heatmap?.height);

  if (heatmap?.type === 'screen' && isPositiveFiniteNumber(width) && isPositiveFiniteNumber(height)) {
    if (width <= MAX_SCREEN_RENDER_WIDTH) {
      return {
        width: roundPixel(width),
        height: roundPixel(height),
      };
    }

    return {
      width: MAX_SCREEN_RENDER_WIDTH,
      height: roundPixel((MAX_SCREEN_RENDER_WIDTH * height) / width),
    };
  }

  const columns = isPositiveFiniteNumber(Number(heatmap?.columns))
    ? Number(heatmap.columns)
    : DEFAULT_GRID_COLUMNS;
  const rows = isPositiveFiniteNumber(Number(heatmap?.rows))
    ? Number(heatmap.rows)
    : DEFAULT_GRID_ROWS;

  return {
    width: PANORAMA_RENDER_WIDTH,
    height: roundPixel((PANORAMA_RENDER_WIDTH * rows) / columns),
  };
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
