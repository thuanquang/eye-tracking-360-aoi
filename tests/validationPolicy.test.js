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

test('fails when one present dispersion metric exceeds policy', () => {
  assert.equal(passesValidationPolicy({
    summary: { count: 8, meanPx: 90, p90Px: 120, maxPx: 150, p90DispersionPx: 999, maxDispersionPx: null },
    streamQuality: { effectiveHz: 30, dataIntegrityPercent: 95 },
    policy: getValidationPolicy('research'),
  }), false);

  assert.equal(passesValidationPolicy({
    summary: { count: 8, meanPx: 90, p90Px: 120, maxPx: 150, p90DispersionPx: undefined, maxDispersionPx: 999 },
    streamQuality: { effectiveHz: 30, dataIntegrityPercent: 95 },
    policy: getValidationPolicy('research'),
  }), false);
});

test('does not fail when optional dispersion metrics are absent', () => {
  assert.equal(passesValidationPolicy({
    summary: { count: 8, meanPx: 90, p90Px: 120, maxPx: 150 },
    streamQuality: { effectiveHz: 30, dataIntegrityPercent: 95 },
    policy: getValidationPolicy('research'),
  }), true);

  assert.equal(passesValidationPolicy({
    summary: { count: 8, meanPx: 90, p90Px: 120, maxPx: 150, p90DispersionPx: null, maxDispersionPx: null },
    streamQuality: { effectiveHz: 30, dataIntegrityPercent: 95 },
    policy: getValidationPolicy('research'),
  }), true);
});
