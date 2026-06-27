import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAX_HEATMAP_RENDER_AREA,
  MAX_HEATMAP_RENDER_DIMENSION,
  getHeatmapRenderDimensions,
  normalizeHeatmapBins,
} from '../src/recording/heatmapRender.js';

test('panorama heatmap renders at a 72 by 36 grid aspect', () => {
  assert.deepEqual(
    getHeatmapRenderDimensions({
      type: 'panorama',
      columns: 72,
      rows: 36,
    }),
    { width: 1440, height: 720 },
  );
});

test('wide screen heatmap scales down to 1280 pixels wide', () => {
  assert.deepEqual(
    getHeatmapRenderDimensions({
      type: 'screen',
      width: 1920,
      height: 1080,
    }),
    { width: 1280, height: 720 },
  );
});

test('smaller screen heatmap keeps its source dimensions', () => {
  assert.deepEqual(
    getHeatmapRenderDimensions({
      type: 'screen',
      width: 640,
      height: 360,
    }),
    { width: 640, height: 360 },
  );
});

test('very tall screen heatmap render dimensions are bounded', () => {
  const dimensions = getHeatmapRenderDimensions({
    type: 'screen',
    width: 100,
    height: 100000,
  });

  assert.ok(dimensions.height <= MAX_HEATMAP_RENDER_DIMENSION);
  assert.ok(dimensions.width * dimensions.height <= MAX_HEATMAP_RENDER_AREA);
  assert.ok(dimensions.width >= 1);
  assert.ok(dimensions.width < 100);
  assert.ok(dimensions.height > dimensions.width);
});

test('very tall panorama heatmap render dimensions are bounded', () => {
  const dimensions = getHeatmapRenderDimensions({
    type: 'panorama',
    columns: 1,
    rows: 100000,
  });

  assert.ok(dimensions.height <= MAX_HEATMAP_RENDER_DIMENSION);
  assert.ok(dimensions.width * dimensions.height <= MAX_HEATMAP_RENDER_AREA);
  assert.ok(dimensions.width >= 1);
  assert.ok(dimensions.width < 1440);
  assert.ok(dimensions.height > dimensions.width);
});

test('normalizes heatmap bin intensity from the maximum weight', () => {
  assert.deepEqual(
    normalizeHeatmapBins({
      bins: [
        { column: 0, row: 0, weightSec: 0.25 },
        { column: 1, row: 0, weightSec: 0.5 },
        { column: 2, row: 0, weightSec: 1 },
      ],
    }),
    [
      { column: 0, row: 0, weightSec: 0.25, intensity: 0.25 },
      { column: 1, row: 0, weightSec: 0.5, intensity: 0.5 },
      { column: 2, row: 0, weightSec: 1, intensity: 1 },
    ],
  );
});

test('normalizes empty heatmap bins without throwing', () => {
  assert.deepEqual(normalizeHeatmapBins({ bins: [] }), []);
  assert.deepEqual(normalizeHeatmapBins({}), []);
});
