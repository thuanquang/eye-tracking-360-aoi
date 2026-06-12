import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildColabAoiJob,
  detectionsToAois,
  getStereoFrameRect,
  pixelBoxToAoiKeyframe,
} from '../src/aois/aoiGeneration.js';

test('builds a Colab auto-AOI job from video metadata and prompts', () => {
  const job = buildColabAoiJob({
    video: {
      name: 'demo.mp4',
      durationSec: 12.5,
      projection: 'equirectangular',
      stereoLayout: 'top-bottom',
    },
    prompts: 'person\nscreen, sign',
    sampleIntervalSec: 0.75,
  });

  assert.equal(job.kind, 'aoi-colab-job');
  assert.equal(job.version, 1);
  assert.equal(job.video.name, 'demo.mp4');
  assert.equal(job.video.projection, 'equirectangular');
  assert.equal(job.video.stereoLayout, 'top-bottom');
  assert.deepEqual(job.aoiPolicy.prompts, ['person', 'screen', 'sign']);
  assert.equal(job.aoiPolicy.sampleIntervalSec, 0.75);
  assert.equal(job.aoiPolicy.output, 'aoi-json');
  assert.equal(job.aoiPolicy.outputShape, 'polygon');
  assert.equal(job.aoiPolicy.detectorModel, 'microsoft/Florence-2-base');
  assert.equal(job.aoiPolicy.segmenterModel, 'facebook/sam2.1-hiera-small');
  assert.equal(job.aoiPolicy.maxPolygonPoints, 80);
  assert.equal(job.aoiPolicy.polygonSimplificationEpsilon, 0.003);
  assert.equal(job.aoiPolicy.analysisPaddingPx, 18);
  assert.equal(job.aoiPolicy.recommendedNotebook, 'notebooks/google-colab-auto-aoi.ipynb');
});

test('sanitizes Colab auto-AOI polygon policy numbers conservatively', () => {
  const highJob = buildColabAoiJob({
    maxPolygonPoints: 999,
    polygonSimplificationEpsilon: 0.1,
    analysisPaddingPx: 999,
  });
  assert.equal(highJob.aoiPolicy.maxPolygonPoints, 240);
  assert.equal(highJob.aoiPolicy.polygonSimplificationEpsilon, 0.02);
  assert.equal(highJob.aoiPolicy.analysisPaddingPx, 128);

  const lowJob = buildColabAoiJob({
    maxPolygonPoints: -5,
    polygonSimplificationEpsilon: 0,
    analysisPaddingPx: -12,
  });
  assert.equal(lowJob.aoiPolicy.maxPolygonPoints, 12);
  assert.equal(lowJob.aoiPolicy.polygonSimplificationEpsilon, 0.001);
  assert.equal(lowJob.aoiPolicy.analysisPaddingPx, 0);

  const fractionalJob = buildColabAoiJob({
    maxPolygonPoints: 37.6,
    polygonSimplificationEpsilon: 0.0034567,
    analysisPaddingPx: 18.4,
  });
  assert.equal(fractionalJob.aoiPolicy.maxPolygonPoints, 38);
  assert.equal(fractionalJob.aoiPolicy.polygonSimplificationEpsilon, 0.003457);
  assert.equal(fractionalJob.aoiPolicy.analysisPaddingPx, 18);

  const fallbackJob = buildColabAoiJob({
    maxPolygonPoints: Number.NaN,
    polygonSimplificationEpsilon: Number.POSITIVE_INFINITY,
    analysisPaddingPx: 'not-a-number',
  });
  assert.equal(fallbackJob.aoiPolicy.maxPolygonPoints, 80);
  assert.equal(fallbackJob.aoiPolicy.polygonSimplificationEpsilon, 0.003);
  assert.equal(fallbackJob.aoiPolicy.analysisPaddingPx, 18);
});

test('converts flat video pixel boxes to normalized AOI keyframes', () => {
  const keyframe = pixelBoxToAoiKeyframe({
    t: 2,
    box: { x: 320, y: 180, width: 320, height: 180 },
    videoWidth: 1280,
    videoHeight: 720,
    projection: 'flat',
    stereoLayout: 'mono',
  });

  assert.deepEqual(keyframe, {
    t: 2,
    xMin: 0.25,
    xMax: 0.5,
    yMin: 0.25,
    yMax: 0.5,
  });
});

test('converts equirectangular boxes to yaw and pitch keyframes', () => {
  const keyframe = pixelBoxToAoiKeyframe({
    t: 0,
    box: { x: 0, y: 0, width: 960, height: 540 },
    videoWidth: 1920,
    videoHeight: 1080,
    projection: 'equirectangular',
    stereoLayout: 'mono',
  });

  assert.deepEqual(keyframe, {
    t: 0,
    yawMin: -180,
    yawMax: 0,
    pitchMin: 0,
    pitchMax: 90,
  });
});

test('resolves stereo eye frame rectangles', () => {
  assert.deepEqual(
    getStereoFrameRect({
      videoWidth: 3840,
      videoHeight: 1920,
      stereoLayout: 'side-by-side',
      eye: 'right',
    }),
    { x: 1920, y: 0, width: 1920, height: 1920 },
  );
  assert.deepEqual(
    getStereoFrameRect({
      videoWidth: 3840,
      videoHeight: 1920,
      stereoLayout: 'top-bottom',
      eye: 'left',
    }),
    { x: 0, y: 0, width: 3840, height: 960 },
  );
});

test('groups detections into generated AOIs with keyframes', () => {
  const aois = detectionsToAois({
    detections: [
      {
        label: 'Screen',
        t: 0,
        box: { x: 100, y: 50, width: 200, height: 100 },
        confidence: 0.91,
      },
      {
        label: 'Screen',
        t: 1,
        box: { x: 120, y: 55, width: 200, height: 100 },
        confidence: 0.87,
      },
    ],
    video: {
      width: 1000,
      height: 500,
      projection: 'flat',
      stereoLayout: 'mono',
    },
  });

  assert.equal(aois.length, 1);
  assert.equal(aois[0].id, 'screen');
  assert.equal(aois[0].space, 'video');
  assert.equal(aois[0].keyframes.length, 2);
  assert.equal(aois[0].generated.method, 'google-colab-auto-aoi');
});

test('groups polygon detections into generated AOIs', () => {
  const aois = detectionsToAois({
    detections: [
      {
        label: 'Person',
        t: 0,
        shape: 'polygon',
        points: [
          { x: 0.1, y: 0.1 },
          { x: 0.2, y: 0.1 },
          { x: 0.2, y: 0.3 },
          { x: 0.1, y: 0.3 },
        ],
        confidence: 0.91,
      },
      {
        label: 'Person',
        t: 1,
        shape: 'polygon',
        points: [
          { x: 0.12, y: 0.12 },
          { x: 0.23, y: 0.12 },
          { x: 0.23, y: 0.32 },
          { x: 0.12, y: 0.32 },
        ],
        confidence: 0.88,
      },
    ],
    video: {
      width: 1000,
      height: 500,
      projection: 'flat',
      stereoLayout: 'mono',
    },
  });

  assert.equal(aois[0].shape, 'polygon');
  assert.equal(aois[0].points.length, 4);
  assert.equal(aois[0].keyframes.length, 2);
});

test('splits same-label box and polygon detections into shape-specific AOIs', () => {
  const aois = detectionsToAois({
    detections: [
      {
        label: 'Person',
        t: 0,
        shape: 'polygon',
        points: [
          { x: 0.1, y: 0.1 },
          { x: 0.2, y: 0.1 },
          { x: 0.2, y: 0.3 },
          { x: 0.1, y: 0.3 },
        ],
        confidence: 0.91,
      },
      {
        label: 'Person',
        t: 1,
        box: { x: 100, y: 50, width: 200, height: 100 },
        confidence: 0.87,
      },
      {
        label: 'Person',
        t: 2,
        shape: 'polygon',
        points: [
          { x: 0.12, y: 0.12 },
          { x: 0.23, y: 0.12 },
          { x: 0.23, y: 0.32 },
          { x: 0.12, y: 0.32 },
        ],
        confidence: 0.88,
      },
    ],
    video: {
      width: 1000,
      height: 500,
      projection: 'flat',
      stereoLayout: 'mono',
    },
  });

  assert.equal(aois.length, 2);
  assert.deepEqual(aois.map((aoi) => aoi.id).sort(), ['person-box', 'person-polygon']);

  const polygonAoi = aois.find((aoi) => aoi.shape === 'polygon');
  const boxAoi = aois.find((aoi) => aoi.shape === 'box');

  assert.equal(polygonAoi.keyframes.length, 2);
  assert.equal(boxAoi.keyframes.length, 1);
  assert.ok(polygonAoi.keyframes.every((keyframe) => Array.isArray(keyframe.points)));
  assert.ok(boxAoi.keyframes.every((keyframe) => Number.isFinite(keyframe.xMin)));
});

test('deduplicates shape-suffixed AOI ids that collide with generated label ids', () => {
  const aois = detectionsToAois({
    detections: [
      {
        label: 'Person',
        t: 0,
        shape: 'polygon',
        points: [
          { x: 0.1, y: 0.1 },
          { x: 0.2, y: 0.1 },
          { x: 0.2, y: 0.3 },
          { x: 0.1, y: 0.3 },
        ],
        confidence: 0.91,
      },
      {
        label: 'Person',
        t: 1,
        box: { x: 100, y: 50, width: 200, height: 100 },
        confidence: 0.87,
      },
      {
        label: 'Person box',
        t: 2,
        box: { x: 400, y: 50, width: 120, height: 90 },
        confidence: 0.81,
      },
    ],
    video: {
      width: 1000,
      height: 500,
      projection: 'flat',
      stereoLayout: 'mono',
    },
  });

  assert.equal(aois.length, 3);
  assert.deepEqual(aois.map((aoi) => aoi.id), [
    'person-polygon',
    'person-box',
    'person-box-2',
  ]);
  assert.equal(new Set(aois.map((aoi) => aoi.id)).size, aois.length);
});

test('converts equirectangular normalized polygon points to yaw and pitch', () => {
  const aois = detectionsToAois({
    detections: [
      {
        label: 'Sign',
        t: 2,
        shape: 'polygon',
        points: [
          { x: 0, y: 0 },
          { x: 0.5, y: 0 },
          { x: 0.5, y: 0.5 },
          { x: 0, y: 0.5 },
        ],
        confidence: 0.77,
      },
    ],
    video: {
      width: 1920,
      height: 1080,
      projection: 'equirectangular',
      stereoLayout: 'mono',
    },
  });

  assert.equal(aois[0].space, 'panorama');
  assert.deepEqual(aois[0].points, [
    { yaw: -180, pitch: 90 },
    { yaw: 0, pitch: 90 },
    { yaw: 0, pitch: 0 },
    { yaw: -180, pitch: 0 },
  ]);
});

test('preserves direct panorama polygon yaw and pitch points', () => {
  const aois = detectionsToAois({
    detections: [
      {
        label: 'Door',
        t: 3,
        shape: 'polygon',
        points: [
          { yaw: -45, pitch: -10 },
          { yaw: 45, pitch: -10 },
          { yaw: 0, pitch: 20 },
        ],
        confidence: 0.82,
      },
    ],
    video: {
      width: 1920,
      height: 1080,
      projection: 'equirectangular',
      stereoLayout: 'mono',
    },
  });

  assert.equal(aois[0].shape, 'polygon');
  assert.equal(aois[0].space, 'panorama');
  assert.deepEqual(aois[0].points, [
    { yaw: -45, pitch: -10 },
    { yaw: 45, pitch: -10 },
    { yaw: 0, pitch: 20 },
  ]);
});

test('ignores polygon detections with fewer than three valid points', () => {
  const aois = detectionsToAois({
    detections: [
      {
        label: 'Broken',
        t: 0,
        shape: 'polygon',
        points: [
          { x: 0.1, y: 0.1 },
          { x: 0.2, y: Number.NaN },
          { x: 0.3, y: 0.3 },
        ],
        confidence: 0.25,
      },
    ],
    video: {
      width: 1000,
      height: 500,
      projection: 'flat',
      stereoLayout: 'mono',
    },
  });

  assert.deepEqual(aois, []);
});

test('ignores polygon detections with coercion-prone invalid point values', () => {
  const aois = detectionsToAois({
    detections: [
      {
        label: 'Malformed',
        t: 0,
        shape: 'polygon',
        points: [
          { x: 0.1, y: 0.1 },
          { x: '0.2', y: ' 0.2 ' },
          { x: false, y: 0.3 },
          { x: 0.4, y: true },
          { x: '   ', y: 0.5 },
          { x: [], y: 0.6 },
          { x: {}, y: 0.7 },
          { x: null, y: 0.8 },
          { x: 0.9, y: undefined },
          { x: '', y: 1 },
        ],
        confidence: 0.25,
      },
    ],
    video: {
      width: 1000,
      height: 500,
      projection: 'flat',
      stereoLayout: 'mono',
    },
  });

  assert.deepEqual(aois, []);
});
