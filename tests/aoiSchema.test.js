import test from 'node:test';
import assert from 'node:assert/strict';

import {
  extractAoisFromJson,
  extractProjectMetadataFromJson,
  getAoiSpace,
  isValidAoi,
} from '../src/aois/aoiImport.js';

test('validates panorama and video box AOIs', () => {
  assert.equal(isValidAoi({
    id: 'front',
    label: 'Front',
    color: '#ff0000',
    yawMin: -10,
    yawMax: 10,
    pitchMin: -5,
    pitchMax: 5,
  }), true);

  assert.equal(isValidAoi({
    id: 'logo',
    label: 'Logo',
    color: '#00ff00',
    space: 'video',
    xMin: 0.1,
    xMax: 0.4,
    yMin: 0.2,
    yMax: 0.5,
  }), true);
});

test('defaults missing AOI space to panorama', () => {
  assert.equal(getAoiSpace({ id: 'legacy' }), 'panorama');
});

test('extracts AOIs from arrays and exported project JSON', () => {
  const aois = [{ id: 'front', yawMin: -5, yawMax: 5, pitchMin: -5, pitchMax: 5 }];

  assert.deepEqual(extractAoisFromJson(aois), aois);
  assert.deepEqual(extractAoisFromJson({ aois }), aois);
});

test('extracts project metadata from sidecar JSON', () => {
  assert.deepEqual(
    extractProjectMetadataFromJson({
      video: { projection: 'flat', stereoLayout: 'mono' },
      aois: [],
    }),
    { video: { projection: 'flat', stereoLayout: 'mono' } },
  );
});
