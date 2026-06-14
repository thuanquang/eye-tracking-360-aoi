import test from 'node:test';
import assert from 'node:assert/strict';

import {
  summarizeDiagnosticTarget,
  summarizeRawGazeDiagnostic,
} from '../src/gaze/rawGazeDiagnostics.js';

const TARGET = { x: 500, y: 300 };

test('summarizes stable raw gaze target samples', () => {
  const result = summarizeDiagnosticTarget({
    target: TARGET,
    samples: [
      { x: 498, y: 301, atMs: 0 },
      { x: 502, y: 299, atMs: 33 },
      { x: 501, y: 300, atMs: 66 },
      { x: 499, y: 300, atMs: 99 },
    ],
    durationMs: 132,
  });

  assert.equal(result.sampleCount, 4);
  assert.equal(result.quality, 'good');
  assert.ok(result.medianJitterPx < 3);
  assert.ok(result.biasPx < 3);
  assert.ok(result.effectiveHz > 20);
});

test('marks high jitter diagnostic sessions unusable', () => {
  const noisyTarget = summarizeDiagnosticTarget({
    target: TARGET,
    samples: [
      { x: 300, y: 200, atMs: 0 },
      { x: 700, y: 420, atMs: 33 },
      { x: 280, y: 450, atMs: 66 },
      { x: 720, y: 180, atMs: 99 },
    ],
    durationMs: 132,
  });

  const summary = summarizeRawGazeDiagnostic({
    targets: [noisyTarget, noisyTarget, noisyTarget],
  });

  assert.equal(summary.quality, 'unusable');
  assert.equal(summary.shouldBlockRecording, true);
  assert.match(summary.reason, /jitter/i);
});

test('treats slow but complete stable raw samples as coarse instead of unusable', () => {
  const slowStableTarget = summarizeDiagnosticTarget({
    target: TARGET,
    samples: Array.from({ length: 45 }, (_, index) => ({
      x: TARGET.x,
      y: TARGET.y,
      atMs: index * 75,
    })),
    durationMs: 3400,
    expectedSampleCount: 45,
  });

  const summary = summarizeRawGazeDiagnostic({
    targets: [slowStableTarget],
  });

  assert.equal(slowStableTarget.quality, 'coarse');
  assert.equal(summary.quality, 'coarse');
  assert.equal(summary.shouldBlockRecording, false);
  assert.match(summary.reason, /sample rate/i);
});

test('reports the hard blocker instead of blaming coarse sample rate', () => {
  const jitteryLowRateTarget = summarizeDiagnosticTarget({
    target: TARGET,
    samples: [
      { x: 300, y: 200, atMs: 0 },
      { x: 700, y: 420, atMs: 80 },
      { x: 280, y: 450, atMs: 160 },
      { x: 720, y: 180, atMs: 240 },
    ],
    durationMs: 360,
  });

  const summary = summarizeRawGazeDiagnostic({
    targets: [jitteryLowRateTarget],
  });

  assert.equal(summary.quality, 'unusable');
  assert.equal(summary.effectiveHz < 15, true);
  assert.match(summary.reason, /jitter/i);
  assert.doesNotMatch(summary.reason, /sample rate/i);
});

test('allows coarse diagnostics with uncertainty warning but blocks unusable diagnostics', () => {
  const coarse = summarizeRawGazeDiagnostic({
    targets: [{
      quality: 'coarse',
      medianJitterPx: 45,
      p90JitterPx: 90,
      biasPx: 120,
      effectiveHz: 20,
      missingRate: 0.1,
    }],
  });
  const unusable = summarizeRawGazeDiagnostic({
    targets: [{
      quality: 'unusable',
      medianJitterPx: 90,
      p90JitterPx: 180,
      biasPx: 260,
      effectiveHz: 10,
      missingRate: 0.5,
    }],
  });

  assert.equal(coarse.shouldBlockRecording, false);
  assert.equal(unusable.shouldBlockRecording, true);
});
