import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createDefaultAois,
  createInitialAppState,
  createInitialVideoInfo,
} from '../src/app/state.js';

test('creates fresh app state without shared mutable arrays', () => {
  const first = createInitialAppState();
  const second = createInitialAppState();

  first.samples.push({ t: 1 });
  first.gaze.x = 123;

  assert.equal(second.samples.length, 0);
  assert.equal(second.gaze.x, 0);
  assert.equal(second.gaze.visible, false);
  assert.deepEqual(second.selectedCalibrationProfile, { id: 'standard', label: 'Standard', pointCount: 14 });
  assert.equal(second.calibrationProfile, null);
  assert.equal(second.selectedValidationPolicyId, 'prototype');
  assert.equal(second.validationPolicyId, null);
  assert.equal(second.policyPassed, null);
  assert.deepEqual(second.policyFailures, []);
  assert.equal(second.validationGazeStreamQuality, null);
});

test('creates initial video metadata for bundled equirectangular demo', () => {
  assert.deepEqual(createInitialVideoInfo(), {
    kind: 'bundled',
    name: 'test-video.mp4',
    path: 'assets/test-video.mp4',
    type: 'video/mp4',
    size: null,
    lastModified: null,
    projection: 'equirectangular',
    stereoLayout: 'mono',
  });
});

test('creates fresh default AOI definitions', () => {
  const first = createDefaultAois();
  const second = createDefaultAois();

  first[0].label = 'Changed';

  assert.notEqual(second[0].label, 'Changed');
  assert.equal(second.some((aoi) => aoi.id === 'front-center'), true);
});
