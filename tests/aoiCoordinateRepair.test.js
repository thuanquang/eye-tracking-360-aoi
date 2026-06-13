import test from 'node:test';
import assert from 'node:assert/strict';

import {
  rotatePanoramaAoiYaw,
  rotatePanoramaProjectYaw,
} from '../src/aois/aoiCoordinateRepair.js';

test('rotates panorama polygon points and keyframes by the requested yaw offset', () => {
  const repaired = rotatePanoramaAoiYaw({
    id: 'temple',
    label: 'Temple',
    color: '#ffd166',
    shape: 'polygon',
    space: 'panorama',
    yawMin: 30,
    yawMax: 60,
    pitchMin: -10,
    pitchMax: 20,
    points: [
      { yaw: 30, pitch: -10 },
      { yaw: 60, pitch: -10 },
      { yaw: 45, pitch: 20 },
    ],
    keyframes: [{
      t: 0,
      points: [
        { yaw: 30, pitch: -10 },
        { yaw: 60, pitch: -10 },
        { yaw: 45, pitch: 20 },
      ],
    }],
  }, 180);

  assert.deepEqual(repaired.points, [
    { yaw: -150, pitch: -10 },
    { yaw: -120, pitch: -10 },
    { yaw: -135, pitch: 20 },
  ]);
  assert.deepEqual(repaired.keyframes[0].points, repaired.points);
  assert.equal(repaired.yawMin, -150);
  assert.equal(repaired.yawMax, -120);
});

test('does not rotate video-space AOIs', () => {
  const aoi = {
    id: 'screen',
    label: 'Screen',
    color: '#5eb1bf',
    shape: 'polygon',
    space: 'video',
    xMin: 0.1,
    xMax: 0.2,
    yMin: 0.3,
    yMax: 0.4,
    points: [{ x: 0.1, y: 0.3 }, { x: 0.2, y: 0.3 }, { x: 0.2, y: 0.4 }],
  };

  assert.deepEqual(rotatePanoramaAoiYaw(aoi, 180), aoi);
});

test('normalizes flat project source metadata without adding coordinate repair', () => {
  const project = rotatePanoramaProjectYaw({
    source: {
      0: 'r',
      1: 'u',
      2: 'n',
      postprocess: 'aoiPostprocess',
    },
    video: { name: 'flat.mp4', projection: 'flat' },
    aois: [{
      id: 'screen',
      label: 'Screen',
      color: '#5eb1bf',
      shape: 'polygon',
      space: 'video',
      points: [{ x: 0.1, y: 0.3 }, { x: 0.2, y: 0.3 }, { x: 0.2, y: 0.4 }],
    }],
  });

  assert.deepEqual(project.source, {
    method: 'run',
    postprocess: 'aoiPostprocess',
  });
  assert.equal(project.aois[0].points[0].x, 0.1);
});

test('rotates only equirectangular project AOIs and records repair metadata', () => {
  const project = rotatePanoramaProjectYaw({
    video: { name: 'clip.mp4', projection: 'equirectangular' },
    aois: [{
      id: 'boat',
      label: 'Boat',
      color: '#f7a072',
      yawMin: 170,
      yawMax: -170,
      pitchMin: -5,
      pitchMax: 5,
      keyframes: [{ t: 0, yawMin: 170, yawMax: -170, pitchMin: -5, pitchMax: 5 }],
    }],
  }, 180);

  assert.equal(project.aois[0].yawMin, -10);
  assert.equal(project.aois[0].yawMax, 10);
  assert.equal(project.aois[0].keyframes[0].yawMin, -10);
  assert.equal(project.aois[0].keyframes[0].yawMax, 10);
  assert.deepEqual(project.source.coordinateRepair, {
    yawOffsetDegrees: 180,
    reason: 'align-runpod-panorama-yaw-to-app-viewer',
  });
});

test('defaults RunPod panorama repair to the app viewer yaw offset', () => {
  const project = rotatePanoramaProjectYaw({
    source: 'runpod-auto-aoi',
    video: { name: 'clip.mp4', projection: 'equirectangular' },
    aois: [{
      id: 'center',
      label: 'Center',
      color: '#ffd166',
      shape: 'polygon',
      space: 'panorama',
      points: [{ yaw: 0, pitch: 0 }, { yaw: 10, pitch: 0 }, { yaw: 0, pitch: 10 }],
      keyframes: [{
        t: 0,
        points: [{ yaw: 0, pitch: 0 }, { yaw: 10, pitch: 0 }, { yaw: 0, pitch: 10 }],
      }],
    }],
  });

  assert.deepEqual(project.aois[0].points, [
    { yaw: -90, pitch: 0 },
    { yaw: -80, pitch: 0 },
    { yaw: -90, pitch: 10 },
  ]);
  assert.equal(project.source.method, 'runpod-auto-aoi');
  assert.deepEqual(project.source.coordinateRepair, {
    yawOffsetDegrees: -90,
    reason: 'align-runpod-panorama-yaw-to-app-viewer',
  });
});

test('normalizes indexed-character source metadata during repair', () => {
  const project = rotatePanoramaProjectYaw({
    source: {
      0: 'r',
      1: 'u',
      2: 'n',
      3: 'p',
      4: 'o',
      5: 'd',
      postprocess: 'aoiPostprocess',
    },
    video: { name: 'clip.mp4', projection: 'equirectangular' },
    aois: [{
      id: 'center',
      label: 'Center',
      color: '#ffd166',
      shape: 'polygon',
      space: 'panorama',
      points: [{ yaw: 0, pitch: 0 }, { yaw: 10, pitch: 0 }, { yaw: 0, pitch: 10 }],
    }],
  });

  assert.equal(project.source.method, 'runpod');
  assert.equal(project.source.postprocess, 'aoiPostprocess');
  assert.deepEqual(project.source.coordinateRepair, {
    yawOffsetDegrees: -90,
    reason: 'align-runpod-panorama-yaw-to-app-viewer',
  });
});
