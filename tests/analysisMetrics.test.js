import test from 'node:test';
import assert from 'node:assert/strict';

import { buildNamedAoiMetrics } from '../src/analysisMetrics.js';

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

test('returns empty named metrics for recordings without samples', () => {
  const metrics = buildNamedAoiMetrics([], [{ id: 'front', label: 'Front' }]);

  assert.equal(metrics.session.totalSamples, 0);
  assert.equal(metrics.perAoi.front.label, 'Front');
  assert.equal(metrics.perAoi.front.hitCount, 0);
  assert.equal(metrics.perAoi.front.timeToFirstFixationMs, null);
});
