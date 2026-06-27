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

test('ignores screen heatmap bins with null coordinates', () => {
  const points = buildMergedHeatmapOverlayPoints({
    heatmap: {
      type: 'screen',
      columns: 4,
      rows: 2,
      bins: [
        { column: null, row: 0, weightSec: 0.5, sampleCount: 1 },
        { column: 0, row: null, weightSec: 0.5, sampleCount: 1 },
      ],
    },
    dimensions: { width: 800, height: 400 },
  });

  assert.deepEqual(points, []);
});

test('ignores screen heatmap bins with empty-string coordinates', () => {
  const points = buildMergedHeatmapOverlayPoints({
    heatmap: {
      type: 'screen',
      columns: 4,
      rows: 2,
      bins: [
        { column: '', row: 0, weightSec: 0.5, sampleCount: 1 },
        { column: 0, row: '', weightSec: 0.5, sampleCount: 1 },
      ],
    },
    dimensions: { width: 800, height: 400 },
  });

  assert.deepEqual(points, []);
});

test('ignores screen heatmap bins with string coordinates', () => {
  const points = buildMergedHeatmapOverlayPoints({
    heatmap: {
      type: 'screen',
      columns: 4,
      rows: 2,
      bins: [
        { column: '0', row: 0, weightSec: 0.5, sampleCount: 1 },
        { column: 0, row: '0', weightSec: 0.5, sampleCount: 1 },
      ],
    },
    dimensions: { width: 800, height: 400 },
  });

  assert.deepEqual(points, []);
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

test('ignores panorama projections with null coordinates', () => {
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
    projectPanoramaPoint: () => ({ visible: true, x: null, y: null }),
  });

  assert.deepEqual(points, []);
});

test('ignores panorama projections with empty-string coordinates', () => {
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
    projectPanoramaPoint: () => ({ visible: true, x: '', y: '' }),
  });

  assert.deepEqual(points, []);
});

test('ignores panorama projections with string coordinates', () => {
  const projectedPoints = [
    { visible: true, x: '100', y: 80 },
    { visible: true, x: 100, y: '80' },
  ];
  const points = buildMergedHeatmapOverlayPoints({
    heatmap: {
      type: 'panorama',
      columns: 4,
      rows: 2,
      yawRange: [-180, 180],
      pitchRange: [-90, 90],
      bins: [
        { column: 0, row: 0, weightSec: 0.1, sampleCount: 1 },
        { column: 1, row: 0, weightSec: 0.1, sampleCount: 1 },
      ],
    },
    dimensions: { width: 800, height: 400 },
    projectPanoramaPoint: () => projectedPoints.shift(),
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

test('returns null for panorama bin centers with invalid bin coordinates', () => {
  const heatmap = {
    columns: 4,
    rows: 2,
    yawRange: [-180, 180],
    pitchRange: [-90, 90],
  };
  const invalidBins = [
    { column: null, row: 0 },
    { column: 0, row: null },
    { column: '', row: 0 },
    { column: 0, row: '' },
    { column: '0', row: 0 },
    { column: 0, row: '0' },
  ];

  assert.deepEqual(
    invalidBins.map((bin) => getHeatmapBinCenterYawPitch({ heatmap, bin })),
    [null, null, null, null, null, null],
  );
});
