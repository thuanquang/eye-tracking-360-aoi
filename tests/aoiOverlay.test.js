import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildAoiOverlayModels,
  clipPolygonToRect,
  projectVideoAoiRange,
  splitAoiYawRanges,
} from '../src/aois/aoiOverlay.js';

test('splits panorama AOIs across the yaw wrap boundary', () => {
  assert.deepEqual(
    splitAoiYawRanges({ yawMin: 170, yawMax: -170 }),
    [
      { yawMin: 170, yawMax: 180 },
      { yawMin: -180, yawMax: -170 },
    ],
  );
});

test('clips polygons to viewer rect', () => {
  const clipped = clipPolygonToRect([
    { x: -10, y: 10 },
    { x: 50, y: 10 },
    { x: 50, y: 50 },
    { x: -10, y: 50 },
  ], 100, 100);

  assert.equal(clipped.every((point) => point.x >= 0 && point.x <= 100), true);
});

test('projects normalized video AOI boxes into viewer pixels', () => {
  assert.deepEqual(
    projectVideoAoiRange(
      { xMin: 0.25, xMax: 0.5, yMin: 0.1, yMax: 0.3 },
      { width: 800, height: 600 },
    ),
    [
      { x: 200, y: 60 },
      { x: 400, y: 60 },
      { x: 400, y: 180 },
      { x: 200, y: 180 },
    ],
  );
});

test('builds render models for video AOIs', () => {
  const models = buildAoiOverlayModels({
    aois: [{
      id: 'logo',
      label: 'Logo',
      color: '#ffd166',
      space: 'video',
      xMin: 0.25,
      xMax: 0.5,
      yMin: 0.1,
      yMax: 0.3,
    }],
    rect: { width: 800, height: 600 },
    camera: { yaw: 0, pitch: 0, fov: 75 },
  });

  assert.equal(models.length, 1);
  assert.equal(models[0].id, 'logo');
  assert.equal(models[0].points.length, 4);
});
