import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildGridCalibrationPoints,
  getCalibrationProfile,
  getCalibrationSamplesPerPoint,
} from '../src/gaze/calibrationTargets.js';

test('builds evenly distributed grid calibration points', () => {
  const points = buildGridCalibrationPoints({
    columns: 7,
    rows: 5,
    minPercent: 10,
    maxPercent: 90,
    includeCenterRepeat: true,
  });

  assert.equal(points.length, 36);
  assert.deepEqual(points[0], { x: 10, y: 10 });
  assert.deepEqual(points.at(-1), { x: 50, y: 50 });
});

test('exposes standard and research calibration profiles', () => {
  assert.equal(getCalibrationProfile('standard').calibrationPoints.length >= 14, true);
  assert.equal(getCalibrationProfile('research-39').calibrationPoints.length, 39);
  assert.equal(getCalibrationProfile('research-78').calibrationPoints.length, 78);
});

test('caps repeated WebGazer training records for dense calibration profiles', () => {
  const standard = getCalibrationProfile('standard');
  const research39 = getCalibrationProfile('research-39');
  const research78 = getCalibrationProfile('research-78');

  assert.equal(standard.samplesPerPoint, 12);
  assert.equal(research39.samplesPerPoint, 8);
  assert.equal(research78.samplesPerPoint, 4);
  assert.equal(research39.calibrationPoints.length * research39.samplesPerPoint, 312);
  assert.equal(research78.calibrationPoints.length * research78.samplesPerPoint, 312);
});

test('resolves profile-specific calibration sample budgets with fallback', () => {
  assert.equal(getCalibrationSamplesPerPoint('standard', 12), 12);
  assert.equal(getCalibrationSamplesPerPoint('research-39', 12), 8);
  assert.equal(getCalibrationSamplesPerPoint('research-78', 12), 4);
  assert.equal(getCalibrationSamplesPerPoint('missing-profile', 12), 12);
});

test('keeps research 39 supplemental points spatially distributed', () => {
  const points = getCalibrationProfile('research-39').calibrationPoints;
  const centerRepeatCount = points.filter((point) => point.x === 50 && point.y === 50).length;

  assert.equal(centerRepeatCount, 2);
  assert.deepEqual(points.slice(-3), [
    { x: 20, y: 50 },
    { x: 80, y: 50 },
    { x: 50, y: 20 },
  ]);
});
