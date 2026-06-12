import test from 'node:test';
import assert from 'node:assert/strict';

import { detectFixationsByDispersion } from '../src/recording/fixations.js';

test('detects fixation clusters by dispersion and duration', () => {
  const samples = [
    { t: 0.00, screen: { x: 100, y: 100 } },
    { t: 0.05, screen: { x: 103, y: 98 } },
    { t: 0.10, screen: { x: 101, y: 102 } },
    { t: 0.15, screen: { x: 105, y: 99 } },
    { t: 0.20, screen: { x: 400, y: 300 } },
  ];

  const fixations = detectFixationsByDispersion(samples, {
    maxDispersionPx: 35,
    minDurationMs: 100,
  });

  assert.equal(fixations.length, 1);
  assert.equal(fixations[0].startSec, 0);
  assert.equal(fixations[0].endSec, 0.15);
  assert.equal(Math.round(fixations[0].centroid.x), 102);
});

test('ignores samples without finite screen coordinates', () => {
  const fixations = detectFixationsByDispersion([
    { t: 0, screen: { x: 20, y: 20 } },
    { t: 0.05, screen: { x: Number.NaN, y: 20 } },
    { t: 0.10, screen: { x: 22, y: 24 } },
    { t: 0.15, screen: { x: 23, y: 21 } },
  ], {
    maxDispersionPx: 20,
    minDurationMs: 100,
  });

  assert.equal(fixations.length, 1);
  assert.equal(fixations[0].sampleCount, 3);
  assert.equal(fixations[0].durationMs, 150);
});
