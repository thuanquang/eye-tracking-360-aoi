import {
  getStatDefinition,
  listStatsByScope,
  STAT_RELIABILITY,
} from './statDefinitions.js';

const GENERAL_WEBCAM_CAVEAT = 'Webcam-based gaze and AOI statistics are approximate; interpret them alongside calibration quality, validation policy, and recording conditions.';
const EXPERIMENTAL_SACCADE_CAVEAT = 'Experimental saccade timing statistics are estimates from fixation transitions and should not be treated as clinical-grade eye movement measures.';
const OPE_CAVEAT = 'Overall processing efficiency (OPE) is an estimated composite metric; compare it within similar tasks and review its component measures before drawing conclusions.';

function hasReportValue(value) {
  return value !== null
    && value !== undefined
    && !(typeof value === 'string' && value.trim() === '');
}

function buildDisplayStat(definition, value) {
  const metadata = getStatDefinition(definition.id, definition.scope) ?? definition;

  return {
    id: metadata.id,
    label: metadata.label,
    value,
    unit: metadata.unit,
    reliability: metadata.reliability,
    description: metadata.description,
  };
}

function buildStatsForScope(scope, metrics) {
  if (!metrics || typeof metrics !== 'object') {
    return [];
  }

  return listStatsByScope(scope)
    .filter((definition) => hasReportValue(metrics[definition.id]))
    .map((definition) => buildDisplayStat(definition, metrics[definition.id]));
}

function listAoiMetricEntries(perAoiMetrics) {
  if (Array.isArray(perAoiMetrics)) {
    return perAoiMetrics.map((metrics, index) => [metrics?.id ?? String(index), metrics]);
  }

  if (perAoiMetrics && typeof perAoiMetrics === 'object') {
    return Object.entries(perAoiMetrics);
  }

  return [];
}

function buildPerAoiRows(perAoiMetrics) {
  return listAoiMetricEntries(perAoiMetrics)
    .filter(([, metrics]) => metrics && typeof metrics === 'object')
    .map(([key, metrics]) => {
      const aoiId = metrics.id ?? key;

      return {
        aoiId,
        label: metrics.label ?? metrics.name ?? aoiId,
        stats: buildStatsForScope('perAoi', metrics),
      };
    });
}

function buildCaveats(sessionStats) {
  const caveats = [GENERAL_WEBCAM_CAVEAT];

  if (sessionStats.some((stat) => stat.reliability === STAT_RELIABILITY.EXPERIMENTAL)) {
    caveats.push(EXPERIMENTAL_SACCADE_CAVEAT);
  }

  if (sessionStats.some((stat) => stat.id === 'overallProcessingEfficiency')) {
    caveats.push(OPE_CAVEAT);
  }

  return caveats;
}

export function buildStatReport({
  namedAoiMetrics = {},
  summary = null,
  exportedAt = null,
} = {}) {
  const sessionStats = buildStatsForScope('session', namedAoiMetrics?.session);

  return {
    exportedAt,
    sessionStats,
    perAoiRows: buildPerAoiRows(namedAoiMetrics?.perAoi),
    heatmaps: summary?.heatmaps ?? null,
    caveats: buildCaveats(sessionStats),
  };
}
