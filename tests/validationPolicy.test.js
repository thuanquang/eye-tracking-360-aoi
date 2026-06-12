import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getValidationPolicy,
  passesValidationPolicy,
} from '../src/gaze/validationPolicy.js';

test('exposes prototype and research validation policies', () => {
  assert.equal(getValidationPolicy('prototype').maxMeanPx, 180);
  assert.equal(getValidationPolicy('research').maxMeanPx, 110);
  assert.equal(getValidationPolicy('research').minEffectiveHz, 20);
});

test('checks accuracy and sample-rate gates together', () => {
  assert.equal(passesValidationPolicy({
    summary: { count: 8, meanPx: 100, p90Px: 150, maxPx: 170, p90DispersionPx: 40, maxDispersionPx: 50 },
    streamQuality: { effectiveHz: 30, dataIntegrityPercent: 95 },
    policy: getValidationPolicy('research'),
  }), true);

  assert.equal(passesValidationPolicy({
    summary: { count: 8, meanPx: 130, p90Px: 180, maxPx: 240, p90DispersionPx: 40, maxDispersionPx: 50 },
    streamQuality: { effectiveHz: 30, dataIntegrityPercent: 95 },
    policy: getValidationPolicy('research'),
  }), false);
});
