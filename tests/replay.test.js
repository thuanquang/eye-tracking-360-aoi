import test from 'node:test';
import assert from 'node:assert/strict';

import {
  extractRecordingSamplesFromJson,
  findReviewSampleIndex,
  getReviewTimeWindow,
  isValidReviewSample,
} from '../src/recording/replay.js';

test('validates replay samples with time and panorama point', () => {
  assert.equal(isValidReviewSample({ t: 0, panorama: { yaw: 1, pitch: 2 } }), true);
  assert.equal(isValidReviewSample({ t: 0, screen: { x: 1, y: 2 } }), false);
});

test('extracts samples from exported recording JSON', () => {
  const samples = [{ t: 0, panorama: { yaw: 1, pitch: 2 } }];

  assert.deepEqual(extractRecordingSamplesFromJson({ samples }), samples);
});

test('finds nearest replay sample by time', () => {
  const samples = [
    { t: 0, panorama: { yaw: 0, pitch: 0 } },
    { t: 1, panorama: { yaw: 1, pitch: 0 } },
    { t: 2, panorama: { yaw: 2, pitch: 0 } },
  ];

  assert.equal(findReviewSampleIndex(samples, 1.2), 1);
  assert.equal(findReviewSampleIndex(samples, 1.8), 2);
});

test('computes review window from sorted samples', () => {
  assert.deepEqual(
    getReviewTimeWindow([{ t: 2 }, { t: 0.5 }, { t: 1 }]),
    { start: 0.5, end: 2 },
  );
});
