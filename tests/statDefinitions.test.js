import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AOI_STAT_DEFINITIONS,
  STAT_RELIABILITY,
  getStatDefinition,
  listStatsByScope,
} from '../src/recording/statDefinitions.js';

const REQUIRED_STAT_IDS = [
  'totalDwellSec',
  'likelyDwellSec',
  'stableDwellSec',
  'fixationCount',
  'totalFixationDurationMs',
  'averageFixationDurationMs',
  'firstFixationDurationMs',
  'timeToFirstFixationMs',
  'revisitCount',
  'percentageOfViewingTime',
  'averageNumberOfAoisFixated',
  'aoiCoveragePercent',
  'overallProcessingEfficiency',
  'averageSaccadeDurationMs',
  'screenHeatmap',
  'panoramaHeatmap',
];

test('stat definitions have stable ids, labels, scopes, units, and reliability', () => {
  const ids = AOI_STAT_DEFINITIONS.map((definition) => definition.id);

  assert.deepEqual(ids, REQUIRED_STAT_IDS);
  assert.ok(getStatDefinition('totalFixationDurationMs'));
  assert.equal(getStatDefinition('averageSaccadeDurationMs').reliability, STAT_RELIABILITY.EXPERIMENTAL);
  assert.equal(getStatDefinition('overallProcessingEfficiency').reliability, STAT_RELIABILITY.ESTIMATED);
  assert.equal(getStatDefinition('timeToFirstFixationMs').scope, 'perAoi');
});

test('exports uppercase reliability constants with stable string values', () => {
  assert.deepEqual(STAT_RELIABILITY, {
    STABLE: 'stable',
    ESTIMATED: 'estimated',
    EXPERIMENTAL: 'experimental',
  });
});

test('groups stats by scope', () => {
  assert.ok(listStatsByScope('perAoi').some((definition) => definition.id === 'fixationCount'));
  assert.ok(listStatsByScope('session').some((definition) => definition.id === 'aoiCoveragePercent'));
  assert.ok(listStatsByScope('heatmap').some((definition) => definition.id === 'panoramaHeatmap'));
});
