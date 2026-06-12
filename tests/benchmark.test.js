import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildBenchmarkReport,
  summarizeBenchmarkRuns,
} from '../src/gaze/benchmark.js';

test('summarizes benchmark runs across participants and devices', () => {
  const summary = summarizeBenchmarkRuns([
    {
      participantId: 'P1',
      device: 'laptop',
      accuracy: { meanPx: 100, p90Px: 150, maxPx: 180 },
      streamQuality: { effectiveHz: 30, dataIntegrityPercent: 95 },
    },
    {
      participantId: 'P2',
      device: 'desktop',
      accuracy: { meanPx: 140, p90Px: 210, maxPx: 260 },
      gazeStreamQuality: { effectiveHz: 24, dataIntegrityPercent: 88 },
    },
    {
      participantId: 'P3',
      device: 'tablet',
      accuracy: { meanPx: Number.NaN, p90Px: Infinity, maxPx: null },
      gazeStreamQuality: { effectiveHz: 'missing', dataIntegrityPercent: undefined },
    },
  ]);

  assert.deepEqual(summary, {
    runCount: 3,
    meanAccuracyPx: 120,
    meanP90Px: 180,
    meanMaxPx: 220,
    meanEffectiveHz: 27,
    meanDataIntegrityPercent: 91.5,
  });
});

test('returns null means when no finite metric values are available', () => {
  const summary = summarizeBenchmarkRuns([
    { participantId: 'P1', accuracy: { meanPx: Number.NaN }, streamQuality: null },
    { participantId: 'P2', accuracy: null, gazeStreamQuality: { effectiveHz: Infinity } },
  ]);

  assert.deepEqual(summary, {
    runCount: 2,
    meanAccuracyPx: null,
    meanP90Px: null,
    meanMaxPx: null,
    meanEffectiveHz: null,
    meanDataIntegrityPercent: null,
  });
});

test('builds deterministic markdown report text', () => {
  const report = buildBenchmarkReport({
    summary: {
      runCount: 1,
      meanAccuracyPx: 100,
      meanP90Px: 150,
      meanMaxPx: 180,
      meanEffectiveHz: 30,
      meanDataIntegrityPercent: 95,
    },
    runs: [
      {
        participantId: 'P1|trial',
        device: 'lab laptop',
        accuracy: { meanPx: 100, p90Px: 150, maxPx: 180 },
        gazeStreamQuality: { effectiveHz: 30, dataIntegrityPercent: 95 },
        calibrationProfileUsed: { id: 'research-39' },
        validationPolicyId: 'research',
      },
    ],
  });

  assert.equal(report, [
    '# Eye Tracking Benchmark',
    '',
    'Run count: 1',
    'Mean accuracy px: 100',
    'Mean p90 px: 150',
    'Mean max px: 180',
    'Mean effective Hz: 30',
    'Mean data integrity percent: 95',
    '',
    '| Participant | Device | Calibration | Policy | Mean px | P90 px | Max px | Effective Hz | Integrity % |',
    '| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: |',
    '| P1\\|trial | lab laptop | research-39 | research | 100 | 150 | 180 | 30 | 95 |',
    '',
  ].join('\n'));
});

test('builds reports from exported benchmark objects', () => {
  const exported = {
    benchmark: {
      participantId: 'P4',
      device: 'desktop',
      accuracy: { meanPx: 80, p90Px: 120, maxPx: 170 },
      gazeStreamQuality: { effectiveHz: 29.97, dataIntegrityPercent: 99 },
      calibrationProfileUsed: { id: 'research-78' },
      validationPolicyId: 'research',
    },
  };
  const summary = summarizeBenchmarkRuns([exported]);
  const report = buildBenchmarkReport({ summary, runs: [exported] });

  assert.equal(summary.meanAccuracyPx, 80);
  assert.match(report, /\| P4 \| desktop \| research-78 \| research \| 80 \| 120 \| 170 \| 29\.97 \| 99 \|/);
});
