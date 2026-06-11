import test from 'node:test';
import assert from 'node:assert/strict';

import {
  boundsFromPoints,
  distanceToPolygonEdges,
  interpolatePolygonPoints,
  isPointInPolygon,
  normalizePolygonPoints,
  pointHitsPolygonAoi,
} from '../src/aoiShapes.js';

test('detects points inside and outside a polygon', () => {
  const points = [
    { x: 0.2, y: 0.2 },
    { x: 0.6, y: 0.2 },
    { x: 0.5, y: 0.6 },
    { x: 0.25, y: 0.5 },
  ];

  assert.equal(isPointInPolygon({ x: 0.35, y: 0.35 }, points), true);
  assert.equal(isPointInPolygon({ x: 0.8, y: 0.35 }, points), false);
});

test('measures distance to polygon edges in normalized coordinates', () => {
  const points = [
    { x: 0.2, y: 0.2 },
    { x: 0.6, y: 0.2 },
    { x: 0.6, y: 0.6 },
    { x: 0.2, y: 0.6 },
  ];

  assert.equal(distanceToPolygonEdges({ x: 0.4, y: 0.2 }, points), 0);
  assert.equal(Number(distanceToPolygonEdges({ x: 0.4, y: 0.1 }, points).toFixed(3)), 0.1);
});

test('hit tests polygon AOIs with optional analysis padding', () => {
  const aoi = {
    id: 'screen',
    label: 'Screen',
    color: '#ffd166',
    space: 'video',
    shape: 'polygon',
    analysisPadding: 0.03,
    points: [
      { x: 0.2, y: 0.2 },
      { x: 0.6, y: 0.2 },
      { x: 0.6, y: 0.6 },
      { x: 0.2, y: 0.6 },
    ],
  };

  assert.equal(pointHitsPolygonAoi({ x: 0.4, y: 0.4 }, aoi), true);
  assert.equal(pointHitsPolygonAoi({ x: 0.4, y: 0.18 }, aoi), true);
  assert.equal(pointHitsPolygonAoi({ x: 0.4, y: 0.12 }, aoi), false);
});

test('hit tests video polygon AOIs with viewport-converted pixel padding', () => {
  const aoi = {
    id: 'screen-px',
    label: 'Screen with pixel padding',
    color: '#ffd166',
    space: 'video',
    shape: 'polygon',
    analysisPaddingPx: 12,
    points: [
      { x: 0.2, y: 0.2 },
      { x: 0.6, y: 0.2 },
      { x: 0.6, y: 0.6 },
      { x: 0.2, y: 0.6 },
    ],
  };
  const viewport = { width: 400, height: 300 };

  assert.equal(pointHitsPolygonAoi({ x: 0.4, y: 0.17 }, aoi, viewport), true);
  assert.equal(pointHitsPolygonAoi({ x: 0.4, y: 0.14 }, aoi, viewport), false);
});

test('interpolates matching polygon keyframes', () => {
  const points = interpolatePolygonPoints(
    [
      { x: 0.1, y: 0.1 },
      { x: 0.3, y: 0.1 },
      { x: 0.2, y: 0.3 },
    ],
    [
      { x: 0.3, y: 0.3 },
      { x: 0.5, y: 0.3 },
      { x: 0.4, y: 0.5 },
    ],
    0.5,
  );

  assert.deepEqual(points, [
    { x: 0.2, y: 0.2 },
    { x: 0.4, y: 0.2 },
    { x: 0.3, y: 0.4 },
  ]);
});

test('interpolates matching panorama polygon keyframes', () => {
  const points = interpolatePolygonPoints(
    [
      { yaw: -20, pitch: -10 },
      { yaw: 20, pitch: -10 },
      { yaw: 0, pitch: 10 },
    ],
    [
      { yaw: 0, pitch: 10 },
      { yaw: 40, pitch: 10 },
      { yaw: 20, pitch: 30 },
    ],
    0.5,
    { x: 'yaw', y: 'pitch' },
  );

  assert.deepEqual(points, [
    { yaw: -10, pitch: 0 },
    { yaw: 30, pitch: 0 },
    { yaw: 10, pitch: 20 },
  ]);
});

test('interpolates panorama polygon yaw across the seam', () => {
  const [point] = interpolatePolygonPoints(
    [{ yaw: 170, pitch: -10 }],
    [{ yaw: -170, pitch: 10 }],
    0.5,
    { x: 'yaw', y: 'pitch' },
  );

  assert.ok(Math.abs(Math.abs(point.yaw) - 180) < 0.000001);
  assert.equal(point.pitch, 0);
});

test('normalizes and bounds polygon points', () => {
  const points = normalizePolygonPoints([
    { x: -0.2, y: 0.2 },
    { x: 1.2, y: 0.3 },
    { x: 0.4, y: 1.4 },
  ]);

  assert.deepEqual(points, [
    { x: 0, y: 0.2 },
    { x: 1, y: 0.3 },
    { x: 0.4, y: 1 },
  ]);
  assert.deepEqual(boundsFromPoints(points), {
    xMin: 0,
    xMax: 1,
    yMin: 0.2,
    yMax: 1,
  });
});

test('normalizes and bounds panorama polygon points', () => {
  const keys = { x: 'yaw', y: 'pitch' };
  const points = normalizePolygonPoints([
    { yaw: -220, pitch: 10 },
    { yaw: 220, pitch: -100 },
    { yaw: 40, pitch: 120 },
    { yaw: '30', pitch: 10 },
    { yaw: 15, pitch: null },
    { yaw: false, pitch: 0 },
    null,
  ], keys);

  assert.deepEqual(points, [
    { yaw: -180, pitch: 10 },
    { yaw: 180, pitch: -90 },
    { yaw: 40, pitch: 90 },
  ]);
  assert.deepEqual(boundsFromPoints(points, keys), {
    yawMin: -180,
    yawMax: 180,
    pitchMin: -90,
    pitchMax: 90,
  });
});

test('filters invalid polygon points during normalization', () => {
  const points = normalizePolygonPoints([
    { x: 0.2, y: 0.2 },
    { x: '0.4', y: 0.3 },
    { x: '', y: 0.3 },
    { x: '   ', y: 0.3 },
    { x: false, y: 0.3 },
    { x: [], y: 0.3 },
    { x: 'bad', y: 0.3 },
    { x: 0.4, y: Infinity },
    { x: 0.5 },
    { y: 0.6 },
    null,
    { x: 0.7, y: 0.8 },
  ]);

  assert.deepEqual(points, [
    { x: 0.2, y: 0.2 },
    { x: 0.7, y: 0.8 },
  ]);
});

test('hit tests panorama polygon AOIs with optional analysis padding', () => {
  const points = [
    { yaw: -20, pitch: -10 },
    { yaw: 20, pitch: -10 },
    { yaw: 20, pitch: 10 },
    { yaw: -20, pitch: 10 },
  ];
  const keys = { x: 'yaw', y: 'pitch' };
  const aoi = {
    id: 'pan-object',
    label: 'Panorama object',
    color: '#ffd166',
    space: 'panorama',
    shape: 'polygon',
    analysisPadding: 2,
    points,
  };

  assert.equal(isPointInPolygon({ yaw: 0, pitch: 0 }, points, keys), true);
  assert.equal(isPointInPolygon({ yaw: 30, pitch: 0 }, points, keys), false);
  assert.equal(distanceToPolygonEdges({ yaw: 0, pitch: 11 }, points, keys), 1);
  assert.equal(pointHitsPolygonAoi({ yaw: 0, pitch: 0 }, aoi), true);
  assert.equal(pointHitsPolygonAoi({ yaw: 0, pitch: 11 }, aoi), true);
  assert.equal(pointHitsPolygonAoi({ yaw: 0, pitch: 14 }, aoi), false);
});

test('hit tests panorama polygon AOIs with viewport-converted pixel padding', () => {
  const points = [
    { yaw: -20, pitch: -10 },
    { yaw: 20, pitch: -10 },
    { yaw: 20, pitch: 10 },
    { yaw: -20, pitch: 10 },
  ];
  const aoi = {
    id: 'pan-object-px',
    label: 'Panorama object with pixel padding',
    color: '#ffd166',
    space: 'panorama',
    shape: 'polygon',
    analysisPaddingPx: 8,
    points,
  };
  const viewport = { width: 720, height: 360 };

  assert.equal(pointHitsPolygonAoi({ yaw: 0, pitch: 13 }, aoi, viewport), true);
  assert.equal(pointHitsPolygonAoi({ yaw: 0, pitch: 15 }, aoi, viewport), false);
});

test('hit tests panorama polygons across the yaw seam', () => {
  const points = [
    { yaw: 170, pitch: -10 },
    { yaw: -170, pitch: -10 },
    { yaw: -170, pitch: 10 },
    { yaw: 170, pitch: 10 },
  ];
  const keys = { x: 'yaw', y: 'pitch' };
  const aoi = {
    id: 'seam-object',
    label: 'Seam object',
    color: '#ffd166',
    space: 'panorama',
    shape: 'polygon',
    analysisPadding: 2,
    points,
  };

  assert.equal(isPointInPolygon({ yaw: 180, pitch: 0 }, points, keys), true);
  assert.equal(isPointInPolygon({ yaw: -180, pitch: 0 }, points, keys), true);
  assert.equal(isPointInPolygon({ yaw: 0, pitch: 0 }, points, keys), false);
  assert.equal(distanceToPolygonEdges({ yaw: 169, pitch: 0 }, points, keys), 1);
  assert.equal(distanceToPolygonEdges({ yaw: -169, pitch: 0 }, points, keys), 1);
  assert.equal(pointHitsPolygonAoi({ yaw: 169, pitch: 0 }, aoi), true);
  assert.equal(pointHitsPolygonAoi({ yaw: -169, pitch: 0 }, aoi), true);
  assert.equal(pointHitsPolygonAoi({ yaw: 166, pitch: 0 }, aoi), false);
});
