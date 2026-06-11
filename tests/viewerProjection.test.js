import test from 'node:test';
import assert from 'node:assert/strict';

import {
  clampCameraPitch,
  getNextCameraFromDrag,
  shouldAllowCameraDrag,
} from '../src/viewer/cameraControls.js';
import {
  getCurrentProjection,
  getCurrentStereoLayout,
  normalizeVideoProjection,
  normalizeStereoLayout,
} from '../src/viewer/projection.js';

test('normalizes video projection metadata', () => {
  assert.equal(normalizeVideoProjection('flat'), 'flat');
  assert.equal(normalizeVideoProjection('weird'), 'equirectangular');
});

test('normalizes stereo layout metadata', () => {
  assert.equal(normalizeStereoLayout('top-bottom'), 'top-bottom');
  assert.equal(normalizeStereoLayout('broken'), 'mono');
});

test('resolves projection from controls before metadata fallback', () => {
  assert.equal(
    getCurrentProjection({ controlValue: 'flat', metadataProjection: 'equirectangular' }),
    'flat',
  );
  assert.equal(
    getCurrentStereoLayout({ controlValue: '', metadataStereoLayout: 'top-bottom' }),
    'top-bottom',
  );
});

test('updates camera yaw and clamps pitch from pointer drag', () => {
  assert.deepEqual(
    getNextCameraFromDrag({
      cameraYaw: 0,
      cameraPitch: 0,
      dx: 100,
      dy: -100,
      sensitivity: 0.12,
    }),
    { cameraYaw: -12, cameraPitch: 12 },
  );
  assert.equal(clampCameraPitch(100), 85);
});

test('allows drag for equirectangular viewer only', () => {
  assert.equal(shouldAllowCameraDrag('equirectangular'), true);
  assert.equal(shouldAllowCameraDrag('flat'), false);
});
