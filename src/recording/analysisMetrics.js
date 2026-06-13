import { DEFAULT_RECORDING_SAMPLE_INTERVAL_MS } from './sampleScheduler.js';
import { detectFixationsByDispersion } from './fixations.js';

const DEFAULT_SAMPLE_INTERVAL_SEC = DEFAULT_RECORDING_SAMPLE_INTERVAL_MS / 1000;
const MIN_FIXATION_DURATION_SEC = 0.1;
const FIXATION_DURATION_EPSILON_SEC = 1e-9;

function roundNumber(value, digits = 3) {
  if (!Number.isFinite(value)) {
    return null;
  }

  return Number(value.toFixed(digits));
}

function uniqueValues(values) {
  return [...new Set(values.filter((value) => typeof value === 'string' && value.length > 0))];
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);

  if (!sorted.length) {
    return 0;
  }

  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function getSampleDurations(samples, fallbackSec = DEFAULT_SAMPLE_INTERVAL_SEC) {
  if (!samples.length) {
    return [];
  }

  const intervals = samples.slice(0, -1)
    .map((sample, index) => samples[index + 1].t - sample.t)
    .filter((duration) => Number.isFinite(duration) && duration > 0 && duration < 5);
  const fallback = intervals.length ? median(intervals) : fallbackSec;

  return samples.map((sample, index) => {
    const next = samples[index + 1];
    const duration = next ? next.t - sample.t : fallback;
    return Number.isFinite(duration) && duration > 0 && duration < 5 ? duration : fallback;
  });
}

function buildAoiCatalog(samples, aois) {
  const catalog = new Map();
  const addAoi = (aoi) => {
    if (typeof aoi?.id !== 'string' || !aoi.id) {
      return;
    }

    if (!catalog.has(aoi.id)) {
      catalog.set(aoi.id, {
        id: aoi.id,
        label: typeof aoi.label === 'string' && aoi.label ? aoi.label : aoi.id,
      });
    }
  };

  aois.forEach(addAoi);
  samples.forEach((sample) => {
    (sample.activeAois || []).forEach(addAoi);
    uniqueValues(sample.stableHits || []).forEach((id) => addAoi({ id, label: id }));
  });

  return catalog;
}

function createAoiMetric(aoi) {
  return {
    id: aoi.id,
    label: aoi.label,
    hitCount: 0,
    likelyHitCount: 0,
    stableHitCount: 0,
    possibleSampleCount: 0,
    ambiguousSampleCount: 0,
    trustedSampleCount: 0,
    totalDwellSec: 0,
    likelyDwellSec: 0,
    stableDwellSec: 0,
    possibleDwellSec: 0,
    firstHitSec: null,
    timeToFirstFixationMs: null,
    fixationCount: 0,
    averageFixationDurationMs: 0,
    totalFixationDurationMs: 0,
    percentageOfViewingTime: 0,
  };
}

function primaryAoiForSample(sample) {
  return uniqueValues(sample.likelyHits || [])[0]
    || uniqueValues(sample.hits || [])[0]
    || null;
}

function meetsMinFixationDuration(durationSec) {
  return durationSec + FIXATION_DURATION_EPSILON_SEC >= MIN_FIXATION_DURATION_SEC;
}

function hasFiniteScreenPosition(sample) {
  return Number.isFinite(sample?.screen?.x) && Number.isFinite(sample?.screen?.y);
}

function samplesWithinFixation(samples, fixation) {
  return samples.filter((sample) => sample.t >= fixation.startSec && sample.t <= fixation.endSec);
}

function primaryAoiForFixation(samples) {
  const counts = new Map();

  samples.forEach((sample) => {
    const aoiId = primaryAoiForSample(sample);

    if (!aoiId) {
      return;
    }

    counts.set(aoiId, (counts.get(aoiId) || 0) + 1);
  });

  let primary = null;

  counts.forEach((count, aoiId) => {
    if (!primary || count > primary.count) {
      primary = { aoiId, count };
    }
  });

  return primary?.aoiId || null;
}

function detectAoiFixations(samples, durations) {
  const fixations = [];
  let current = null;

  samples.forEach((sample, index) => {
    const aoiId = primaryAoiForSample(sample);

    if (!aoiId) {
      if (current && meetsMinFixationDuration(current.durationSec)) {
        fixations.push(current);
      }
      current = null;
      return;
    }

    if (!current || current.aoiId !== aoiId) {
      if (current && meetsMinFixationDuration(current.durationSec)) {
        fixations.push(current);
      }
      current = {
        aoiId,
        startSec: sample.t,
        endSec: sample.t + durations[index],
        durationSec: durations[index],
        sampleCount: 1,
      };
      return;
    }

    current.endSec = sample.t + durations[index];
    current.durationSec += durations[index];
    current.sampleCount += 1;
  });

  if (current && meetsMinFixationDuration(current.durationSec)) {
    fixations.push(current);
  }

  return fixations;
}

function detectScreenAoiFixations(samples, durations) {
  if (!samples.some(hasFiniteScreenPosition)) {
    return null;
  }

  return detectFixationsByDispersion(samples, { sampleDurationsSec: durations })
    .map((fixation) => {
      const aoiId = primaryAoiForFixation(samplesWithinFixation(samples, fixation));

      if (!aoiId) {
        return null;
      }

      return {
        ...fixation,
        aoiId,
        durationSec: fixation.durationMs / 1000,
      };
    })
    .filter(Boolean);
}

function fixationDurationMs(fixation) {
  if (Number.isFinite(fixation.durationMs)) {
    return fixation.durationMs;
  }

  return fixation.durationSec * 1000;
}

function fixationCoverageEndSec(fixation) {
  return Math.max(
    fixation.endSec,
    fixation.startSec + (fixationDurationMs(fixation) / 1000),
  );
}

function fixationTimeOverlaps(first, second) {
  const latestStartSec = Math.max(first.startSec, second.startSec);
  const earliestEndSec = Math.min(fixationCoverageEndSec(first), fixationCoverageEndSec(second));

  return earliestEndSec - latestStartSec > FIXATION_DURATION_EPSILON_SEC;
}

function mergeFixations(screenFixations, legacyFixations) {
  if (!screenFixations?.length) {
    return legacyFixations;
  }

  const uncoveredLegacyFixations = legacyFixations
    .filter((legacyFixation) => !screenFixations
      .some((screenFixation) => fixationTimeOverlaps(legacyFixation, screenFixation)));

  return [...screenFixations, ...uncoveredLegacyFixations]
    .sort((a, b) => a.startSec - b.startSec
      || fixationCoverageEndSec(a) - fixationCoverageEndSec(b)
      || a.aoiId.localeCompare(b.aoiId));
}

export function buildNamedAoiMetrics(samples = [], aois = [], { sampleIntervalMs = DEFAULT_RECORDING_SAMPLE_INTERVAL_MS } = {}) {
  const safeSamples = samples
    .filter((sample) => Number.isFinite(sample?.t))
    .sort((a, b) => a.t - b.t);
  const fallbackSec = Number.isFinite(sampleIntervalMs) && sampleIntervalMs > 0
    ? sampleIntervalMs / 1000
    : DEFAULT_SAMPLE_INTERVAL_SEC;
  const durations = getSampleDurations(safeSamples, fallbackSec);
  const totalDurationSec = durations.reduce((sum, duration) => sum + duration, 0);
  const catalog = buildAoiCatalog(safeSamples, aois);
  const perAoi = {};

  catalog.forEach((aoi) => {
    perAoi[aoi.id] = createAoiMetric(aoi);
  });

  safeSamples.forEach((sample, index) => {
    const duration = durations[index] || 0;
    const hits = uniqueValues(sample.hits || []);
    const stableHits = uniqueValues(sample.stableHits || []);
    const likelyHits = uniqueValues(sample.likelyHits || []);
    const possibleHits = uniqueValues(sample.possibleHits || []);
    const ambiguousHits = uniqueValues(sample.ambiguousHits || []);
    const trusted = Boolean(sample.quality?.trustedForAoiAnalysis);

    hits.forEach((id) => {
      if (!perAoi[id]) {
        perAoi[id] = createAoiMetric({ id, label: id });
      }
      perAoi[id].hitCount += 1;
      perAoi[id].totalDwellSec += duration;
      perAoi[id].firstHitSec = perAoi[id].firstHitSec ?? sample.t;
    });

    likelyHits.forEach((id) => {
      if (!perAoi[id]) {
        perAoi[id] = createAoiMetric({ id, label: id });
      }
      perAoi[id].likelyHitCount += 1;
      perAoi[id].likelyDwellSec += duration;
    });

    stableHits.forEach((id) => {
      if (!perAoi[id]) {
        perAoi[id] = createAoiMetric({ id, label: id });
      }
      perAoi[id].stableHitCount += 1;
      perAoi[id].stableDwellSec += duration;
      if (trusted) {
        perAoi[id].trustedSampleCount += 1;
      }
    });

    possibleHits.forEach((id) => {
      if (!perAoi[id]) {
        perAoi[id] = createAoiMetric({ id, label: id });
      }
      perAoi[id].possibleSampleCount += 1;
      perAoi[id].possibleDwellSec += duration;
    });

    ambiguousHits.forEach((id) => {
      if (!perAoi[id]) {
        perAoi[id] = createAoiMetric({ id, label: id });
      }
      perAoi[id].ambiguousSampleCount += 1;
    });
  });

  const screenFixations = detectScreenAoiFixations(safeSamples, durations);
  const legacyFixations = detectAoiFixations(safeSamples, durations);
  const fixations = mergeFixations(screenFixations, legacyFixations);

  fixations.forEach((fixation) => {
    if (!perAoi[fixation.aoiId]) {
      perAoi[fixation.aoiId] = createAoiMetric({ id: fixation.aoiId, label: fixation.aoiId });
    }

    const metric = perAoi[fixation.aoiId];
    metric.fixationCount += 1;
    metric.totalFixationDurationMs += fixationDurationMs(fixation);
    metric.timeToFirstFixationMs = metric.timeToFirstFixationMs
      ?? Math.round(fixation.startSec * 1000);
  });

  Object.values(perAoi).forEach((metric) => {
    metric.totalDwellSec = roundNumber(metric.totalDwellSec);
    metric.likelyDwellSec = roundNumber(metric.likelyDwellSec);
    metric.stableDwellSec = roundNumber(metric.stableDwellSec);
    metric.possibleDwellSec = roundNumber(metric.possibleDwellSec);
    metric.firstHitSec = roundNumber(metric.firstHitSec);
    metric.totalFixationDurationMs = Math.round(metric.totalFixationDurationMs);
    metric.averageFixationDurationMs = metric.fixationCount
      ? Math.round(metric.totalFixationDurationMs / metric.fixationCount)
      : 0;
    metric.percentageOfViewingTime = totalDurationSec > 0
      ? roundNumber((metric.totalDwellSec / totalDurationSec) * 100, 2)
      : 0;
  });

  const fixationDurationsMs = fixations.map(fixationDurationMs);
  const fixatedAoiIds = uniqueValues(fixations.map((fixation) => fixation.aoiId));
  const aoiCount = Object.keys(perAoi).length;
  const totalDwellSec = Object.values(perAoi)
    .reduce((sum, metric) => sum + (metric.totalDwellSec || 0), 0);

  return {
    session: {
      totalSamples: safeSamples.length,
      totalDurationSec: roundNumber(totalDurationSec),
      totalFixations: fixations.length,
      averageFixationDurationMs: fixationDurationsMs.length
        ? Math.round(fixationDurationsMs.reduce((sum, duration) => sum + duration, 0) / fixationDurationsMs.length)
        : 0,
      averageNumberOfAoisFixated: fixatedAoiIds.length,
      aoiCoveragePercent: aoiCount ? roundNumber((fixatedAoiIds.length / aoiCount) * 100, 2) : 0,
      overallProcessingEfficiency: totalDurationSec > 0
        ? roundNumber((totalDwellSec / totalDurationSec) * 100, 2)
        : 0,
    },
    perAoi,
  };
}
