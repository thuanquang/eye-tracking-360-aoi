export const DEFAULT_RECORDING_SAMPLE_INTERVAL_MS = 1000 / 30;

export function createSampleScheduler({ intervalMs = DEFAULT_RECORDING_SAMPLE_INTERVAL_MS } = {}) {
  return { intervalMs, lastSampleAt: -Infinity };
}

export function shouldRecordSample(scheduler, now, gaze = {}) {
  if (gaze.held) {
    return { record: false, reason: 'held-gaze' };
  }

  if (now - scheduler.lastSampleAt < scheduler.intervalMs) {
    return { record: false, reason: 'too-soon' };
  }

  scheduler.lastSampleAt = now;
  return { record: true, reason: null };
}
