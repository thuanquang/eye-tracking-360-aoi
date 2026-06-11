import test from 'node:test';
import assert from 'node:assert/strict';

import {
  summarizeGazeStreamQuality,
  updateGazeStreamStats,
} from '../src/gaze/qualityMonitor.js';

test('tracks sample rate, accepted rate, and dropped reasons', () => {
  let stats = null;

  stats = updateGazeStreamStats(stats, { atMs: 0, accepted: true });
  stats = updateGazeStreamStats(stats, { atMs: 20, accepted: true });
  stats = updateGazeStreamStats(stats, { atMs: 40, accepted: false, reason: 'stale' });
  stats = updateGazeStreamStats(stats, { atMs: 60, accepted: true });

  const summary = summarizeGazeStreamQuality(stats);

  assert.equal(summary.totalEvents, 4);
  assert.equal(summary.acceptedEvents, 3);
  assert.equal(summary.droppedEvents, 1);
  assert.equal(summary.droppedReasons.stale, 1);
  assert.equal(summary.effectiveHz, 50);
  assert.equal(summary.dataIntegrityPercent, 75);
});
