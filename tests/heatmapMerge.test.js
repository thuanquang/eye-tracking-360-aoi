import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getHeatmapCompatibilityKey,
  mergeCompatibleHeatmaps,
} from '../src/recording/heatmapMerge.js';

test('merges compatible screen heatmaps by row and column', () => {
  const merged = mergeCompatibleHeatmaps([
    {
      type: 'screen',
      columns: 2,
      rows: 2,
      width: 100,
      height: 80,
      dimensionSource: 'provided',
      trustedOnly: true,
      totalWeightSec: 0.3,
      bins: [
        { column: 1, row: 0, weightSec: 0.2, sampleCount: 1 },
        { column: 0, row: 0, weightSec: 0.1, sampleCount: 1 },
      ],
    },
    {
      type: 'screen',
      columns: 2,
      rows: 2,
      width: 100,
      height: 80,
      dimensionSource: 'provided',
      trustedOnly: true,
      totalWeightSec: 0.6,
      bins: [
        { column: 0, row: 0, weightSec: 0.2, sampleCount: 2 },
        { column: 1, row: 1, weightSec: 0.3, sampleCount: 3 },
        { column: 1, row: 0, weightSec: 0.1, sampleCount: 1 },
        { column: Number.NaN, row: 0, weightSec: 1, sampleCount: 10 },
      ],
    },
  ]);

  assert.deepEqual(merged, {
    type: 'screen',
    columns: 2,
    rows: 2,
    width: 100,
    height: 80,
    dimensionSource: 'provided',
    trustedOnly: true,
    sourceHeatmapCount: 2,
    totalWeightSec: 0.9,
    bins: [
      { column: 0, row: 0, weightSec: 0.3, sampleCount: 3 },
      { column: 1, row: 0, weightSec: 0.3, sampleCount: 2 },
      { column: 1, row: 1, weightSec: 0.3, sampleCount: 3 },
    ],
  });
});

test('merges panorama heatmaps and preserves angular ranges', () => {
  const yawRange = [-180, 180];
  const pitchRange = [-90, 90];
  const merged = mergeCompatibleHeatmaps([
    {
      type: 'panorama',
      columns: 4,
      rows: 2,
      yawRange,
      pitchRange,
      trustedOnly: false,
      totalWeightSec: 0.2,
      bins: [
        { column: 0, row: 0, weightSec: 0.125, sampleCount: 1 },
      ],
    },
    {
      type: 'panorama',
      columns: 4,
      rows: 2,
      yawRange: [-180, 180],
      pitchRange: [-90, 90],
      trustedOnly: false,
      totalWeightSec: 0.4,
      bins: [
        { column: 0, row: 0, weightSec: 0.125, sampleCount: 2 },
        { column: 3, row: 1, weightSec: 0.25, sampleCount: 1 },
      ],
    },
  ]);

  assert.deepEqual(merged, {
    type: 'panorama',
    columns: 4,
    rows: 2,
    yawRange: [-180, 180],
    pitchRange: [-90, 90],
    trustedOnly: false,
    sourceHeatmapCount: 2,
    totalWeightSec: 0.5,
    bins: [
      { column: 0, row: 0, weightSec: 0.25, sampleCount: 3 },
      { column: 3, row: 1, weightSec: 0.25, sampleCount: 1 },
    ],
  });

  assert.notEqual(merged.yawRange, yawRange);
  assert.notEqual(merged.pitchRange, pitchRange);
});

test('throws when heatmap grids are incompatible', () => {
  assert.throws(() => mergeCompatibleHeatmaps([
    {
      type: 'screen',
      columns: 2,
      rows: 2,
      width: 100,
      height: 80,
      bins: [],
    },
    {
      type: 'screen',
      columns: 2,
      rows: 2,
      width: 120,
      height: 80,
      bins: [],
    },
  ]), /Incompatible heatmap grids/);
});

test('throws when no heatmaps are provided', () => {
  assert.throws(
    () => mergeCompatibleHeatmaps([]),
    /No heatmaps to merge\./,
  );
});

test('rounds total weight from raw merged bin weights', () => {
  const merged = mergeCompatibleHeatmaps([
    {
      type: 'panorama',
      columns: 2,
      rows: 1,
      yawRange: [-180, 180],
      pitchRange: [-90, 90],
      bins: [
        { column: 0, row: 0, weightSec: 0.1114, sampleCount: 1 },
        { column: 1, row: 0, weightSec: 0.1114, sampleCount: 1 },
      ],
    },
  ]);

  assert.deepEqual(
    merged.bins.map((bin) => bin.weightSec),
    [0.111, 0.111],
  );
  assert.equal(merged.totalWeightSec, 0.223);
});

test('returns stable heatmap compatibility keys', () => {
  assert.equal(
    getHeatmapCompatibilityKey({
      type: 'screen',
      columns: 48,
      rows: 27,
      width: 1280,
      height: 720,
    }),
    'screen|48x27|1280x720',
  );

  assert.equal(
    getHeatmapCompatibilityKey({
      type: 'panorama',
      columns: 72,
      rows: 36,
      yawRange: [-180, 180],
      pitchRange: [-90, 90],
    }),
    'panorama|72x36|-180,180|-90,90',
  );
});
