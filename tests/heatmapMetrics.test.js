import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPanoramaHeatmap,
  buildScreenHeatmap,
} from '../src/recording/heatmapMetrics.js';

test('builds weighted screen heatmap bins from sample durations', () => {
  const heatmap = buildScreenHeatmap([
    {
      t: 0,
      screen: { x: 10, y: 10 },
      quality: { trustedForAoiAnalysis: true },
    },
    {
      t: 0.1,
      screen: { x: 30, y: 20 },
      quality: { trustedForAoiAnalysis: true },
    },
    {
      t: 0.3,
      screen: { x: 80, y: 60 },
      quality: { trustedForAoiAnalysis: false },
    },
    {
      t: 0.4,
      screen: { x: 99, y: 99 },
      quality: { trustedForAoiAnalysis: true },
    },
  ], {
    width: 100,
    height: 100,
    columns: 2,
    rows: 2,
    sampleIntervalMs: 100,
    trustedOnly: true,
  });

  assert.equal(heatmap.type, 'screen');
  assert.equal(heatmap.columns, 2);
  assert.equal(heatmap.rows, 2);
  assert.equal(heatmap.width, 100);
  assert.equal(heatmap.height, 100);
  assert.equal(heatmap.dimensionSource, 'provided');
  assert.equal(heatmap.trustedOnly, true);
  assert.equal(heatmap.totalWeightSec, 0.4);
  assert.deepEqual(heatmap.bins, [
    { column: 0, row: 0, weightSec: 0.3, sampleCount: 2 },
    { column: 1, row: 1, weightSec: 0.1, sampleCount: 1 },
  ]);
});

test('infers screen dimensions from trusted samples that contribute bins', () => {
  const heatmap = buildScreenHeatmap([
    {
      t: 0,
      screen: { x: 10, y: 10 },
      quality: { trustedForAoiAnalysis: true },
    },
    {
      t: 0.1,
      screen: { x: 20, y: 30 },
      quality: { trustedForAoiAnalysis: true },
    },
    {
      t: 0.2,
      screen: { x: 10000, y: 20000 },
      quality: { trustedForAoiAnalysis: false },
    },
  ], {
    columns: 2,
    rows: 2,
    sampleIntervalMs: 100,
    trustedOnly: true,
  });

  assert.equal(heatmap.dimensionSource, 'inferred');
  assert.equal(heatmap.width, 21);
  assert.equal(heatmap.height, 31);
  assert.equal(heatmap.totalWeightSec, 0.2);
  assert.deepEqual(heatmap.bins, [
    { column: 0, row: 0, weightSec: 0.1, sampleCount: 1 },
    { column: 1, row: 1, weightSec: 0.1, sampleCount: 1 },
  ]);
});

test('maps screen coordinate boundaries to deterministic edge bins', () => {
  const heatmap = buildScreenHeatmap([
    {
      t: 0,
      screen: { x: 0, y: 0 },
      quality: { trustedForAoiAnalysis: true },
    },
    {
      t: 0.1,
      screen: { x: 100, y: 50 },
      quality: { trustedForAoiAnalysis: true },
    },
  ], {
    width: 100,
    height: 50,
    columns: 2,
    rows: 2,
    sampleIntervalMs: 100,
  });

  assert.equal(heatmap.dimensionSource, 'provided');
  assert.deepEqual(heatmap.bins, [
    { column: 0, row: 0, weightSec: 0.1, sampleCount: 1 },
    { column: 1, row: 1, weightSec: 0.1, sampleCount: 1 },
  ]);
});

test('returns no screen bins with explicit dimension source for empty input', () => {
  const heatmap = buildScreenHeatmap([]);

  assert.equal(heatmap.dimensionSource, 'none');
  assert.equal(heatmap.width, null);
  assert.equal(heatmap.height, null);
  assert.equal(heatmap.totalWeightSec, 0);
  assert.deepEqual(heatmap.bins, []);
});

test('builds weighted panorama heatmap bins with yaw wrapping and pitch clamping', () => {
  const heatmap = buildPanoramaHeatmap([
    {
      t: 0,
      panorama: { yaw: -180, pitch: 90 },
      quality: { trustedForAoiAnalysis: true },
    },
    {
      t: 0.2,
      panorama: { yaw: 181, pitch: -100 },
      quality: { trustedForAoiAnalysis: false },
    },
    {
      t: 0.3,
      panorama: { yaw: 179, pitch: -90 },
      quality: { trustedForAoiAnalysis: true },
    },
  ], {
    columns: 4,
    rows: 3,
    sampleIntervalMs: 100,
    trustedOnly: true,
  });

  assert.equal(heatmap.type, 'panorama');
  assert.equal(heatmap.columns, 4);
  assert.equal(heatmap.rows, 3);
  assert.deepEqual(heatmap.yawRange, [-180, 180]);
  assert.deepEqual(heatmap.pitchRange, [-90, 90]);
  assert.equal(heatmap.trustedOnly, true);
  assert.equal(heatmap.totalWeightSec, 0.3);
  assert.deepEqual(heatmap.bins, [
    { column: 0, row: 0, weightSec: 0.2, sampleCount: 1 },
    { column: 3, row: 2, weightSec: 0.1, sampleCount: 1 },
  ]);
});

test('maps panorama yaw and pitch boundaries deterministically', () => {
  const heatmap = buildPanoramaHeatmap([
    {
      t: 0,
      panorama: { yaw: -180, pitch: 90 },
      quality: { trustedForAoiAnalysis: true },
    },
    {
      t: 0.1,
      panorama: { yaw: 180, pitch: -90 },
      quality: { trustedForAoiAnalysis: true },
    },
  ], {
    columns: 4,
    rows: 2,
    sampleIntervalMs: 100,
  });

  assert.deepEqual(heatmap.bins, [
    { column: 0, row: 0, weightSec: 0.1, sampleCount: 1 },
    { column: 0, row: 1, weightSec: 0.1, sampleCount: 1 },
  ]);
});
