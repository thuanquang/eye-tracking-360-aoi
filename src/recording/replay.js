export function isValidReviewSample(sample) {
  return (
    Number.isFinite(sample?.t) &&
    Number.isFinite(sample?.panorama?.yaw) &&
    Number.isFinite(sample?.panorama?.pitch)
  );
}

export function extractRecordingSamplesFromJson(json) {
  if (Array.isArray(json?.samples)) {
    return json.samples;
  }

  throw new Error('Recording JSON must be an exported object with a samples array.');
}

export function prepareReviewSamples(json) {
  return extractRecordingSamplesFromJson(json)
    .filter(isValidReviewSample)
    .sort((a, b) => a.t - b.t);
}

export function findReviewSampleIndex(samples, timeSec) {
  if (!samples.length) {
    return -1;
  }

  if (!Number.isFinite(timeSec) || timeSec <= samples[0].t) {
    return 0;
  }

  if (timeSec >= samples[samples.length - 1].t) {
    return samples.length - 1;
  }

  let bestIndex = 0;
  let bestDistance = Infinity;

  for (let index = 0; index < samples.length; index += 1) {
    const distance = Math.abs(samples[index].t - timeSec);

    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }

  return bestIndex;
}

export function getReviewTimeWindow(samples) {
  if (!samples.length) {
    return null;
  }

  let start = Infinity;
  let end = -Infinity;

  for (const sample of samples) {
    if (!Number.isFinite(sample?.t)) {
      continue;
    }

    start = Math.min(start, sample.t);
    end = Math.max(end, sample.t);
  }

  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return null;
  }

  return { start, end };
}
