import test from 'node:test';
import assert from 'node:assert/strict';

import {
  shouldRecordGazeStreamDrop,
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

test('keeps accepted rate at zero when no events are accepted', () => {
  let stats = null;

  stats = updateGazeStreamStats(stats, { atMs: 0, accepted: false, reason: 'stale' });
  stats = updateGazeStreamStats(stats, { atMs: 20, accepted: false, reason: 'stale' });
  stats = updateGazeStreamStats(stats, { atMs: 40, accepted: false, reason: 'out-of-bounds' });

  const summary = summarizeGazeStreamQuality(stats);

  assert.equal(summary.acceptedEvents, 0);
  assert.equal(summary.acceptedHz, 0);
  assert.equal(summary.dataIntegrityPercent, 0);
});

test('keeps accepted rate at zero with only one accepted event', () => {
  let stats = null;

  stats = updateGazeStreamStats(stats, { atMs: 0, accepted: false, reason: 'stale' });
  stats = updateGazeStreamStats(stats, { atMs: 20, accepted: true });
  stats = updateGazeStreamStats(stats, { atMs: 40, accepted: false, reason: 'stale' });

  const summary = summarizeGazeStreamQuality(stats);

  assert.equal(summary.acceptedEvents, 1);
  assert.equal(summary.acceptedHz, 0);
  assert.equal(summary.dataIntegrityPercent, 33.33);
});

test('keeps full-session counters when recent event window is truncated', () => {
  let stats = null;

  stats = updateGazeStreamStats(stats, { atMs: 0, accepted: true }, { maxEvents: 3 });
  stats = updateGazeStreamStats(stats, { atMs: 20, accepted: false, reason: 'stale' }, { maxEvents: 3 });
  stats = updateGazeStreamStats(stats, { atMs: 40, accepted: true }, { maxEvents: 3 });
  stats = updateGazeStreamStats(stats, { atMs: 60, accepted: false, reason: 'stale' }, { maxEvents: 3 });
  stats = updateGazeStreamStats(stats, { atMs: 80, accepted: false, reason: 'jump' }, { maxEvents: 3 });

  const summary = summarizeGazeStreamQuality(stats);

  assert.equal(stats.events.length, 3);
  assert.equal(summary.totalEvents, 5);
  assert.equal(summary.acceptedEvents, 2);
  assert.equal(summary.droppedEvents, 3);
  assert.equal(summary.droppedReasons.stale, 2);
  assert.equal(summary.droppedReasons.jump, 1);
  assert.equal(summary.windowEventCount, 3);
  assert.equal(summary.windowed, true);
});

test('summarizes on-screen and off-screen event counts', () => {
  let stats = null;

  stats = updateGazeStreamStats(stats, { atMs: 0, accepted: true, onScreen: true });
  stats = updateGazeStreamStats(stats, { atMs: 20, accepted: false, reason: 'out-of-bounds', onScreen: false });
  stats = updateGazeStreamStats(stats, { atMs: 40, accepted: true, onScreen: true });
  stats = updateGazeStreamStats(stats, { atMs: 60, accepted: false, reason: 'lost' });

  const summary = summarizeGazeStreamQuality(stats);

  assert.equal(summary.onScreenEvents, 2);
  assert.equal(summary.offScreenEvents, 1);
  assert.equal(summary.onScreenPercent, 66.67);
});

test('bounds repeated stale drop telemetry by interval', () => {
  let stats = null;

  stats = updateGazeStreamStats(stats, { atMs: 1000, accepted: false, reason: 'stale' });

  assert.equal(shouldRecordGazeStreamDrop(stats, { atMs: 1200, reason: 'stale' }, 450), false);
  assert.equal(shouldRecordGazeStreamDrop(stats, { atMs: 1450, reason: 'stale' }, 450), true);
  assert.equal(shouldRecordGazeStreamDrop(stats, { atMs: 1200, reason: 'jump' }, 450), true);
});
