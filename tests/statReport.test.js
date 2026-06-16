import test from 'node:test';
import assert from 'node:assert/strict';

import { buildStatReport } from '../src/recording/statReport.js';

test('builds display-ready AOI stat rows with definitions and caveats', () => {
  const report = buildStatReport({
    namedAoiMetrics: {
      session: {
        totalSamples: 4,
        totalDurationSec: 10,
        totalFixations: 2,
        averageFixationDurationMs: 250,
        uniqueAoisFixated: ['logo'],
        saccadeCount: 1,
        averageNumberOfAoisFixated: 1,
        overallProcessingEfficiency: 72,
        averageSaccadeDurationMs: 40,
      },
      perAoi: {
        logo: {
          id: 'logo',
          label: 'Logo',
          totalFixationDurationMs: 500,
          averageFixationDurationMs: 250,
          timeToFirstFixationMs: 300,
          fixationCount: 2,
        },
      },
    },
  });

  assert.equal(report.perAoiRows.length, 1);
  assert.equal(report.perAoiRows[0].aoiId, 'logo');
  assert.ok(report.perAoiRows[0].stats.some((stat) => stat.id === 'totalFixationDurationMs'));
  assert.ok(report.sessionStats.some((stat) => stat.id === 'overallProcessingEfficiency'));
  assert.deepEqual(
    report.sessionStats.map((stat) => stat.id),
    [
      'totalSamples',
      'totalDurationSec',
      'totalFixations',
      'averageFixationDurationMs',
      'uniqueAoisFixated',
      'saccadeCount',
      'averageNumberOfAoisFixated',
      'overallProcessingEfficiency',
      'averageSaccadeDurationMs',
    ],
  );
  assert.ok(report.caveats.some((caveat) => caveat.includes('saccade')));
});

test('preserves zero values and passes heatmaps through', () => {
  const heatmaps = {
    screen: { type: 'screen', bins: [] },
    panorama: { type: 'panorama', bins: [] },
  };

  const report = buildStatReport({
    exportedAt: '2026-06-14T10:00:00.000Z',
    summary: { heatmaps },
    namedAoiMetrics: {
      session: {
        overallProcessingEfficiency: 0,
        averageSaccadeDurationMs: '',
      },
      perAoi: {
        logo: {
          id: 'logo',
          label: 'Logo',
          fixationCount: 0,
          totalFixationDurationMs: 0,
          averageFixationDurationMs: null,
          timeToFirstFixationMs: undefined,
        },
      },
    },
  });

  assert.equal(report.exportedAt, '2026-06-14T10:00:00.000Z');
  assert.equal(report.heatmaps, heatmaps);
  assert.deepEqual(
    report.sessionStats.map((stat) => [stat.id, stat.value]),
    [['overallProcessingEfficiency', 0]],
  );
  assert.deepEqual(
    report.perAoiRows[0].stats.map((stat) => [stat.id, stat.value]),
    [
      ['fixationCount', 0],
      ['totalFixationDurationMs', 0],
    ],
  );
});
