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
  assert.equal(metrics.perAoi.logo.totalFixationDurationMs, 200);
  assert.equal(metrics.perAoi.product.fixationCount, 0);
  assert.equal(metrics.session.totalFixations, 1);
  assert.equal(metrics.session.averageFixationDurationMs, 200);
});

test('reports first fixation duration and revisit count per AOI', () => {
  const aois = [
    { id: 'logo', label: 'Logo' },
    { id: 'product', label: 'Product' },
  ];
  const samples = [
    { t: 0.00, screen: { x: 100, y: 100 }, hits: ['logo'], likelyHits: ['logo'], possibleHits: [], ambiguousHits: [], activeAois: aois },
    { t: 0.05, screen: { x: 102, y: 101 }, hits: ['logo'], likelyHits: ['logo'], possibleHits: [], ambiguousHits: [], activeAois: aois },
    { t: 0.10, screen: { x: 400, y: 300 }, hits: ['product'], likelyHits: ['product'], possibleHits: [], ambiguousHits: [], activeAois: aois },
    { t: 0.15, screen: { x: 402, y: 302 }, hits: ['product'], likelyHits: ['product'], possibleHits: [], ambiguousHits: [], activeAois: aois },
    { t: 0.20, screen: { x: 104, y: 100 }, hits: ['logo'], likelyHits: ['logo'], possibleHits: [], ambiguousHits: [], activeAois: aois },
    { t: 0.25, screen: { x: 103, y: 99 }, hits: ['logo'], likelyHits: ['logo'], possibleHits: [], ambiguousHits: [], activeAois: aois },
  ];

  const metrics = buildNamedAoiMetrics(samples, aois);

  assert.equal(metrics.perAoi.logo.fixationCount, 2);
  assert.equal(metrics.perAoi.logo.firstFixationDurationMs, 100);
  assert.equal(metrics.perAoi.logo.revisitCount, 1);
  assert.equal(metrics.perAoi.product.firstFixationDurationMs, 100);
  assert.equal(Array.isArray(metrics.fixations), true);
  assert.equal(metrics.fixations.length, 3);
  assert.deepEqual(metrics.fixations[0], {
    aoiId: 'logo',
    startSec: 0,
    endSec: 0.1,
    durationMs: 100,
    sampleCount: 2,
    centroid: { x: 101, y: 100.5 },
  });
  assert.equal(Object.hasOwn(metrics.fixations[0], 'dispersionPx'), false);
});

test('reports experimental saccade durations between fixation windows', () => {
  const aois = [
    { id: 'left', label: 'Left' },
    { id: 'right', label: 'Right' },
  ];
  const samples = [
    { t: 0.00, screen: { x: 100, y: 100 }, hits: ['left'], likelyHits: ['left'], possibleHits: [], ambiguousHits: [], activeAois: aois },
    { t: 0.05, screen: { x: 102, y: 100 }, hits: ['left'], likelyHits: ['left'], possibleHits: [], ambiguousHits: [], activeAois: aois },
    { t: 0.20, screen: { x: 500, y: 300 }, hits: ['right'], likelyHits: ['right'], possibleHits: [], ambiguousHits: [], activeAois: aois },
    { t: 0.25, screen: { x: 502, y: 301 }, hits: ['right'], likelyHits: ['right'], possibleHits: [], ambiguousHits: [], activeAois: aois },
  ];

  const metrics = buildNamedAoiMetrics(samples, aois);

  assert.equal(metrics.session.saccadeCount, 1);
  assert.equal(metrics.session.averageSaccadeDurationMs, 100);
  assert.deepEqual(metrics.transitions, [{
    fromAoiId: 'left',
    toAoiId: 'right',
    startSec: 0.1,
    endSec: 0.2,
    durationMs: 100,
  }]);
  assert.equal(metrics.perAoi.left.totalFixationDurationMs, 200);
  assert.equal(metrics.fixations[0].endSec, 0.2);
  assert.equal(metrics.fixations[0].durationMs, 200);
});

test('does not count a revisit when an AOI repeats after an unmapped gap', () => {
  const aois = [{ id: 'logo', label: 'Logo' }];
  const samples = [
    { t: 0.00, hits: ['logo'], likelyHits: ['logo'], possibleHits: [], ambiguousHits: [], activeAois: aois },
    { t: 0.05, hits: ['logo'], likelyHits: ['logo'], possibleHits: [], ambiguousHits: [], activeAois: aois },
    { t: 0.10, hits: [], likelyHits: [], possibleHits: [], ambiguousHits: [], activeAois: aois },
    { t: 0.20, hits: ['logo'], likelyHits: ['logo'], possibleHits: [], ambiguousHits: [], activeAois: aois },
    { t: 0.25, hits: ['logo'], likelyHits: ['logo'], possibleHits: [], ambiguousHits: [], activeAois: aois },
  ];

  const metrics = buildNamedAoiMetrics(samples, aois);

  assert.equal(metrics.perAoi.logo.fixationCount, 2);
  assert.equal(metrics.perAoi.logo.revisitCount, 0);
  assert.equal(metrics.session.saccadeCount, 0);
  assert.equal(metrics.session.averageSaccadeDurationMs, null);
  assert.deepEqual(metrics.transitions, []);
});

test('counts a revisit when an AOI repeats after another AOI fixation', () => {
  const aois = [
    { id: 'logo', label: 'Logo' },
    { id: 'product', label: 'Product' },
  ];
  const samples = [
    { t: 0.00, hits: ['logo'], likelyHits: ['logo'], possibleHits: [], ambiguousHits: [], activeAois: aois },
    { t: 0.05, hits: ['logo'], likelyHits: ['logo'], possibleHits: [], ambiguousHits: [], activeAois: aois },
    { t: 0.10, hits: ['product'], likelyHits: ['product'], possibleHits: [], ambiguousHits: [], activeAois: aois },
    { t: 0.15, hits: ['product'], likelyHits: ['product'], possibleHits: [], ambiguousHits: [], activeAois: aois },
    { t: 0.20, hits: ['logo'], likelyHits: ['logo'], possibleHits: [], ambiguousHits: [], activeAois: aois },
    { t: 0.25, hits: ['logo'], likelyHits: ['logo'], possibleHits: [], ambiguousHits: [], activeAois: aois },
  ];

  const metrics = buildNamedAoiMetrics(samples, aois);

  assert.equal(metrics.perAoi.logo.fixationCount, 2);
  assert.equal(metrics.perAoi.logo.revisitCount, 1);
});

test('counts final screen sample duration toward fixation threshold', () => {
  const aois = [{ id: 'front', label: 'Front' }];
  const samples = [
    { t: 0.00, screen: { x: 100, y: 100 }, hits: ['front'], likelyHits: ['front'], possibleHits: [], ambiguousHits: [], activeAois: aois },
    { t: 0.05, screen: { x: 102, y: 99 }, hits: ['front'], likelyHits: ['front'], possibleHits: [], ambiguousHits: [], activeAois: aois },
  ];
  const metrics = buildNamedAoiMetrics(samples, aois);

  assert.equal(metrics.session.totalDurationSec, 0.1);
  assert.equal(metrics.perAoi.front.fixationCount, 1);
  assert.equal(metrics.perAoi.front.totalFixationDurationMs, 100);
  assert.equal(metrics.session.totalFixations, 1);
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

test('falls back to AOI streak fixations when sparse screen data is unmapped', () => {
  const aois = [{ id: 'front', label: 'Front' }];
  const samples = [
    { t: 0.00, screen: { x: 10, y: 10 }, hits: [], likelyHits: [], possibleHits: [], ambiguousHits: [], activeAois: aois },
    { t: 0.05, hits: ['front'], likelyHits: ['front'], possibleHits: [], ambiguousHits: [], activeAois: aois },
    { t: 0.10, hits: ['front'], likelyHits: ['front'], possibleHits: [], ambiguousHits: [], activeAois: aois },
    { t: 0.15, hits: [], likelyHits: [], possibleHits: [], ambiguousHits: [], activeAois: aois },
  ];
  const metrics = buildNamedAoiMetrics(samples, aois);

  assert.equal(metrics.perAoi.front.fixationCount, 1);
  assert.equal(metrics.perAoi.front.totalFixationDurationMs, 100);
  assert.equal(metrics.session.totalFixations, 1);
});

test('preserves AOI-only fixation streaks after screen-derived fixations', () => {
  const aois = [
    { id: 'panel', label: 'Panel' },
    { id: 'cta', label: 'CTA' },
  ];
  const samples = [
    { t: 0.00, screen: { x: 100, y: 100 }, hits: ['panel'], likelyHits: ['panel'], possibleHits: [], ambiguousHits: [], activeAois: aois },
    { t: 0.05, screen: { x: 102, y: 99 }, hits: ['panel'], likelyHits: ['panel'], possibleHits: [], ambiguousHits: [], activeAois: aois },
    { t: 0.10, hits: [], likelyHits: [], possibleHits: [], ambiguousHits: [], activeAois: aois },
    { t: 0.20, hits: ['cta'], likelyHits: ['cta'], possibleHits: [], ambiguousHits: [], activeAois: aois },
    { t: 0.25, hits: ['cta'], likelyHits: ['cta'], possibleHits: [], ambiguousHits: [], activeAois: aois },
    { t: 0.30, hits: [], likelyHits: [], possibleHits: [], ambiguousHits: [], activeAois: aois },
  ];
  const metrics = buildNamedAoiMetrics(samples, aois);

  assert.equal(metrics.perAoi.panel.fixationCount, 1);
  assert.equal(metrics.perAoi.panel.totalFixationDurationMs, 100);
  assert.equal(metrics.perAoi.cta.fixationCount, 1);
  assert.equal(metrics.perAoi.cta.totalFixationDurationMs, 100);
  assert.equal(metrics.session.totalFixations, 2);
  assert.equal(metrics.session.averageFixationDurationMs, 100);
});

test('builds ID-based metrics for polygon AOIs', () => {
  const polygonAoi = {
    id: 'screen-polygon',
    label: 'Screen polygon',
    color: '#ffd166',
    space: 'video',
    shape: 'polygon',
    points: [
      { x: 0.2, y: 0.2 },
      { x: 0.6, y: 0.2 },
      { x: 0.6, y: 0.6 },
      { x: 0.2, y: 0.6 },
    ],
  };
  const samples = [
    {
      t: 0,
      hits: ['screen-polygon'],
      likelyHits: ['screen-polygon'],
      possibleHits: [],
      ambiguousHits: [],
      activeAois: [polygonAoi],
    },
    {
      t: 0.2,
      hits: ['screen-polygon'],
      likelyHits: ['screen-polygon'],
      possibleHits: [],
      ambiguousHits: [],
      activeAois: [polygonAoi],
    },
    {
      t: 0.4,
      hits: [],
      likelyHits: [],
      possibleHits: ['screen-polygon'],
      ambiguousHits: ['screen-polygon'],
      activeAois: [polygonAoi],
    },
  ];

  const metrics = buildNamedAoiMetrics(samples, []);

  assert.equal(metrics.perAoi['screen-polygon'].label, 'Screen polygon');
  assert.equal(metrics.perAoi['screen-polygon'].hitCount, 2);
  assert.equal(metrics.perAoi['screen-polygon'].likelyHitCount, 2);
  assert.equal(metrics.perAoi['screen-polygon'].possibleSampleCount, 1);
  assert.equal(metrics.perAoi['screen-polygon'].ambiguousSampleCount, 1);
  assert.equal(metrics.perAoi['screen-polygon'].totalDwellSec, 0.4);
  assert.equal(metrics.perAoi['screen-polygon'].fixationCount, 1);
});

test('uses stable AOI hits for trusted dwell metrics when present', () => {
  const metrics = buildNamedAoiMetrics([
    {
      t: 0,
      hits: ['noisy-frame-hit'],
      stableHits: ['sign'],
      likelyHits: [],
      possibleHits: [],
      quality: { trustedForAoiAnalysis: true },
    },
    {
      t: 0.033,
      hits: [],
      stableHits: ['sign'],
      likelyHits: [],
      possibleHits: [],
      quality: { trustedForAoiAnalysis: true },
    },
  ], [
    { id: 'sign', label: 'Sign' },
    { id: 'noisy-frame-hit', label: 'Noisy' },
  ]);

  assert.equal(metrics.perAoi.sign.stableDwellSec > 0, true);
  assert.equal(metrics.perAoi.sign.stableHitCount, 2);
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

test('reports transparent processing efficiency components', () => {
  const aois = [
    { id: 'a', label: 'A' },
    { id: 'b', label: 'B' },
  ];
  const samples = [
    { t: 0.0, hits: ['a'], stableHits: ['a'], likelyHits: ['a'], possibleHits: [], ambiguousHits: [], quality: { trustedForAoiAnalysis: true }, activeAois: aois },
    { t: 0.1, hits: ['a'], stableHits: ['a'], likelyHits: ['a'], possibleHits: [], ambiguousHits: [], quality: { trustedForAoiAnalysis: true }, activeAois: aois },
    { t: 0.2, hits: ['b'], stableHits: ['b'], likelyHits: ['b'], possibleHits: [], ambiguousHits: [], quality: { trustedForAoiAnalysis: true }, activeAois: aois },
    { t: 0.3, hits: [], stableHits: [], likelyHits: [], possibleHits: [], ambiguousHits: [], quality: { trustedForAoiAnalysis: false }, activeAois: aois },
  ];

  const metrics = buildNamedAoiMetrics(samples, aois, { sampleIntervalMs: 100 });

  assert.equal(typeof metrics.session.processingEfficiencyComponents, 'object');
  assert.equal(metrics.session.processingEfficiencyComponents.aoiCoveragePercent, 100);
  assert.equal(metrics.session.processingEfficiencyComponents.trustedAoiDwellPercent, 75);
  assert.equal(metrics.session.processingEfficiencyComponents.fixationEfficiencyPercent, 20);
  assert.equal(
    metrics.session.processingEfficiencyFormula,
    '0.4*aoiCoveragePercent + 0.4*trustedAoiDwellPercent + 0.2*fixationEfficiencyPercent',
  );
  assert.equal(metrics.session.overallProcessingEfficiency, 74);
});

test('uses likely dwell for processing efficiency when stable dwell is absent', () => {
  const aois = [{ id: 'a', label: 'A' }];
  const samples = [
    { t: 0.0, hits: ['a'], stableHits: [], likelyHits: ['a'], possibleHits: [], ambiguousHits: [], activeAois: aois },
    { t: 0.1, hits: ['a'], stableHits: [], likelyHits: ['a'], possibleHits: [], ambiguousHits: [], activeAois: aois },
  ];

  const metrics = buildNamedAoiMetrics(samples, aois, { sampleIntervalMs: 100 });

  assert.equal(metrics.session.processingEfficiencyComponents.trustedAoiDwellPercent, 100);
});

test('uses stable dwell for processing efficiency when stable dwell exists', () => {
  const aois = [{ id: 'a', label: 'A' }];
  const samples = [
    { t: 0.0, hits: ['a'], stableHits: ['a'], likelyHits: ['a'], possibleHits: [], ambiguousHits: [], activeAois: aois },
    { t: 0.1, hits: ['a'], stableHits: [], likelyHits: ['a'], possibleHits: [], ambiguousHits: [], activeAois: aois },
    { t: 0.2, hits: ['a'], stableHits: [], likelyHits: ['a'], possibleHits: [], ambiguousHits: [], activeAois: aois },
    { t: 0.3, hits: ['a'], stableHits: [], likelyHits: ['a'], possibleHits: [], ambiguousHits: [], activeAois: aois },
  ];

  const metrics = buildNamedAoiMetrics(samples, aois, { sampleIntervalMs: 100 });

  assert.equal(metrics.session.processingEfficiencyComponents.trustedAoiDwellPercent, 25);
});

test('reports bounded processing efficiency components without samples or fixations', () => {
  const metrics = buildNamedAoiMetrics([], [{ id: 'a', label: 'A' }], { sampleIntervalMs: 100 });

  assert.deepEqual(metrics.session.processingEfficiencyComponents, {
    aoiCoveragePercent: 0,
    trustedAoiDwellPercent: 0,
    fixationEfficiencyPercent: 0,
  });
  assert.equal(
    metrics.session.processingEfficiencyFormula,
    '0.4*aoiCoveragePercent + 0.4*trustedAoiDwellPercent + 0.2*fixationEfficiencyPercent',
  );
  assert.equal(metrics.session.overallProcessingEfficiency, 0);
});
