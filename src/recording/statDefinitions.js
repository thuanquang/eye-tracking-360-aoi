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
    reliability: STAT_RELIABILITY.STABLE,
    description: 'Number of fixations assigned to the AOI.',
  },
  {
    id: 'totalFixationDurationMs',
    label: 'Total fixation duration',
    scope: 'perAoi',
    unit: 'milliseconds',
    reliability: STAT_RELIABILITY.STABLE,
    description: 'Total duration of fixations assigned to the AOI.',
  },
  {
    id: 'averageFixationDurationMs',
    label: 'Average fixation duration',
    scope: 'perAoi',
    unit: 'milliseconds',
    reliability: STAT_RELIABILITY.STABLE,
    description: 'Mean duration of fixations assigned to the AOI.',
  },
  {
    id: 'firstFixationDurationMs',
    label: 'First fixation duration',
    scope: 'perAoi',
    unit: 'milliseconds',
    reliability: STAT_RELIABILITY.STABLE,
    description: 'Duration of the first fixation assigned to the AOI.',
  },
  {
    id: 'timeToFirstFixationMs',
    label: 'Time to first fixation',
    scope: 'perAoi',
    unit: 'milliseconds',
    reliability: STAT_RELIABILITY.STABLE,
    description: 'Elapsed time before the first fixation assigned to the AOI.',
  },
  {
    id: 'revisitCount',
    label: 'Revisit count',
    scope: 'perAoi',
    unit: 'count',
    reliability: STAT_RELIABILITY.STABLE,
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
    id: 'averageNumberOfAoisFixated',
    label: 'Average number of AOIs fixated',
    scope: 'session',
    unit: 'count',
    reliability: STAT_RELIABILITY.STABLE,
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
    description: 'Estimated share of viewing time represented by AOI dwell time.',
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

const STAT_DEFINITIONS_BY_ID = new Map(
  AOI_STAT_DEFINITIONS.map((definition) => [definition.id, definition]),
);

export function getStatDefinition(id) {
  return STAT_DEFINITIONS_BY_ID.get(id);
}

export function listStatsByScope(scope) {
  return AOI_STAT_DEFINITIONS.filter((definition) => definition.scope === scope);
}
