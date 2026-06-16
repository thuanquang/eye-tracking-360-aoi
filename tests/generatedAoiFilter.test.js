import test from 'node:test';
import assert from 'node:assert/strict';

import { filterGeneratedSceneBackgroundAois } from '../src/aois/generatedAoiFilter.js';

test('keeps dedicated scene surface AOIs while filtering generic generated backgrounds', () => {
  const genericSky = {
    id: 'generic-sky',
    label: 'sky',
    metadata: { generatedBy: 'runpod-auto-aoi' },
  };
  const sceneSky = {
    id: 'scene-sky',
    label: 'sky',
    metadata: {
      generatedBy: 'runpod-scene-surface-aoi',
      sceneSurface: true,
    },
  };
  const sceneGround = {
    id: 'scene-ground',
    label: 'ground',
    metadata: {
      generatedBy: 'runpod-scene-surface-aoi',
      sceneSurface: true,
    },
  };

  assert.deepEqual(
    filterGeneratedSceneBackgroundAois([genericSky, sceneSky, sceneGround]).map((aoi) => aoi.id),
    ['scene-sky', 'scene-ground'],
  );
});
