import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildMergedHeatmapOverlayPoints,
  getHeatmapBinCenterYawPitch,
} from '../src/recording/heatmapOverlay.js';

test('maps screen heatmap bins to viewer pixel centers', () => {
  const points = buildMergedHeatmapOverlayPoints({
    heatmap: {
      type: 'screen',
      columns: 4,
      rows: 2,
      bins: [{ column: 1, row: 0, weightSec: 0.5, sampleCount: 4 }],
    },
    dimensions: { width: 800, height: 400 },
  });

  assert.deepEqual(points, [{
    x: 300,
    y: 100,
    weightMs: 500,
    intensity: 1,
    sampleCount: 4,
  }]);
});

test('maps panorama heatmap bin centers through the provided projector', () => {
  const centers = [];
  const points = buildMergedHeatmapOverlayPoints({
    heatmap: {
      type: 'panorama',
      columns: 4,
      rows: 2,
      yawRange: [-180, 180],
      pitchRange: [-90, 90],
      bins: [{ column: 2, row: 0, weightSec: 0.25, sampleCount: 3 }],
    },
    dimensions: { width: 800, height: 400 },
    projectPanoramaPoint: ({ yaw, pitch }) => {
      centers.push({ yaw, pitch });
      return { visible: true, x: 500, y: 80 };
    },
  });

  assert.deepEqual(centers, [{ yaw: 45, pitch: 45 }]);
  assert.deepEqual(points, [{
    x: 500,
    y: 80,
    weightMs: 250,
    intensity: 1,
    sampleCount: 3,
  }]);
});

test('filters invisible panorama heatmap bins', () => {
  const points = buildMergedHeatmapOverlayPoints({
    heatmap: {
      type: 'panorama',
      columns: 4,
      rows: 2,
      yawRange: [-180, 180],
      pitchRange: [-90, 90],
      bins: [{ column: 0, row: 0, weightSec: 0.1, sampleCount: 1 }],
    },
    dimensions: { width: 800, height: 400 },
    projectPanoramaPoint: () => ({ visible: false, x: 0, y: 0 }),
  });

  assert.deepEqual(points, []);
});

test('computes panorama bin center yaw and pitch', () => {
  assert.deepEqual(
    getHeatmapBinCenterYawPitch({
      heatmap: {
        columns: 4,
        rows: 2,
        yawRange: [-180, 180],
        pitchRange: [-90, 90],
      },
      bin: { column: 0, row: 1 },
    }),
    { yaw: -135, pitch: -45 },
  );
});
