import test from 'node:test';
import assert from 'node:assert/strict';

import { buildAoiStatsCsv } from '../src/recording/csvExport.js';

test('exports AOI stats as CSV with one row per AOI', () => {
  const csv = buildAoiStatsCsv({
    namedAoiMetrics: {
      perAoi: {
        logo: {
          id: 'logo',
          label: 'Logo',
          totalDwellSec: 1.2,
          likelyDwellSec: 1.1,
          fixationCount: 3,
          totalFixationDurationMs: 900,
          averageFixationDurationMs: 300,
          timeToFirstFixationMs: 500,
          firstFixationDurationMs: 250,
          revisitCount: 1,
          percentageOfViewingTime: 12,
        },
      },
    },
  });

  assert.match(csv, /^aoiId,aoiLabel,/);
  assert.match(csv, /logo,Logo,/);
  assert.match(csv, /totalFixationDurationMs/);
});

test('escapes CSV values with quotes, commas, and newlines', () => {
  const csv = buildAoiStatsCsv({
    namedAoiMetrics: {
      perAoi: {
        'logo,"hero"': {
          id: 'logo,"hero"',
          label: 'Logo, "Hero"\nNorth',
          totalDwellSec: null,
          likelyDwellSec: undefined,
          stableDwellSec: 0.8,
          fixationCount: 2,
          totalFixationDurationMs: 600,
          averageFixationDurationMs: 300,
          firstFixationDurationMs: 200,
          timeToFirstFixationMs: 120,
          revisitCount: 1,
          percentageOfViewingTime: 33.33,
          trustedSampleCount: 4,
          ambiguousSampleCount: 0,
        },
      },
    },
  });

  assert.equal(
    csv,
    [
      'aoiId,aoiLabel,totalDwellSec,likelyDwellSec,stableDwellSec,fixationCount,totalFixationDurationMs,averageFixationDurationMs,firstFixationDurationMs,timeToFirstFixationMs,revisitCount,percentageOfViewingTime,trustedSampleCount,ambiguousSampleCount',
      '"logo,""hero""","Logo, ""Hero""\nNorth",,,0.8,2,600,300,200,120,1,33.33,4,0',
    ].join('\n'),
  );
});
