# AOI Stat Definitions

This app reports AOI metrics from webcam or mouse gaze samples. Webcam-derived metrics depend on calibration accuracy, AOI size, stream quality, and participant stability, so reports should include accuracy and trust metadata beside the AOI table.

## Recommended Primary Metrics

- `likelyDwellSec`: preferred dwell-time metric for webcam recordings because it counts samples where validated gaze uncertainty still supports the AOI.
- `stableDwellSec`: stricter dwell-time metric when AOI stability is available.
- `totalFixationDurationMs`: total fixation duration mapped to each AOI.
- `averageFixationDurationMs`: average duration of fixations mapped to each AOI.
- `timeToFirstFixationMs`: milliseconds from recording start to the first fixation on each AOI.
- `percentageOfViewingTime`: AOI dwell share of total recording duration.
- `summary.heatmaps.screen` and `summary.heatmaps.panorama`: duration-weighted gaze density grids for heatmap rendering.

## Secondary Metrics

- `fixationCount`: useful for comparing repeated attention, but noisier than dwell time.
- `firstFixationDurationMs`: duration of the first fixation mapped to each AOI.
- `revisitCount`: number of returns to an AOI after fixating another AOI.
- `averageNumberOfAoisFixated`: unique AOIs fixated in one recording; average this field across participants for study-level reporting.
- `aoiCoveragePercent`: percent of AOIs fixated at least once.
- `trustedSampleCount` and `ambiguousSampleCount`: context fields for judging whether AOI results are usable.

## Experimental Metrics

- `averageSaccadeDurationMs`: derived from gaps between fixation windows. Use for debugging and pilot comparison only; it is not validated saccade physiology.
- `overallProcessingEfficiency`: transparent MVP composite. Always report the formula and component measures with this score.

## Recommended Output Shape

Use `statReport.perAoiRows` for a display-ready result table, `namedAoiMetrics` for raw machine-readable metrics, `summary.heatmaps` for heatmap rendering, and the AOI stats CSV for spreadsheet analysis.
