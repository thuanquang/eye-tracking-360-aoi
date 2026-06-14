import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AOI_STAT_DEFINITIONS,
  getStatDefinition,
  listStatsByScope,
} from '../src/recording/statDefinitions.js';

test('stat definitions have stable ids, labels, scopes, units, and reliability', () => {
  const ids = AOI_STAT_DEFINITIONS.map((definition) => definition.id);

  assert.equal(new Set(ids).size, ids.length);
  assert.ok(getStatDefinition('totalFixationDurationMs'));
  assert.equal(getStatDefinition('averageSaccadeDurationMs').reliability, 'experimental');
  assert.equal(getStatDefinition('overallProcessingEfficiency').reliability, 'estimated');
  assert.equal(getStatDefinition('timeToFirstFixationMs').scope, 'perAoi');
});

test('groups stats by scope', () => {
  assert.ok(listStatsByScope('perAoi').some((definition) => definition.id === 'fixationCount'));
  assert.ok(listStatsByScope('session').some((definition) => definition.id === 'aoiCoveragePercent'));
  assert.ok(listStatsByScope('heatmap').some((definition) => definition.id === 'panoramaHeatmap'));
});
