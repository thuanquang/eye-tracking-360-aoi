import assert from 'node:assert/strict';
import test from 'node:test';

import {
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
