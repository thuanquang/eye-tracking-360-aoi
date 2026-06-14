export const STAT_RELIABILITY = Object.freeze({
  STABLE: 'stable',
  ESTIMATED: 'estimated',
  EXPERIMENTAL: 'experimental',
});

export const AOI_STAT_DEFINITIONS = Object.freeze([
  {
    id: 'totalDwellSec',
    label: 'Total dwell time',
    scope: 'perAoi',
    unit: 'seconds',
    reliability: STAT_RELIABILITY.STABLE,
    description: 'Total time that gaze samples intersected the AOI.',
  },
  {
    id: 'likelyDwellSec',
    label: 'Likely dwell time',
    scope: 'perAoi',
    unit: 'seconds',
    reliability: STAT_RELIABILITY.STABLE,
    description: 'Total time from samples classified as likely AOI hits.',
  },
  {
    id: 'stableDwellSec',
    label: 'Stable dwell time',
    scope: 'perAoi',
    unit: 'seconds',
    reliability: STAT_RELIABILITY.STABLE,
    description: 'Total dwell time from stable AOI evidence across samples.',
  },
  {
    id: 'fixationCount',
    label: 'Fixation count',
    scope: 'perAoi',
    unit: 'count',
    reliability: STAT_RELIABILITY.ESTIMATED,
    description: 'Number of fixations assigned to the AOI.',
  },
  {
    id: 'totalFixationDurationMs',
    label: 'Total fixation duration',
    scope: 'perAoi',
    unit: 'milliseconds',
    reliability: STAT_RELIABILITY.ESTIMATED,
    description: 'Total duration of fixations assigned to the AOI.',
  },
  {
    id: 'averageFixationDurationMs',
    label: 'Average fixation duration',
    scope: 'perAoi',
    unit: 'milliseconds',
    reliability: STAT_RELIABILITY.ESTIMATED,
    description: 'Mean duration of fixations assigned to the AOI.',
  },
  {
    id: 'firstFixationDurationMs',
    label: 'First fixation duration',
    scope: 'perAoi',
    unit: 'milliseconds',
    reliability: STAT_RELIABILITY.ESTIMATED,
    description: 'Duration of the first fixation assigned to the AOI.',
  },
  {
    id: 'timeToFirstFixationMs',
    label: 'Time to first fixation',
    scope: 'perAoi',
    unit: 'milliseconds',
    reliability: STAT_RELIABILITY.ESTIMATED,
    description: 'Elapsed time before the first fixation assigned to the AOI.',
  },
  {
    id: 'revisitCount',
    label: 'Revisit count',
    scope: 'perAoi',
    unit: 'count',
    reliability: STAT_RELIABILITY.ESTIMATED,
    description: 'Number of fixation returns to the AOI after looking elsewhere.',
  },
  {
    id: 'percentageOfViewingTime',
    label: 'Percentage of viewing time',
    scope: 'perAoi',
    unit: 'percent',
    reliability: STAT_RELIABILITY.STABLE,
    description: 'Share of total viewing time spent dwelling on the AOI.',
  },
  {
    id: 'totalSamples',
    label: 'Total samples',
    scope: 'session',
    unit: 'count',
    reliability: STAT_RELIABILITY.STABLE,
    description: 'Number of gaze samples in the analyzed session.',
  },
  {
    id: 'totalDurationSec',
    label: 'Total duration',
    scope: 'session',
    unit: 'seconds',
    reliability: STAT_RELIABILITY.STABLE,
    description: 'Estimated analyzed recording duration from sample timing.',
  },
  {
    id: 'totalFixations',
    label: 'Total fixations',
    scope: 'session',
    unit: 'count',
    reliability: STAT_RELIABILITY.ESTIMATED,
    description: 'Number of fixation windows mapped to AOIs.',
  },
  {
    id: 'averageFixationDurationMs',
    label: 'Session average fixation duration',
    scope: 'session',
    unit: 'milliseconds',
    reliability: STAT_RELIABILITY.ESTIMATED,
    description: 'Mean duration of all AOI-mapped fixation windows in the session.',
  },
  {
    id: 'uniqueAoisFixated',
    label: 'Unique AOIs fixated',
    scope: 'session',
    unit: 'ids',
    reliability: STAT_RELIABILITY.ESTIMATED,
    description: 'AOI ids that received at least one fixation, in first-fixation order.',
  },
  {
    id: 'saccadeCount',
    label: 'Transition count',
    scope: 'session',
    unit: 'count',
    reliability: STAT_RELIABILITY.EXPERIMENTAL,
    description: 'Experimental count of transition gaps between AOI fixation windows.',
  },
  {
    id: 'averageNumberOfAoisFixated',
    label: 'Average number of AOIs fixated',
    scope: 'session',
    unit: 'count',
    reliability: STAT_RELIABILITY.ESTIMATED,
    description: 'Number of distinct AOIs that received at least one fixation.',
  },
  {
    id: 'aoiCoveragePercent',
    label: 'AOI coverage',
    scope: 'session',
    unit: 'percent',
    reliability: STAT_RELIABILITY.STABLE,
    description: 'Percent of available AOIs that received at least one fixation.',
  },
  {
    id: 'overallProcessingEfficiency',
    label: 'Overall processing efficiency',
    scope: 'session',
    unit: 'percent',
    reliability: STAT_RELIABILITY.ESTIMATED,
    description: 'Transparent MVP composite of AOI coverage, trusted AOI dwell, and fixation efficiency; reports should include formula and components.',
  },
  {
    id: 'averageSaccadeDurationMs',
    label: 'Average saccade duration',
    scope: 'session',
    unit: 'milliseconds',
    reliability: STAT_RELIABILITY.EXPERIMENTAL,
    description: 'Experimental estimate of the mean transition duration between fixations.',
  },
  {
    id: 'screenHeatmap',
    label: 'Screen heatmap',
    scope: 'heatmap',
    unit: 'density',
    reliability: STAT_RELIABILITY.STABLE,
    description: 'Screen-space gaze density map for flat viewer coordinates.',
  },
  {
    id: 'panoramaHeatmap',
    label: 'Panorama heatmap',
    scope: 'heatmap',
    unit: 'density',
    reliability: STAT_RELIABILITY.STABLE,
    description: 'Panorama-space gaze density map for yaw and pitch coordinates.',
  },
].map(Object.freeze));

const STAT_DEFINITIONS_BY_ID = AOI_STAT_DEFINITIONS.reduce((definitions, definition) => {
  if (!definitions.has(definition.id)) {
    definitions.set(definition.id, definition);
  }

  return definitions;
}, new Map());

export function getStatDefinition(id, scope = null) {
  if (scope) {
    return AOI_STAT_DEFINITIONS.find((definition) => definition.id === id && definition.scope === scope);
  }

  return STAT_DEFINITIONS_BY_ID.get(id);
}

export function listStatsByScope(scope) {
  return AOI_STAT_DEFINITIONS.filter((definition) => definition.scope === scope);
}
