import { summarizeGazeStreamQuality } from '../gaze/qualityMonitor.js';
import { buildPanoramaHeatmap, buildScreenHeatmap } from './heatmapMetrics.js';
import { DEFAULT_RECORDING_SAMPLE_INTERVAL_MS } from './sampleScheduler.js';
import { buildStatReport } from './statReport.js';

function buildCalibrationProfileMetadata(profile) {
  if (!profile || typeof profile !== 'object' || !profile.id) {
    return null;
  }

  const pointCount = Number.isFinite(profile.pointCount)
    ? profile.pointCount
    : Array.isArray(profile.calibrationPoints)
      ? profile.calibrationPoints.length
      : null;

  return {
    id: profile.id,
    label: profile.label ?? profile.id,
    pointCount,
  };
}

function clonePolicyFailures(policyFailures) {
  return Array.isArray(policyFailures)
    ? policyFailures.map((failure) => ({ ...failure }))
    : [];
}

function cloneFaceQualityBaseline(faceQualityBaseline) {
  return faceQualityBaseline && typeof faceQualityBaseline === 'object'
    ? { ...faceQualityBaseline }
    : null;
}

function cloneFaceQualityInvalidations(faceQualityInvalidations) {
  return Array.isArray(faceQualityInvalidations)
    ? faceQualityInvalidations.map((invalidation) => ({
      ...invalidation,
      reasons: Array.isArray(invalidation?.reasons)
        ? [...invalidation.reasons]
        : [],
    }))
    : [];
}

function compactString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function finiteNumberOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

function cloneAccuracySummary(summary) {
  return summary && typeof summary === 'object'
    ? { ...summary }
    : null;
}

function cloneRawGazeDiagnostic(rawGazeDiagnostic) {
  const summary = rawGazeDiagnostic?.latestSummary ?? rawGazeDiagnostic;
  return summary && typeof summary === 'object'
    ? structuredClone(summary)
    : null;
}

function cloneAoiStability(aoiStability) {
  return aoiStability && typeof aoiStability === 'object'
    ? structuredClone(aoiStability)
    : null;
}

function cloneGazeStreamQuality(quality) {
  if (!quality || typeof quality !== 'object') {
    return null;
  }

  const { events, droppedReasons, ...rest } = quality;

  return {
    ...rest,
    droppedReasons: droppedReasons && typeof droppedReasons === 'object'
      ? { ...droppedReasons }
      : {},
  };
}

function getParticipantId(participant) {
  return compactString(participant?.id)
    ?? compactString(participant?.participantId);
}

function getParticipantDevice(participant, explicitDevice = null) {
  return compactString(explicitDevice)
    ?? compactString(participant?.device)
    ?? compactString(participant?.participantDevice);
}

function buildBenchmarkMetadata({
  participant = null,
  device = null,
  accuracy = null,
  gazeStreamQuality = null,
  validationGazeStreamQuality = null,
  selectedCalibrationProfile = null,
  calibrationProfileUsed = null,
  selectedValidationPolicyId = 'prototype',
  validationPolicyId = null,
  policyPassed = null,
  policyFailures = [],
  recordingSampleIntervalMs = null,
  durationSec = null,
  faceQualityAvailable = false,
  faceQualityUnavailableReason = null,
  faceQualityInvalidations = [],
  rawGazeDiagnosticQuality = null,
} = {}) {
  return {
    participantId: getParticipantId(participant),
    device: getParticipantDevice(participant, device),
    accuracy: cloneAccuracySummary(accuracy),
    gazeStreamQuality: cloneGazeStreamQuality(gazeStreamQuality),
    validationGazeStreamQuality: cloneGazeStreamQuality(validationGazeStreamQuality),
    selectedCalibrationProfile: buildCalibrationProfileMetadata(selectedCalibrationProfile),
    calibrationProfileUsed: buildCalibrationProfileMetadata(calibrationProfileUsed),
    selectedValidationPolicyId: selectedValidationPolicyId ?? 'prototype',
    validationPolicyId: validationPolicyId ?? null,
    policyPassed: policyPassed ?? null,
    policyFailures: clonePolicyFailures(policyFailures),
    recordingSampleIntervalMs: finiteNumberOrNull(recordingSampleIntervalMs),
    durationSec: finiteNumberOrNull(durationSec),
    faceQualityAvailable: Boolean(faceQualityAvailable),
    faceQualityUnavailableReason: faceQualityUnavailableReason ?? null,
    faceStabilityInvalidationCount: Array.isArray(faceQualityInvalidations)
      ? faceQualityInvalidations.length
      : 0,
    rawGazeDiagnosticQuality: rawGazeDiagnosticQuality ?? null,
  };
}

function summarizeOptionalGazeStreamQuality(stats) {
  return stats ? summarizeGazeStreamQuality(stats) : null;
}

function countValues(samples, getValues) {
  return samples.reduce((counts, sample) => {
    const values = getValues(sample);

    values.forEach((value) => {
      counts[value] = (counts[value] || 0) + 1;
    });

    return counts;
  }, {});
}

function getSampleDurations(samples, sampleIntervalMs) {
  return samples.map((sample, index) => {
    const next = samples[index + 1];
    const videoDelta = next ? next.t - sample.t : sampleIntervalMs / 1000;

    return Number.isFinite(videoDelta) && videoDelta > 0
      ? videoDelta
      : sampleIntervalMs / 1000;
  });
}

function sumDwellSeconds(samples, getValues, sampleIntervalMs) {
  const durations = getSampleDurations(samples, sampleIntervalMs);

  return samples.reduce((dwell, sample, index) => {
    getValues(sample).forEach((value) => {
      dwell[value] = Number(((dwell[value] || 0) + durations[index]).toFixed(3));
    });

    return dwell;
  }, {});
}

function hasSampleIds(values) {
  return Array.isArray(values) && values.length > 0;
}

function hasLikelyAoiEvidence(sample) {
  return hasSampleIds(sample?.likelyHits) || hasSampleIds(sample?.hits);
}

function hasPossibleAoiEvidence(sample) {
  return hasSampleIds(sample?.possibleHits) || hasLikelyAoiEvidence(sample);
}

function buildHeatmapPair(samples, recordingSampleIntervalMs, screenHeatmapDimensions, sampleFilter = null) {
  return {
    screen: buildScreenHeatmap(samples, {
      ...screenHeatmapDimensions,
      sampleIntervalMs: recordingSampleIntervalMs,
      trustedOnly: true,
      sampleFilter,
    }),
    panorama: buildPanoramaHeatmap(samples, {
      sampleIntervalMs: recordingSampleIntervalMs,
      trustedOnly: true,
      sampleFilter,
    }),
  };
}

export function buildExportSummary(
  samples,
  stateLike,
  sampleIntervalMs = DEFAULT_RECORDING_SAMPLE_INTERVAL_MS,
  { screenHeatmapDimensions = null } = {},
) {
  const recordingSampleIntervalMs = Number.isFinite(sampleIntervalMs) && sampleIntervalMs > 0
    ? sampleIntervalMs
    : DEFAULT_RECORDING_SAMPLE_INTERVAL_MS;
  const durationSec = getSampleDurations(samples, recordingSampleIntervalMs)
    .reduce((sum, duration) => sum + duration, 0);
  const correctedAccuracySummary = stateLike.correctedAccuracySummary;
  const gazeStreamQuality = stateLike.gazeStreamQuality
    ?? summarizeGazeStreamQuality(stateLike.gazeStreamStats);
  const validationGazeStreamQuality = stateLike.validationGazeStreamQuality
    ?? summarizeOptionalGazeStreamQuality(stateLike.validationGazeStreamStats);
  const selectedCalibrationProfile = buildCalibrationProfileMetadata(stateLike.selectedCalibrationProfile);
  const calibrationProfile = buildCalibrationProfileMetadata(stateLike.calibrationProfileUsed)
    ?? buildCalibrationProfileMetadata(stateLike.calibrationProfile);
  const policyFailures = clonePolicyFailures(stateLike.policyFailures);
  const faceQualityBaseline = cloneFaceQualityBaseline(stateLike.faceQualityBaseline);
  const faceQualityInvalidations = cloneFaceQualityInvalidations(stateLike.faceQualityInvalidations);
  const rawGazeDiagnostic = cloneRawGazeDiagnostic(stateLike.rawGazeDiagnostic);
  const aoiStability = cloneAoiStability(stateLike.aoiStability);
  const trustedHeatmaps = buildHeatmapPair(
    samples,
    recordingSampleIntervalMs,
    screenHeatmapDimensions,
  );
  const likelyHeatmaps = buildHeatmapPair(
    samples,
    recordingSampleIntervalMs,
    screenHeatmapDimensions,
    hasLikelyAoiEvidence,
  );
  const possibleHeatmaps = buildHeatmapPair(
    samples,
    recordingSampleIntervalMs,
    screenHeatmapDimensions,
    hasPossibleAoiEvidence,
  );

  const benchmark = buildBenchmarkMetadata({
    participant: stateLike.participant ?? null,
    device: stateLike.device ?? null,
    accuracy: correctedAccuracySummary,
    gazeStreamQuality,
    validationGazeStreamQuality,
    selectedCalibrationProfile,
    calibrationProfileUsed: calibrationProfile,
    selectedValidationPolicyId: stateLike.selectedValidationPolicyId ?? 'prototype',
    validationPolicyId: stateLike.validationPolicyId ?? null,
    policyPassed: stateLike.policyPassed ?? null,
    policyFailures,
    recordingSampleIntervalMs,
    durationSec: Number(durationSec.toFixed(3)),
    faceQualityAvailable: stateLike.faceQualityAvailable ?? false,
    faceQualityUnavailableReason: stateLike.faceQualityUnavailableReason ?? null,
    faceQualityInvalidations,
    rawGazeDiagnosticQuality: rawGazeDiagnostic?.quality ?? null,
  });

  return {
    totalSamples: samples.length,
    recordingSampleIntervalMs,
    durationSec: Number(durationSec.toFixed(3)),
    heatmaps: {
      screen: trustedHeatmaps.screen,
      panorama: trustedHeatmaps.panorama,
      variants: {
        trusted: trustedHeatmaps,
        likely: likelyHeatmaps,
        possible: possibleHeatmaps,
      },
    },
    sources: countValues(samples, (sample) => [sample.source]),
    aoiHitCounts: countValues(samples, (sample) => sample.hits || []),
    likelyAoiHitCounts: countValues(samples, (sample) => sample.likelyHits || []),
    possibleAoiHitCounts: countValues(samples, (sample) => sample.possibleHits || []),
    aoiDwellSec: sumDwellSeconds(samples, (sample) => sample.hits || [], recordingSampleIntervalMs),
    likelyAoiDwellSec: sumDwellSeconds(samples, (sample) => sample.likelyHits || [], recordingSampleIntervalMs),
    possibleAoiDwellSec: sumDwellSeconds(samples, (sample) => sample.possibleHits || [], recordingSampleIntervalMs),
    ambiguousSampleCount: samples.filter((sample) => (sample.ambiguousHits || []).length > 0).length,
    trustedSampleCount: samples.filter((sample) => sample.quality?.trustedForAoiAnalysis).length,
    accuracyValidated: stateLike.accuracyValidated,
    accuracyMeanPx: correctedAccuracySummary?.meanPx ?? null,
    accuracyP90Px: correctedAccuracySummary?.p90Px ?? null,
    accuracyMaxPx: correctedAccuracySummary?.maxPx ?? null,
    accuracyP90DispersionPx: correctedAccuracySummary?.p90DispersionPx ?? null,
    accuracyMaxDispersionPx: correctedAccuracySummary?.maxDispersionPx ?? null,
    selectedCalibrationProfile,
    calibrationProfile,
    calibrationProfileUsed: calibrationProfile,
    selectedValidationPolicyId: stateLike.selectedValidationPolicyId ?? 'prototype',
    validationPolicyId: stateLike.validationPolicyId ?? null,
    policyPassed: stateLike.policyPassed ?? null,
    policyFailures,
    validationGazeStreamQuality,
    droppedGazeSamples: stateLike.droppedGazeSamples,
    gazeStreamQuality,
    faceQualityAvailable: stateLike.faceQualityAvailable ?? false,
    faceQualityUnavailableReason: stateLike.faceQualityUnavailableReason ?? null,
    faceQualityBaseline,
    faceQualityInvalidations,
    rawGazeDiagnostic,
    aoiStability,
    benchmark,
  };
}

export function buildVideoPackageMetadata({
  sourceVideoInfo,
  sourceVideo,
  sidecarVideo = {},
  projection,
  stereoLayout,
}) {
  const durationSec = Number.isFinite(sourceVideo.duration)
    ? Number(sourceVideo.duration.toFixed(3))
    : null;

  return {
    ...sidecarVideo,
    ...sourceVideoInfo,
    name: sourceVideoInfo.kind === 'local-file'
      ? sourceVideoInfo.name
      : sidecarVideo.name || sourceVideoInfo.name || null,
    durationSec: durationSec ?? sidecarVideo.durationSec ?? null,
    projection: projection ?? sourceVideoInfo.projection ?? sidecarVideo.projection,
    stereoLayout: stereoLayout ?? sourceVideoInfo.stereoLayout ?? sidecarVideo.stereoLayout,
    src: sourceVideo.currentSrc || sourceVideo.src,
    width: sourceVideo.videoWidth || sourceVideoInfo.width || sidecarVideo.width || null,
    height: sourceVideo.videoHeight || sourceVideoInfo.height || sidecarVideo.height || null,
  };
}

export function buildProjectPackage({
  sourceVideoInfo,
  sourceVideo,
  sidecarVideo = {},
  projection,
  stereoLayout,
  aoiSource,
  aois,
  selectedCalibrationProfile,
  calibrationProfile,
  calibrationProfileUsed,
  selectedValidationPolicyId,
  validationPolicyId,
  faceQualityAvailable = false,
  faceQualityUnavailableReason = null,
  faceQualityBaseline = null,
  faceQualityInvalidations = [],
}) {
  const selectedProfileMetadata = buildCalibrationProfileMetadata(selectedCalibrationProfile);
  const calibrationProfileMetadata = buildCalibrationProfileMetadata(calibrationProfileUsed)
    ?? buildCalibrationProfileMetadata(calibrationProfile);

  return {
    version: 1,
    video: buildVideoPackageMetadata({
      sourceVideoInfo,
      sourceVideo,
      sidecarVideo,
      projection,
      stereoLayout,
    }),
    aois: {
      source: aoiSource,
      count: aois.length,
      packaged: true,
    },
    selectedCalibrationProfile: selectedProfileMetadata,
    calibrationProfile: calibrationProfileMetadata,
    calibrationProfileUsed: calibrationProfileMetadata,
    selectedValidationPolicyId: selectedValidationPolicyId ?? 'prototype',
    validationPolicyId: validationPolicyId ?? null,
    faceQualityAvailable,
    faceQualityUnavailableReason,
    faceQualityBaseline: cloneFaceQualityBaseline(faceQualityBaseline),
    faceQualityInvalidations: cloneFaceQualityInvalidations(faceQualityInvalidations),
    includesVideoBinary: false,
  };
}

export function buildExportPayload({
  sourceVideo,
  exportedAt,
  participant,
  project,
  video,
  summary,
  namedAoiMetrics,
  aoiSource,
  aois,
  state,
}) {
  const selectedCalibrationProfile = buildCalibrationProfileMetadata(state.selectedCalibrationProfile)
    ?? buildCalibrationProfileMetadata(summary?.selectedCalibrationProfile)
    ?? buildCalibrationProfileMetadata(project?.selectedCalibrationProfile);
  const calibrationProfile = buildCalibrationProfileMetadata(state.calibrationProfileUsed)
    ?? buildCalibrationProfileMetadata(state.calibrationProfile)
    ?? buildCalibrationProfileMetadata(summary?.calibrationProfileUsed)
    ?? buildCalibrationProfileMetadata(summary?.calibrationProfile)
    ?? buildCalibrationProfileMetadata(project?.calibrationProfileUsed)
    ?? buildCalibrationProfileMetadata(project?.calibrationProfile);
  const selectedValidationPolicyId = state.selectedValidationPolicyId
    ?? summary?.selectedValidationPolicyId
    ?? project?.selectedValidationPolicyId
    ?? 'prototype';
  const validationPolicyId = state.validationPolicyId
    ?? summary?.validationPolicyId
    ?? project?.validationPolicyId
    ?? null;
  const policyFailures = clonePolicyFailures(
    state.policyFailures ?? summary?.policyFailures,
  );
  const validationGazeStreamQuality = state.validationGazeStreamQuality
    ?? summarizeOptionalGazeStreamQuality(state.validationGazeStreamStats)
    ?? summary?.validationGazeStreamQuality
    ?? null;
  const faceQualityAvailable = state.faceQualityAvailable
    ?? summary?.faceQualityAvailable
    ?? project?.faceQualityAvailable
    ?? false;
  const faceQualityUnavailableReason = state.faceQualityUnavailableReason
    ?? summary?.faceQualityUnavailableReason
    ?? project?.faceQualityUnavailableReason
    ?? null;
  const faceQualityBaseline = state.faceQualityBaseline
    ?? summary?.faceQualityBaseline
    ?? project?.faceQualityBaseline
    ?? null;
  const faceQualityInvalidations = cloneFaceQualityInvalidations(
    state.faceQualityInvalidations
      ?? summary?.faceQualityInvalidations
      ?? project?.faceQualityInvalidations,
  );
  const gazeStreamQuality = state.gazeStreamQuality
    ?? summary?.gazeStreamQuality
    ?? summarizeGazeStreamQuality(state.gazeStreamStats);
  const rawGazeDiagnostic = cloneRawGazeDiagnostic(state.rawGazeDiagnostic ?? summary?.rawGazeDiagnostic);
  const aoiStability = cloneAoiStability(state.aoiStability ?? summary?.aoiStability);
  const benchmark = buildBenchmarkMetadata({
    participant,
    device: state.device
      ?? summary?.benchmark?.device
      ?? project?.benchmark?.device
      ?? null,
    accuracy: state.correctedAccuracySummary
      ?? summary?.benchmark?.accuracy
      ?? null,
    gazeStreamQuality,
    validationGazeStreamQuality,
    selectedCalibrationProfile,
    calibrationProfileUsed: calibrationProfile,
    selectedValidationPolicyId,
    validationPolicyId,
    policyPassed: state.policyPassed ?? summary?.policyPassed ?? null,
    policyFailures,
    recordingSampleIntervalMs: summary?.recordingSampleIntervalMs
      ?? summary?.benchmark?.recordingSampleIntervalMs
      ?? null,
    durationSec: summary?.durationSec
      ?? summary?.benchmark?.durationSec
      ?? null,
    faceQualityAvailable,
    faceQualityUnavailableReason,
    faceQualityInvalidations,
    rawGazeDiagnosticQuality: rawGazeDiagnostic?.quality ?? summary?.benchmark?.rawGazeDiagnosticQuality ?? null,
  });

  return {
    sourceVideo,
    exportedAt,
    participant,
    project,
    video,
    summary,
    namedAoiMetrics,
    statReport: buildStatReport({ namedAoiMetrics, summary, exportedAt }),
    aoiSource,
    aois,
    selectedCalibrationProfile,
    calibrationProfile,
    calibrationProfileUsed: calibrationProfile,
    selectedValidationPolicyId,
    validationPolicyId,
    policyPassed: state.policyPassed ?? summary?.policyPassed ?? null,
    policyFailures,
    validationGazeStreamQuality,
    accuracy: state.correctedAccuracySummary,
    rawValidationAccuracy: state.accuracySummary,
    correctionFitAccuracy: state.refinementAccuracySummary,
    gazeCorrection: state.gazeCorrection,
    localAccuracyErrorModel: state.localAccuracyErrorModel,
    accuracyValidated: state.accuracyValidated,
    accuracyInvalidationReason: state.accuracyInvalidationReason,
    liveGazeQuality: state.liveGazeQuality,
    faceQualityAvailable,
    faceQualityUnavailableReason,
    faceQualityBaseline: cloneFaceQualityBaseline(faceQualityBaseline),
    faceQualityInvalidations,
    rawGazeDiagnostic,
    aoiStability,
    gazeStreamQuality,
    droppedGazeSamples: state.droppedGazeSamples,
    benchmark,
    samples: state.samples,
  };
}
