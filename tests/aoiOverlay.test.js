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

test('projects video AOIs into a contained media rect when provided', () => {
  const models = buildAoiOverlayModels({
    aois: [{
      id: 'logo',
      label: 'Logo',
      color: '#ffd166',
      space: 'video',
      xMin: 0,
      xMax: 1,
      yMin: 0,
      yMax: 1,
    }],
    rect: { width: 1000, height: 500 },
    videoRect: { x: 166.666667, y: 0, width: 666.666667, height: 500 },
    camera: { yaw: 0, pitch: 0, fov: 75 },
  });

  assert.deepEqual(models[0].points.map((point) => ({
    x: Number(point.x.toFixed(6)),
    y: Number(point.y.toFixed(6)),
  })), [
    { x: 166.666667, y: 0 },
    { x: 833.333334, y: 0 },
    { x: 833.333334, y: 500 },
    { x: 166.666667, y: 500 },
  ]);
});
