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

const EXPECTED_SCOPES = {
  totalDwellSec: 'perAoi',
  likelyDwellSec: 'perAoi',
  stableDwellSec: 'perAoi',
  fixationCount: 'perAoi',
  totalFixationDurationMs: 'perAoi',
  averageFixationDurationMs: 'perAoi',
  firstFixationDurationMs: 'perAoi',
  timeToFirstFixationMs: 'perAoi',
  revisitCount: 'perAoi',
  percentageOfViewingTime: 'perAoi',
  averageNumberOfAoisFixated: 'session',
  aoiCoveragePercent: 'session',
  overallProcessingEfficiency: 'session',
  averageSaccadeDurationMs: 'session',
  screenHeatmap: 'heatmap',
  panoramaHeatmap: 'heatmap',
};

function requiredIdsByScope(scope) {
  return REQUIRED_STAT_IDS.filter((id) => EXPECTED_SCOPES[id] === scope);
}

test('stat definitions have stable ids, labels, scopes, units, and reliability', () => {
  const ids = AOI_STAT_DEFINITIONS.map((definition) => definition.id);
  const validReliabilities = Object.values(STAT_RELIABILITY);

  assert.deepEqual(ids, REQUIRED_STAT_IDS);
  assert.deepEqual(Object.keys(EXPECTED_SCOPES), REQUIRED_STAT_IDS);

  AOI_STAT_DEFINITIONS.forEach((definition) => {
    assert.equal(definition.scope, EXPECTED_SCOPES[definition.id], `${definition.id} scope`);
    assert.equal(typeof definition.label, 'string', `${definition.id} label type`);
    assert.notEqual(definition.label.trim(), '', `${definition.id} label`);
    assert.equal(typeof definition.unit, 'string', `${definition.id} unit type`);
    assert.notEqual(definition.unit.trim(), '', `${definition.id} unit`);
    assert.ok(validReliabilities.includes(definition.reliability), `${definition.id} reliability`);
    assert.equal(typeof definition.description, 'string', `${definition.id} description type`);
    assert.notEqual(definition.description.trim(), '', `${definition.id} description`);
  });

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

test('describes overall processing efficiency as a transparent composite', () => {
  const description = getStatDefinition('overallProcessingEfficiency').description;

  assert.match(description, /AOI coverage/);
  assert.match(description, /trusted AOI dwell/);
  assert.match(description, /fixation efficiency/);
  assert.match(description, /formula/);
  assert.match(description, /components/);
  assert.doesNotMatch(description, /share of viewing time/);
});

test('groups stats by scope', () => {
  assert.deepEqual(
    listStatsByScope('perAoi').map((definition) => definition.id),
    requiredIdsByScope('perAoi'),
  );
  assert.deepEqual(
    listStatsByScope('session').map((definition) => definition.id),
    requiredIdsByScope('session'),
  );
  assert.deepEqual(
    listStatsByScope('heatmap').map((definition) => definition.id),
    requiredIdsByScope('heatmap'),
  );
});
