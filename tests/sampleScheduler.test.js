import test from 'node:test';
import assert from 'node:assert/strict';

import { createSampleScheduler, shouldRecordSample } from '../src/recording/sampleScheduler.js';

test('records at 30hz by default', () => {
  const scheduler = createSampleScheduler({ intervalMs: 1000 / 30 });

  assert.equal(shouldRecordSample(scheduler, 0).record, true);
  assert.equal(shouldRecordSample(scheduler, 10).record, false);
  assert.equal(shouldRecordSample(scheduler, 34).record, true);
});

test('skips held webcam gaze samples', () => {
  const scheduler = createSampleScheduler({ intervalMs: 1000 / 30 });

  assert.equal(shouldRecordSample(scheduler, 34, { held: true }).record, false);
});
