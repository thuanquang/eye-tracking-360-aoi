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
