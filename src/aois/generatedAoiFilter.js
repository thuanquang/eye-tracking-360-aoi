const GENERATED_SCENE_BACKGROUND_LABELS = new Set([
  'background',
  'ceiling',
  'cloud',
  'floor',
  'grass',
  'ground',
  'mountain',
  'pavement',
  'plaza',
  'river',
  'road',
  'sidewalk',
  'sky',
  'street',
  'terrain',
  'wall',
  'water',
]);

export function normalizeGeneratedAoiLabel(label) {
  return String(label || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

export function isGeneratedAoi(aoi) {
  return typeof aoi?.metadata?.generatedBy === 'string'
    && aoi.metadata.generatedBy.trim().length > 0;
}

export function isDedicatedSceneSurfaceAoi(aoi) {
  return aoi?.metadata?.sceneSurface === true
    || aoi?.metadata?.generatedBy === 'runpod-scene-surface-aoi';
}

export function isGeneratedSceneBackgroundAoi(aoi) {
  return isGeneratedAoi(aoi)
    && !isDedicatedSceneSurfaceAoi(aoi)
    && GENERATED_SCENE_BACKGROUND_LABELS.has(normalizeGeneratedAoiLabel(aoi.label));
}

export function filterGeneratedSceneBackgroundAois(aois) {
  return (aois || []).filter((aoi) => !isGeneratedSceneBackgroundAoi(aoi));
}
