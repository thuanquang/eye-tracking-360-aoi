# Eye Tracking Benchmark Protocol

This protocol gives repeatable evidence for the current WebGazer-based 360 AOI pipeline. It is intended for pilot benchmarking and regression checks, not as a claim of hardware eye-tracker precision.

## Goal

Measure how calibration profile choice, validation policy, stream quality, and face/head stability affect exported AOI metrics. Each exported recording should be usable as one benchmark run in a markdown report generated from `src/gaze/benchmark.js`.

## Setup

1. Use the same app version, browser, video, AOI sidecar, and viewport size for a comparison set.
2. Use `http://localhost:5179/?mode=participant` for participant runs, or admin mode for controlled pilot runs.
3. Record participant id and device notes before starting. Include laptop/desktop, webcam model or built-in camera if known, screen size, glasses, lighting, approximate face distance, and any unusual setup detail.
4. Place the webcam near eye level. Keep the participant centered, evenly lit, and seated at the same distance during calibration, validation, and recording.
5. Avoid browser resize, fullscreen changes, camera movement, chair movement, and large lighting changes after validation. If any of these happen, recalibrate and rerun validation.

## Run Steps

1. Select `Webcam gaze`.
2. Choose the calibration profile under test. For a full comparison, run separate sessions for `standard`, `research-39`, and `research-78`.
3. Calibrate with eyes moving to each target first, head still, then one click while continuing to look at the target.
4. Run `Check accuracy` immediately after calibration.
5. For benchmark-grade runs, use the `research` validation policy. A failed policy result should still be exported and reported as a failed run, not silently discarded.
6. Confirm the stream is close to the intended 30 Hz recording cadence and that data integrity is acceptable for the study goal.
7. Record at least 30 seconds. Include a short target-following segment and the actual AOI-viewing task when possible.
8. Export JSON before changing calibration, validation, video, AOIs, or browser layout.
9. Repeat the same steps for each participant/device/profile combination.

## Exported Benchmark Metadata

Each export includes compact benchmark metadata at `benchmark`, and the summary also includes `summary.benchmark`. These objects copy only report-friendly fields, not the raw sample array.

Report these fields for every run:

- Participant id and device notes when available.
- Calibration profile selected and calibration profile used.
- Validation policy selected and used.
- Policy result and policy failures.
- Validation accuracy: mean, p90, max, and target-capture dispersion when present.
- Recording stream quality: effective Hz, accepted Hz, data integrity percent, on-screen percent, and dropped reasons.
- Validation stream quality when present.
- Recording sample interval and duration.
- Face/head quality availability, unavailable reason, and face stability invalidation count.
- Fixation and dwell metrics from `namedAoiMetrics`, especially dwell seconds, likely dwell seconds, fixation count, average fixation duration, time to first fixation, AOI coverage percent, and overall processing efficiency.

## Report Generation

Use exported `benchmark` objects or manual run objects with `summarizeBenchmarkRuns(runs)` and `buildBenchmarkReport({ summary, runs })`.

Manual run objects may use either `streamQuality` or the export field name `gazeStreamQuality`:

```js
import {
  buildBenchmarkReport,
  summarizeBenchmarkRuns,
} from './src/gaze/benchmark.js';

const runs = exportedPayloads.map((payload) => payload.benchmark);
const summary = summarizeBenchmarkRuns(runs);
const markdown = buildBenchmarkReport({ summary, runs });
```

The summary reports run count plus finite-value means for mean accuracy px, p90 px, max px, effective Hz, and data integrity percent. Missing, `NaN`, and infinite values are ignored; if a metric has no finite inputs, its mean is `null`.

## Interpretation

Prefer comparisons within the same protocol instead of comparing one-off values across different rooms, cameras, or browser layouts. Larger AOIs and dwell-time measures are more reliable than small target hit counts when webcam validation error is high.

For Phase 2, a useful benchmark report should answer:

- Which calibration profile produced the lowest validation error without excessive setup time?
- Did the research validation policy pass, and if not, which metric failed?
- Was stream quality near the 30 Hz sampling target during validation and recording?
- Did face/head stability remain available and stable through the run?
- Do fixation and dwell metrics remain consistent across repeated runs for the same task?

Treat the results as evidence for whether the prototype is stable enough for a pilot, not as proof of RealEye-level precision.
