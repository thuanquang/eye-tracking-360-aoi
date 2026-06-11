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
