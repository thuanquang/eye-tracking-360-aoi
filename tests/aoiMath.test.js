import test from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyAoisWithUncertainty,
  hitTestAois,
  normalizeYaw,
  panoramaPointToScreen,
  resolveAoisAtTime,
  screenPointToVideoPoint,
  screenPointToYawPitch,
  screenUncertaintyToYawPitch,
} from '../src/aois/aoiMath.js';

test('normalizes yaw to the -180..180 range', () => {
  assert.equal(normalizeYaw(190), -170);
  assert.equal(normalizeYaw(-190), 170);
  assert.equal(normalizeYaw(540), 180);
});

test('maps center screen point to the panorama yaw under the Three.js camera', () => {
  const result = screenPointToYawPitch({
    x: 960,
    y: 540,
    width: 1920,
    height: 1080,
    cameraYaw: 35,
    cameraPitch: -8,
    fov: 75,
  });

  assert.equal(Math.round(result.yaw), -35);
  assert.equal(Math.round(result.pitch), -8);
});

test('moves right and left screen points to different yaw values', () => {
  const base = {
    y: 540,
    width: 1920,
    height: 1080,
    cameraYaw: 0,
    cameraPitch: 0,
    fov: 75,
  };

  const left = screenPointToYawPitch({ ...base, x: 240 });
  const right = screenPointToYawPitch({ ...base, x: 1680 });

  assert.ok(left.yaw < 0);
  assert.ok(right.yaw > 0);
  assert.ok(Math.abs(left.yaw + right.yaw) < 0.001);
});

test('projects panorama yaw and pitch back to screen coordinates', () => {
  const viewport = {
    width: 1280,
    height: 720,
    cameraYaw: 28,
    cameraPitch: -6,
    fov: 75,
  };
  const original = { x: 840, y: 310 };
  const panorama = screenPointToYawPitch({
    ...original,
    ...viewport,
  });
  const projected = panoramaPointToScreen({
    ...panorama,
    ...viewport,
  });

  assert.ok(Math.abs(projected.x - original.x) < 0.001);
  assert.ok(Math.abs(projected.y - original.y) < 0.001);
  assert.equal(projected.visible, true);
});

test('centers a panorama yaw using the opposite Three.js camera rotation', () => {
  const projected = panoramaPointToScreen({
    yaw: 42,
    pitch: 12,
    width: 1280,
    height: 720,
    cameraYaw: -42,
    cameraPitch: 12,
    fov: 75,
  });

  assert.ok(Math.abs(projected.x - 640) < 0.001);
  assert.ok(Math.abs(projected.y - 360) < 0.001);
  assert.equal(projected.visible, true);
});

test('keeps panorama projection anchored when the camera is pitched', () => {
  const viewport = {
    width: 1920,
    height: 1080,
    cameraYaw: 0,
    cameraPitch: 60,
    fov: 75,
  };
  const original = { x: 1680, y: 540 };
  const panorama = screenPointToYawPitch({
    ...original,
    ...viewport,
  });
  const projected = panoramaPointToScreen({
    ...panorama,
    ...viewport,
  });

  assert.ok(panorama.pitch < 45);
  assert.ok(Math.abs(projected.x - original.x) < 0.001);
  assert.ok(Math.abs(projected.y - original.y) < 0.001);
  assert.equal(projected.visible, true);
});

test('marks panorama points outside the current camera view as hidden', () => {
  const projected = panoramaPointToScreen({
    yaw: 150,
    pitch: 0,
    width: 1280,
    height: 720,
    cameraYaw: 0,
    cameraPitch: 0,
    fov: 75,
  });

  assert.equal(projected.visible, false);
});

test('detects AOI hit including wraparound AOIs', () => {
  const hits = hitTestAois({ yaw: -178, pitch: 5 }, [
    {
      id: 'front',
      label: 'Front',
      yawMin: -20,
      yawMax: 20,
      pitchMin: -10,
      pitchMax: 10,
    },
    {
      id: 'panorama-seam',
      label: 'Panorama seam',
      yawMin: 170,
      yawMax: -170,
      pitchMin: -20,
      pitchMax: 20,
    },
  ]);

  assert.deepEqual(
    hits.map((aoi) => aoi.id),
    ['panorama-seam'],
  );
});

test('resolves static and keyframed AOIs at a video time', () => {
  const resolved = resolveAoisAtTime([
    {
      id: 'static',
      label: 'Static',
      yawMin: -10,
      yawMax: 10,
      pitchMin: -5,
      pitchMax: 5,
    },
    {
      id: 'moving',
      label: 'Moving',
      yawMin: 0,
      yawMax: 20,
      pitchMin: -10,
      pitchMax: 10,
      keyframes: [
        { t: 0, yawMin: 0, yawMax: 20, pitchMin: -10, pitchMax: 10 },
        { t: 10, yawMin: 40, yawMax: 60, pitchMin: 10, pitchMax: 30 },
      ],
    },
  ], 5);

  assert.deepEqual(
    resolved.map((aoi) => ({
      id: aoi.id,
      yawMin: aoi.yawMin,
      yawMax: aoi.yawMax,
      pitchMin: aoi.pitchMin,
      pitchMax: aoi.pitchMax,
    })),
    [
      { id: 'static', yawMin: -10, yawMax: 10, pitchMin: -5, pitchMax: 5 },
      { id: 'moving', yawMin: 20, yawMax: 40, pitchMin: 0, pitchMax: 20 },
    ],
  );
});

test('maps screen gaze to normalized flat video coordinates', () => {
  const point = screenPointToVideoPoint({
    x: 640,
    y: 360,
    width: 1280,
    height: 720,
  });

  assert.deepEqual(point, { x: 0.5, y: 0.5 });
});

test('detects normalized video-space AOI hits', () => {
  const hits = hitTestAois({ x: 0.35, y: 0.25 }, [
    {
      id: 'logo',
      label: 'Logo',
      color: '#ffd166',
      space: 'video',
      xMin: 0.2,
      xMax: 0.5,
      yMin: 0.1,
      yMax: 0.4,
    },
  ]);

  assert.deepEqual(hits.map((aoi) => aoi.id), ['logo']);
});

test('resolves keyframed normalized video AOIs at a video time', () => {
  const [resolved] = resolveAoisAtTime([
    {
      id: 'moving-flat',
      label: 'Moving flat',
      color: '#ffd166',
      space: 'video',
      xMin: 0.1,
      xMax: 0.2,
      yMin: 0.3,
      yMax: 0.4,
      keyframes: [
        { t: 0, xMin: 0.1, xMax: 0.2, yMin: 0.3, yMax: 0.4 },
        { t: 10, xMin: 0.3, xMax: 0.5, yMin: 0.5, yMax: 0.8 },
      ],
    },
  ], 5);

  assert.deepEqual({
    xMin: resolved.xMin,
    xMax: resolved.xMax,
    yMin: resolved.yMin,
    yMax: resolved.yMax,
  }, {
    xMin: 0.2,
    xMax: 0.35,
    yMin: 0.4,
    yMax: 0.6,
  });
});

test('interpolates dynamic AOI yaw across the panorama wraparound', () => {
  const [resolved] = resolveAoisAtTime([
    {
      id: 'wrap-moving',
      label: 'Wrap moving',
      yawMin: 170,
      yawMax: -170,
      pitchMin: -10,
      pitchMax: 10,
      keyframes: [
        { t: 0, yawMin: 170, yawMax: -170, pitchMin: -10, pitchMax: 10 },
        { t: 10, yawMin: -170, yawMax: -150, pitchMin: -10, pitchMax: 10 },
      ],
    },
  ], 5);

  assert.equal(resolved.yawMin, 180);
  assert.equal(resolved.yawMax, -160);
});

test('classifies AOIs as likely or ambiguous using angular uncertainty', () => {
  const aois = [
    {
      id: 'center',
      label: 'Center',
      yawMin: -10,
      yawMax: 10,
      pitchMin: -10,
      pitchMax: 10,
    },
    {
      id: 'near-right',
      label: 'Near right',
      yawMin: 12,
      yawMax: 20,
      pitchMin: -10,
      pitchMax: 10,
    },
  ];
  const classification = classifyAoisWithUncertainty(
    { yaw: 8, pitch: 0 },
    aois,
    { yawRadius: 5, pitchRadius: 3 },
  );

  assert.deepEqual(classification.exactHits.map((aoi) => aoi.id), ['center']);
  assert.deepEqual(classification.likelyHits.map((aoi) => aoi.id), []);
  assert.deepEqual(classification.possibleHits.map((aoi) => aoi.id), ['center', 'near-right']);
  assert.deepEqual(classification.ambiguousHits.map((aoi) => aoi.id), ['center', 'near-right']);
});

test('marks deep AOI hits as likely when uncertainty fits within the AOI', () => {
  const classification = classifyAoisWithUncertainty(
    { yaw: 0, pitch: 0 },
    [
      {
        id: 'large-center',
        label: 'Large center',
        yawMin: -20,
        yawMax: 20,
        pitchMin: -20,
        pitchMax: 20,
      },
    ],
    { yawRadius: 5, pitchRadius: 5 },
  );

  assert.deepEqual(classification.likelyHits.map((aoi) => aoi.id), ['large-center']);
  assert.deepEqual(classification.ambiguousHits, []);
});

test('converts screen pixel uncertainty to yaw and pitch uncertainty', () => {
  const uncertainty = screenUncertaintyToYawPitch({
    x: 960,
    y: 540,
    width: 1920,
    height: 1080,
    cameraYaw: 0,
    cameraPitch: 0,
    fov: 75,
    radiusPx: 120,
  });

  assert.ok(uncertainty.yawRadius > 0);
  assert.ok(uncertainty.pitchRadius > 0);
  assert.ok(uncertainty.yawRadius > uncertainty.pitchRadius);
});
