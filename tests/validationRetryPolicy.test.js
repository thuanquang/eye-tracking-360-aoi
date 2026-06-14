import test from 'node:test';
import assert from 'node:assert/strict';

import { recordTargetCaptureRejection } from '../src/gaze/validationRetryPolicy.js';

test('allows one retry before aborting an unstable validation target', () => {
  const first = recordTargetCaptureRejection(0, { maxAttempts: 2 });

  assert.deepEqual(first, {
    attempts: 1,
    remainingAttempts: 1,
    shouldAbort: false,
  });

  const second = recordTargetCaptureRejection(first.attempts, { maxAttempts: 2 });

  assert.deepEqual(second, {
    attempts: 2,
    remainingAttempts: 0,
    shouldAbort: true,
  });
});
