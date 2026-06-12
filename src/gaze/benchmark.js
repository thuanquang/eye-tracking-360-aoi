function finiteMean(values) {
  const finiteValues = values.filter(Number.isFinite);

  if (!finiteValues.length) {
    return null;
  }

  const total = finiteValues.reduce((sum, value) => sum + value, 0);
  return Number((total / finiteValues.length).toFixed(2));
}

function getRunSource(run) {
  return run?.benchmark && typeof run.benchmark === 'object'
    ? run.benchmark
    : run;
}

function buildAccuracyFromSummary(summary) {
  if (!summary || typeof summary !== 'object') {
    return null;
  }

  return {
    meanPx: summary.accuracyMeanPx,
    p90Px: summary.accuracyP90Px,
    maxPx: summary.accuracyMaxPx,
  };
}

function getAccuracy(run) {
  const source = getRunSource(run);

  return source?.accuracy
    ?? source?.accuracySummary
    ?? buildAccuracyFromSummary(source?.summary)
    ?? buildAccuracyFromSummary(source);
}

function getStreamQuality(run) {
  const source = getRunSource(run);

  return source?.streamQuality
    ?? source?.gazeStreamQuality
    ?? source?.summary?.gazeStreamQuality
    ?? null;
}

function getParticipantId(run) {
  const source = getRunSource(run);

  return source?.participantId
    ?? source?.participant?.id
    ?? run?.participant?.id
    ?? '';
}

function getDevice(run) {
  const source = getRunSource(run);

  return source?.device
    ?? source?.participantDevice
    ?? source?.participant?.device
    ?? run?.participant?.device
    ?? '';
}

function getProfileId(profile) {
  if (typeof profile === 'string') {
    return profile;
  }

  return profile?.id ?? profile?.label ?? '';
}

function getCalibrationProfileId(run) {
  const source = getRunSource(run);

  return getProfileId(
    source?.calibrationProfileUsed
      ?? source?.calibrationProfile
      ?? source?.selectedCalibrationProfile
      ?? source?.summary?.calibrationProfileUsed
      ?? source?.summary?.calibrationProfile,
  );
}

function getValidationPolicyId(run) {
  const source = getRunSource(run);

  return source?.validationPolicyId
    ?? source?.validationPolicy?.id
    ?? source?.selectedValidationPolicyId
    ?? source?.summary?.validationPolicyId
    ?? '';
}

function asciiCell(value) {
  if (value === null || value === undefined) {
    return '';
  }

  return String(value)
    .replace(/[^\x20-\x7E]/g, '?')
    .replace(/\|/g, '\\|');
}

function metricCell(value) {
  return Number.isFinite(value) ? asciiCell(value) : '';
}

function summaryMetric(value) {
  return value === null || value === undefined ? 'n/a' : asciiCell(value);
}

export function summarizeBenchmarkRuns(runs = []) {
  const safeRuns = Array.isArray(runs) ? runs : [];

  return {
    runCount: safeRuns.length,
    meanAccuracyPx: finiteMean(safeRuns.map((run) => getAccuracy(run)?.meanPx)),
    meanP90Px: finiteMean(safeRuns.map((run) => getAccuracy(run)?.p90Px)),
    meanMaxPx: finiteMean(safeRuns.map((run) => getAccuracy(run)?.maxPx)),
    meanEffectiveHz: finiteMean(safeRuns.map((run) => getStreamQuality(run)?.effectiveHz)),
    meanDataIntegrityPercent: finiteMean(
      safeRuns.map((run) => getStreamQuality(run)?.dataIntegrityPercent),
    ),
  };
}

export function buildBenchmarkReport({ summary, runs = [] } = {}) {
  const safeRuns = Array.isArray(runs) ? runs : [];
  const resolvedSummary = summary ?? summarizeBenchmarkRuns(safeRuns);
  const lines = [
    '# Eye Tracking Benchmark',
    '',
    `Run count: ${summaryMetric(resolvedSummary.runCount)}`,
    `Mean accuracy px: ${summaryMetric(resolvedSummary.meanAccuracyPx)}`,
    `Mean p90 px: ${summaryMetric(resolvedSummary.meanP90Px)}`,
    `Mean max px: ${summaryMetric(resolvedSummary.meanMaxPx)}`,
    `Mean effective Hz: ${summaryMetric(resolvedSummary.meanEffectiveHz)}`,
    `Mean data integrity percent: ${summaryMetric(resolvedSummary.meanDataIntegrityPercent)}`,
    '',
    '| Participant | Device | Calibration | Policy | Mean px | P90 px | Max px | Effective Hz | Integrity % |',
    '| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: |',
  ];

  safeRuns.forEach((run) => {
    const accuracy = getAccuracy(run);
    const streamQuality = getStreamQuality(run);

    const cells = [
      asciiCell(getParticipantId(run)),
      asciiCell(getDevice(run)),
      asciiCell(getCalibrationProfileId(run)),
      asciiCell(getValidationPolicyId(run)),
      metricCell(accuracy?.meanPx),
      metricCell(accuracy?.p90Px),
      metricCell(accuracy?.maxPx),
      metricCell(streamQuality?.effectiveHz),
      metricCell(streamQuality?.dataIntegrityPercent),
    ];

    lines.push(`| ${cells.join(' | ')} |`);
  });

  return `${lines.join('\n')}\n`;
}
