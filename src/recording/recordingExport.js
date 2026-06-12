import { summarizeGazeStreamQuality } from '../gaze/qualityMonitor.js';
import { DEFAULT_RECORDING_SAMPLE_INTERVAL_MS } from './sampleScheduler.js';

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

export function buildExportSummary(samples, stateLike, sampleIntervalMs = DEFAULT_RECORDING_SAMPLE_INTERVAL_MS) {
  const recordingSampleIntervalMs = Number.isFinite(sampleIntervalMs) && sampleIntervalMs > 0
    ? sampleIntervalMs
    : DEFAULT_RECORDING_SAMPLE_INTERVAL_MS;
  const durationSec = getSampleDurations(samples, recordingSampleIntervalMs)
    .reduce((sum, duration) => sum + duration, 0);
  const correctedAccuracySummary = stateLike.correctedAccuracySummary;
  const gazeStreamQuality = stateLike.gazeStreamQuality
    ?? summarizeGazeStreamQuality(stateLike.gazeStreamStats);
  const selectedCalibrationProfile = buildCalibrationProfileMetadata(stateLike.selectedCalibrationProfile);
  const calibrationProfile = buildCalibrationProfileMetadata(stateLike.calibrationProfileUsed)
    ?? buildCalibrationProfileMetadata(stateLike.calibrationProfile);

  return {
    totalSamples: samples.length,
    recordingSampleIntervalMs,
    durationSec: Number(durationSec.toFixed(3)),
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
    droppedGazeSamples: stateLike.droppedGazeSamples,
    gazeStreamQuality,
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

  return {
    sourceVideo,
    exportedAt,
    participant,
    project,
    video,
    summary,
    namedAoiMetrics,
    aoiSource,
    aois,
    selectedCalibrationProfile,
    calibrationProfile,
    calibrationProfileUsed: calibrationProfile,
    accuracy: state.correctedAccuracySummary,
    rawValidationAccuracy: state.accuracySummary,
    correctionFitAccuracy: state.refinementAccuracySummary,
    gazeCorrection: state.gazeCorrection,
    localAccuracyErrorModel: state.localAccuracyErrorModel,
    accuracyValidated: state.accuracyValidated,
    accuracyInvalidationReason: state.accuracyInvalidationReason,
    liveGazeQuality: state.liveGazeQuality,
    gazeStreamQuality: state.gazeStreamQuality
      ?? summary?.gazeStreamQuality
      ?? summarizeGazeStreamQuality(state.gazeStreamStats),
    droppedGazeSamples: state.droppedGazeSamples,
    samples: state.samples,
  };
}
