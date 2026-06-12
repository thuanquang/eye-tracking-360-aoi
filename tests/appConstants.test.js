import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_VALIDATION_MAX_AGE_MS,
  GAZE_TIMING,
  RECORDING_SAMPLE_INTERVAL_MS,
} from '../src/app/constants.js';

test('exports stable timing constants used by the app shell', () => {
  assert.equal(RECORDING_SAMPLE_INTERVAL_MS, 1000 / 30);
  assert.equal(DEFAULT_VALIDATION_MAX_AGE_MS, 5 * 60 * 1000);
  assert.deepEqual(GAZE_TIMING, {
    freshGazeMaxAgeMs: 180,
    liveGazeStaleMs: 450,
    liveGazeHoldMs: 1350,
    targetSettleDelayMs: 250,
    targetSampleDelayMs: 55,
  });
});
