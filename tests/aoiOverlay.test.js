import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildAoiOverlayModels,
  clipPolygonToRect,
  createAoiOverlayRedrawGate,
  isScreenSpanningOverlayArtifact,
  projectPanoramaPolygon,
  projectVideoAoiRange,
  resolveOverlayAoisAtTime,
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
  assert.equal(models[0].fillOpacity, 0.16);
});

test('uses quieter fill opacity for generated AOI overlays', () => {
  const models = buildAoiOverlayModels({
    aois: [{
      id: 'generated-person',
      label: 'person',
      color: '#38bdf8',
      space: 'video',
      xMin: 0.25,
      xMax: 0.5,
      yMin: 0.1,
      yMax: 0.3,
      metadata: { generatedBy: 'runpod-auto-aoi' },
    }],
    rect: { width: 800, height: 600 },
    camera: { yaw: 0, pitch: 0, fov: 75 },
  });

  assert.equal(models.length, 1);
  assert.equal(models[0].fillOpacity, 0.06);
});

test('detects generated overlay fragments that span a clipped screen edge', () => {
  assert.equal(isScreenSpanningOverlayArtifact({
    generated: true,
    points: [
      { x: 0, y: 0 },
      { x: 800, y: 0 },
      { x: 800, y: 112 },
      { x: 0, y: 112 },
    ],
  }, { width: 800, height: 450 }), true);

  assert.equal(isScreenSpanningOverlayArtifact({
    generated: true,
    points: [
      { x: 100, y: 80 },
      { x: 760, y: 90 },
      { x: 740, y: 180 },
      { x: 120, y: 170 },
    ],
  }, { width: 800, height: 450 }), false);

  assert.equal(isScreenSpanningOverlayArtifact({
    generated: false,
    points: [
      { x: 0, y: 0 },
      { x: 800, y: 0 },
      { x: 800, y: 112 },
      { x: 0, y: 112 },
    ],
  }, { width: 800, height: 450 }), false);
});

test('detects generated panorama seam strips that bridge the viewport interior', () => {
  assert.equal(isScreenSpanningOverlayArtifact({
    generated: true,
    points: [
      { x: 0, y: 182.4 },
      { x: 798, y: 196.4 },
      { x: 798, y: 294.6 },
      { x: 0, y: 294.6 },
    ],
  }, { width: 798, height: 449 }), true);

  assert.equal(isScreenSpanningOverlayArtifact({
    generated: true,
    points: [
      { x: 249.4, y: 448.9 },
      { x: 431.8, y: 179.2 },
      { x: 752.0, y: 153.7 },
      { x: 798.0, y: 154.3 },
      { x: 798.0, y: 448.9 },
    ],
  }, { width: 798, height: 449 }), false);
});

test('gates expensive overlay rebuilds by signature and frame budget', () => {
  const gate = createAoiOverlayRedrawGate({ minIntervalMs: 50 });

  assert.equal(gate.shouldRedraw({ signature: 'camera:0', nowMs: 0 }), true);
  assert.equal(gate.shouldRedraw({ signature: 'camera:0', nowMs: 10 }), false);
  assert.equal(gate.shouldRedraw({ signature: 'camera:1', nowMs: 20 }), false);
  assert.equal(gate.shouldRedraw({ signature: 'camera:1', nowMs: 55 }), true);
  assert.equal(gate.shouldRedraw({ signature: 'aoi-version:2', nowMs: 56, force: true }), true);
});

test('renders panorama AOIs when only a thin edge is visible on screen', () => {
  const models = buildAoiOverlayModels({
    aois: [{
      id: 'right-edge',
      label: 'Right edge',
      color: '#ffd166',
      yawMin: 45,
      yawMax: 120,
      pitchMin: -10,
      pitchMax: 10,
    }],
    rect: { width: 1280, height: 720 },
    camera: { yaw: 0, pitch: 0, fov: 75 },
  });

  assert.equal(models.length, 1);
  assert.equal(models[0].id, 'right-edge');
  assert.ok(models[0].points.length >= 3);
  assert.ok(models[0].points.every((point) => (
    point.x >= 0 &&
    point.x <= 1280 &&
    point.y >= 0 &&
    point.y <= 720
  )));
});

test('renders panorama polygon AOIs when only a thin edge is visible on screen', () => {
  const models = buildAoiOverlayModels({
    aois: [{
      id: 'right-edge-poly',
      label: 'Right edge polygon',
      color: '#ffd166',
      space: 'panorama',
      shape: 'polygon',
      points: [
        { yaw: 45, pitch: -10 },
        { yaw: 120, pitch: -10 },
        { yaw: 120, pitch: 10 },
        { yaw: 45, pitch: 10 },
      ],
    }],
    rect: { width: 1280, height: 720 },
    camera: { yaw: 0, pitch: 0, fov: 75 },
  });

  assert.equal(models.length, 1);
  assert.equal(models[0].id, 'right-edge-poly');
  assert.ok(models[0].points.length >= 3);
});

test('caps dense panorama polygon overlay projection points', () => {
  const densePoints = Array.from({ length: 360 }, (_, index) => ({
    yaw: -20 + (40 * index) / 359,
    pitch: index % 2 === 0 ? -10 : 10,
  }));

  const points = projectPanoramaPolygon({
    id: 'dense-poly',
    space: 'panorama',
    shape: 'polygon',
    points: densePoints,
  }, { width: 1280, height: 720 }, { yaw: 0, pitch: 0, fov: 75 });

  assert.ok(points.length <= 96);
});

test('resolves dense dynamic polygon AOIs to overlay-sized point sets', () => {
  const startPoints = Array.from({ length: 360 }, (_, index) => ({
    yaw: -30 + (60 * index) / 359,
    pitch: index % 2 === 0 ? -10 : 10,
  }));
  const endPoints = startPoints.map((point) => ({
    yaw: point.yaw + 10,
    pitch: point.pitch + 2,
  }));
  const [resolved] = resolveOverlayAoisAtTime([{
    id: 'dense-dynamic-poly',
    space: 'panorama',
    shape: 'polygon',
    points: startPoints,
    keyframes: [
      { t: 0, points: startPoints },
      { t: 10, points: endPoints },
    ],
  }], 5);

  assert.ok(resolved.points.length <= 96);
  assert.notDeepEqual(resolved.points, startPoints);
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
