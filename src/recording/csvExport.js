const AOI_STATS_CSV_COLUMNS = [
  ['aoiId', (metrics, key) => metrics.id ?? key],
  ['aoiLabel', (metrics, key) => metrics.label ?? metrics.name ?? metrics.id ?? key],
  ['totalDwellSec', (metrics) => metrics.totalDwellSec],
  ['likelyDwellSec', (metrics) => metrics.likelyDwellSec],
  ['stableDwellSec', (metrics) => metrics.stableDwellSec],
  ['fixationCount', (metrics) => metrics.fixationCount],
  ['totalFixationDurationMs', (metrics) => metrics.totalFixationDurationMs],
  ['averageFixationDurationMs', (metrics) => metrics.averageFixationDurationMs],
  ['firstFixationDurationMs', (metrics) => metrics.firstFixationDurationMs],
  ['timeToFirstFixationMs', (metrics) => metrics.timeToFirstFixationMs],
  ['revisitCount', (metrics) => metrics.revisitCount],
  ['percentageOfViewingTime', (metrics) => metrics.percentageOfViewingTime],
  ['trustedSampleCount', (metrics) => metrics.trustedSampleCount],
  ['ambiguousSampleCount', (metrics) => metrics.ambiguousSampleCount],
];

function listAoiMetricEntries(perAoi) {
  if (Array.isArray(perAoi)) {
    return perAoi.map((metrics, index) => [metrics?.id ?? String(index), metrics]);
  }

  if (perAoi && typeof perAoi === 'object') {
    return Object.entries(perAoi);
  }

  return [];
}

function escapeCsvValue(value) {
  if (value === null || value === undefined) {
    return '';
  }

  const text = String(value);

  if (!/[",\r\n]/.test(text)) {
    return text;
  }

  return `"${text.replaceAll('"', '""')}"`;
}

export function buildAoiStatsCsv({ namedAoiMetrics = {} } = {}) {
  const header = AOI_STATS_CSV_COLUMNS.map(([headerName]) => headerName).join(',');
  const rows = listAoiMetricEntries(namedAoiMetrics?.perAoi)
    .filter(([, metrics]) => metrics && typeof metrics === 'object')
    .map(([key, metrics]) => AOI_STATS_CSV_COLUMNS
      .map(([, getValue]) => escapeCsvValue(getValue(metrics, key)))
      .join(','));

  return [header, ...rows].join('\n');
}
