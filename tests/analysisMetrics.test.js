import test from 'node:test';
import assert from 'node:assert/strict';

import { buildNamedAoiMetrics } from '../src/recording/analysisMetrics.js';

test('builds named per-AOI dwell and fixation metrics', () => {
  const aois = [
    { id: 'logo', label: 'Logo' },
    { id: 'product', label: 'Product' },
  ];
  const samples = [
    { t: 0, hits: ['logo'], likelyHits: ['logo'], possibleHits: [], ambiguousHits: [], activeAois: aois },
    { t: 0.15, hits: ['logo'], likelyHits: ['logo'], possibleHits: [], ambiguousHits: [], activeAois: aois },
    { t: 0.3, hits: ['product'], likelyHits: ['product'], possibleHits: [], ambiguousHits: [], activeAois: aois },
    { t: 0.45, hits: [], likelyHits: [], possibleHits: ['product'], ambiguousHits: ['product'], activeAois: aois },
  ];
  const metrics = buildNamedAoiMetrics(samples, aois);

  assert.equal(metrics.perAoi.logo.label, 'Logo');
  assert.equal(metrics.perAoi.logo.hitCount, 2);
  assert.equal(metrics.perAoi.logo.fixationCount >= 1, true);
  assert.equal(metrics.perAoi.product.possibleSampleCount, 1);
  assert.equal(metrics.perAoi.product.ambiguousSampleCount, 1);
  assert.equal(typeof metrics.perAoi.logo.totalDwellSec, 'number');
  assert.equal(typeof metrics.perAoi.logo.timeToFirstFixationMs, 'number');
  assert.equal(typeof metrics.session.averageFixationDurationMs, 'number');
  assert.equal(metrics.session.averageNumberOfAoisFixated > 0, true);
});

test('uses screen-coordinate dispersion fixations for AOI fixation metrics', () => {
  const aois = [
    { id: 'logo', label: 'Logo' },
    { id: 'product', label: 'Product' },
  ];
  const samples = [
    { t: 0.00, screen: { x: 100, y: 100 }, hits: ['logo'], likelyHits: ['logo'], possibleHits: [], ambiguousHits: [], activeAois: aois },
    { t: 0.05, screen: { x: 103, y: 98 }, hits: ['logo'], likelyHits: ['logo'], possibleHits: [], ambiguousHits: [], activeAois: aois },
    { t: 0.10, screen: { x: 101, y: 102 }, hits: ['logo'], likelyHits: ['logo'], possibleHits: [], ambiguousHits: [], activeAois: aois },
    { t: 0.15, screen: { x: 105, y: 99 }, hits: ['logo'], likelyHits: ['logo'], possibleHits: [], ambiguousHits: [], activeAois: aois },
    { t: 0.20, screen: { x: 400, y: 300 }, hits: ['product'], likelyHits: ['product'], possibleHits: [], ambiguousHits: [], activeAois: aois },
  ];
  const metrics = buildNamedAoiMetrics(samples, aois);

  assert.equal(metrics.perAoi.logo.fixationCount, 1);
  assert.equal(metrics.perAoi.logo.totalFixationDurationMs, 150);
  assert.equal(metrics.perAoi.product.fixationCount, 0);
  assert.equal(metrics.session.totalFixations, 1);
  assert.equal(metrics.session.averageFixationDurationMs, 150);
});

test('falls back to AOI streak fixation approximation without screen samples', () => {
  const aois = [{ id: 'front', label: 'Front' }];
  const samples = [
    { t: 0.00, hits: ['front'], likelyHits: ['front'], possibleHits: [], ambiguousHits: [], activeAois: aois },
    { t: 0.05, hits: ['front'], likelyHits: ['front'], possibleHits: [], ambiguousHits: [], activeAois: aois },
    { t: 0.10, hits: [], likelyHits: [], possibleHits: [], ambiguousHits: [], activeAois: aois },
  ];
  const metrics = buildNamedAoiMetrics(samples, aois);

  assert.equal(metrics.perAoi.front.fixationCount, 1);
  assert.equal(metrics.perAoi.front.totalFixationDurationMs, 100);
  assert.equal(metrics.session.totalFixations, 1);
});

test('returns empty named metrics for recordings without samples', () => {
  const metrics = buildNamedAoiMetrics([], [{ id: 'front', label: 'Front' }]);

  assert.equal(metrics.session.totalSamples, 0);
  assert.equal(metrics.perAoi.front.label, 'Front');
  assert.equal(metrics.perAoi.front.hitCount, 0);
  assert.equal(metrics.perAoi.front.timeToFirstFixationMs, null);
});

test('uses the recording cadence for single-sample metric duration fallback', () => {
  const metrics = buildNamedAoiMetrics([
    { t: 0, hits: ['front'], likelyHits: ['front'], possibleHits: [], ambiguousHits: [] },
  ], [{ id: 'front', label: 'Front' }]);

  assert.equal(metrics.session.totalDurationSec, Number(((1000 / 30) / 1000).toFixed(3)));
});
