import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildClipFileName,
  buildPreviewFrames,
  buildV360Filter,
  parseCsvNumbers,
} from '../scripts/modern_city_clip_tool.mjs';

test('parses comma-separated numbers for preview sweeps', () => {
  assert.deepEqual(parseCsvNumbers('-180,-150,0,45'), [-180, -150, 0, 45]);
  assert.deepEqual(parseCsvNumbers(''), []);
});

test('builds preview frames from time, yaw, pitch, and field-of-view sweeps', () => {
  assert.deepEqual(
    buildPreviewFrames({
      timeSec: 12,
      yaws: [-180, -150],
      pitches: [0, 8],
      hFov: 100,
      vFov: 58,
    }),
    [
      { timeSec: 12, yaw: -180, pitch: 0, hFov: 100, vFov: 58 },
      { timeSec: 12, yaw: -180, pitch: 8, hFov: 100, vFov: 58 },
      { timeSec: 12, yaw: -150, pitch: 0, hFov: 100, vFov: 58 },
      { timeSec: 12, yaw: -150, pitch: 8, hFov: 100, vFov: 58 },
    ],
  );
});

test('builds v360 filter strings for consistent 2D exports', () => {
  assert.equal(
    buildV360Filter({ yaw: -175, pitch: 5, hFov: 100, vFov: 58, width: 1920, height: 1080 }),
    'v360=input=equirect:output=flat:yaw=-175:pitch=5:h_fov=100:v_fov=58:w=1920:h=1080',
  );
});

test('names custom clips from chosen timing and view settings', () => {
  assert.equal(
    buildClipFileName({ startSec: 45, durationSec: 30, yaw: -175, pitch: 5, hFov: 100 }),
    'nguyen-hue-2d-custom-0045-0115-yaw-175-pitch5-fov100.mp4',
  );
});
