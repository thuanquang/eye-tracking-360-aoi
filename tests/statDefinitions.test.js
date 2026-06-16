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
  'totalSamples',
  'totalDurationSec',
  'totalFixations',
  'averageFixationDurationMs',
  'uniqueAoisFixated',
  'saccadeCount',
  'averageNumberOfAoisFixated',
  'aoiCoveragePercent',
  'overallProcessingEfficiency',
  'averageSaccadeDurationMs',
  'screenHeatmap',
  'panoramaHeatmap',
];

const EXPECTED_SCOPES = {
  totalDwellSec: ['perAoi'],
  likelyDwellSec: ['perAoi'],
  stableDwellSec: ['perAoi'],
  fixationCount: ['perAoi'],
  totalFixationDurationMs: ['perAoi'],
  averageFixationDurationMs: ['perAoi', 'session'],
  firstFixationDurationMs: ['perAoi'],
  timeToFirstFixationMs: ['perAoi'],
  revisitCount: ['perAoi'],
  percentageOfViewingTime: ['perAoi'],
  totalSamples: ['session'],
  totalDurationSec: ['session'],
  totalFixations: ['session'],
  uniqueAoisFixated: ['session'],
  saccadeCount: ['session'],
  averageNumberOfAoisFixated: ['session'],
  aoiCoveragePercent: ['session'],
  overallProcessingEfficiency: ['session'],
  averageSaccadeDurationMs: ['session'],
  screenHeatmap: ['heatmap'],
  panoramaHeatmap: ['heatmap'],
};

function requiredIdsByScope(scope) {
  return REQUIRED_STAT_IDS.filter((id, index) => {
    const occurrence = REQUIRED_STAT_IDS.slice(0, index).filter((candidate) => candidate === id).length;
    return EXPECTED_SCOPES[id][occurrence] === scope;
  });
}

test('stat definitions have stable ids, labels, scopes, units, and reliability', () => {
  const ids = AOI_STAT_DEFINITIONS.map((definition) => definition.id);
  const validReliabilities = Object.values(STAT_RELIABILITY);

  assert.deepEqual(ids, REQUIRED_STAT_IDS);
  assert.deepEqual(Object.keys(EXPECTED_SCOPES), [...new Set(REQUIRED_STAT_IDS)]);

  AOI_STAT_DEFINITIONS.forEach((definition) => {
    assert.ok(EXPECTED_SCOPES[definition.id].includes(definition.scope), `${definition.id} scope`);
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
  assert.equal(getStatDefinition('averageFixationDurationMs', 'perAoi').scope, 'perAoi');
  assert.equal(getStatDefinition('averageFixationDurationMs', 'session').scope, 'session');
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

  assert.match(description, /độ bao phủ AOI/);
  assert.match(description, /thời gian lưu lại AOI tin cậy/);
  assert.match(description, /hiệu quả định thị/);
  assert.match(description, /công thức/);
  assert.match(description, /thành phần/);
  assert.doesNotMatch(description, /tỷ lệ thời gian xem/);
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
