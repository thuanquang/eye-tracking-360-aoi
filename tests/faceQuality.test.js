import test from 'node:test';
import assert from 'node:assert/strict';

import {
  compareFacePoseToBaseline,
  normalizeFaceQualitySummary,
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

test('rejects malformed current face summaries', () => {
  const baseline = summarizeFaceBox({ x: 100, y: 50, width: 200, height: 160 });

  assert.deepEqual(
    compareFacePoseToBaseline({
      centerY: baseline.centerY,
      width: baseline.width,
      height: baseline.height,
      area: baseline.area,
    }, baseline),
    { accepted: false, reasons: ['missing-face'] },
  );
});

test('rejects malformed baseline face summaries', () => {
  const current = summarizeFaceBox({ x: 100, y: 50, width: 200, height: 160 });

  assert.deepEqual(
    compareFacePoseToBaseline(current, {
      centerX: current.centerX,
      centerY: current.centerY,
      width: current.width,
      height: current.height,
      area: Number.NaN,
    }),
    { accepted: false, reasons: ['missing-face'] },
  );
});

test('normalizes valid summaries and raw face boxes only', () => {
  assert.deepEqual(
    normalizeFaceQualitySummary({ x: 100, y: 50, width: 200, height: 160 }),
    { centerX: 200, centerY: 130, width: 200, height: 160, area: 32000 },
  );

  assert.deepEqual(
    normalizeFaceQualitySummary({ centerX: 200, centerY: 130, width: 200, height: 160, area: 32000 }),
    { centerX: 200, centerY: 130, width: 200, height: 160, area: 32000 },
  );

  assert.equal(
    normalizeFaceQualitySummary({ centerX: Number.NaN, centerY: 130, width: 200, height: 160, area: 32000 }),
    null,
  );
});
