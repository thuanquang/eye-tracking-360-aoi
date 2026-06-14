export function recordTargetCaptureRejection(previousAttempts = 0, { maxAttempts = 2 } = {}) {
  const attempts = (Number.isInteger(previousAttempts) && previousAttempts >= 0 ? previousAttempts : 0) + 1;
  const limit = Number.isInteger(maxAttempts) && maxAttempts > 0 ? maxAttempts : 1;

  return {
    attempts,
    remainingAttempts: Math.max(0, limit - attempts),
    shouldAbort: attempts >= limit,
  };
}
