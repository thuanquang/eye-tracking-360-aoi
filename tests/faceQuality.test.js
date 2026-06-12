import test from 'node:test';
import assert from 'node:assert/strict';

import {
  compareFacePoseToBaseline,
  summarizeFaceBox,
} from '../src/gaze/faceQuality.js';

test('summarizes face box center and scale', () => {
  assert.deepEqual(
    summarizeFaceBox({ x: 100, y: 50, width: 200, height: 160 }),
    { centerX: 200, centerY: 130, width: 200, height: 160, area: 32000 },
  );
});

test('detects face drift from calibration baseline', () => {
  const baseline = summarizeFaceBox({ x: 100, y: 50, width: 200, height: 160 });
  const current = summarizeFaceBox({ x: 180, y: 80, width: 160, height: 128 });

  const drift = compareFacePoseToBaseline(current, baseline, {
    maxCenterShiftRatio: 0.2,
    maxScaleChangeRatio: 0.18,
  });

  assert.equal(drift.accepted, false);
  assert.deepEqual(drift.reasons.sort(), ['center-shift', 'scale-change']);
});
