# 360 Webcam AOI POC

Small browser proof of concept for mapping webcam gaze onto a 360 video player, classifying AOI hits, and exporting sample data for analysis.

AOIs can be static yaw/pitch boxes or simple time-keyframed boxes. The bundled `assets/aois.json` marks `Front center object` as dynamic so hit testing changes with the video timestamp.

## Run

```powershell
npm install
npm run serve
```

Open `http://localhost:5179`. Use `localhost`, not `127.0.0.1`, because WebGazer needs a secure context or localhost camera access.

The bundled test video is `assets/test-video.mp4`. You can also load any local MP4 from the file picker.

AOI definitions live in `assets/aois.json`. Edit that file to match the test video instead of changing app code. If the file is missing or invalid, the prototype falls back to built-in demo AOIs.

You can also load a local AOI sidecar with `Load AOI JSON`. The file can be either a bare AOI array or an exported project JSON with an `aois` array. This lets a local video and its AOI registration travel together without rebuilding the app.

For 360 or stereo 3D video, dynamic AOIs are stored as panorama-space yaw/pitch boxes with optional time `keyframes`. Sidecar project JSON may include `video.projection` such as `equirectangular` and `video.stereoLayout` such as `mono`, `top-bottom`, or `side-by-side`. The MVP does not model depth meshes or per-eye occlusion; it tracks attention to regions on the rendered panorama.

## Accurate Webcam Test Protocol

1. Sit still, centered in frame, with your face evenly lit.
2. Use `http://localhost:5179`, not `127.0.0.1`, so webcam access works reliably.
3. Keep the browser/player at the size you will use for the recording. If you resize after validation, run `Check accuracy` again.
4. Put the webcam roughly eye level. Avoid strong side light, backlight, face shadows, and reflections on glasses.
5. Choose `Webcam gaze`.
6. Click `Calibrate webcam`.
7. For every target, move your eyes first, keep your head still, then click once and keep looking at the target until it advances.
8. Click `Check accuracy` and do the same thing for every target.
9. Record only if the status says `validated ...px`.
10. If it says poor, untested, or recheck needed, recalibrate before recording.

During testing, judge the MVP using the validation numbers, not whether the cursor feels perfect. Under about `90px` mean error is good for this webcam POC; `90-180px` is usable for larger AOIs and dwell-time analysis. The app also checks p90 error, capture dispersion, and worst-target error, so one badly tracked or shaky region can force a recalibration even when the mean looks okay.

The accuracy check has two phases. The first targets fit a correction model; separate holdout targets validate it. If validation passes, the app rebuilds the final live correction from both sets of measured targets so recording uses the strongest model available. If too many accepted targets cluster in one area of the player, validation fails and asks you to retry.

For the best shot at accuracy:

- Keep your head position fixed after calibration.
- Do not drag the 360 view while validating or recording unless that is part of the test.
- During calibration, if the app says gaze was lost during training, keep looking at that same target and retry it. Rejected training windows are not committed to WebGazer.
- If gaze drifts after WebGazer training records have already started, the app may reset calibration to the first target so contaminated records are cleared.
- Make AOIs larger than the validation error radius when possible.
- Prefer `likelyAoiDwellSec` over exact hit counts when webcam accuracy is only usable.
- Re-run `Check accuracy` whenever the chair, camera, browser size, lighting, or head position changes.
- If the browser loses focus or the tab is hidden after validation, the app invalidates webcam accuracy and asks for a new check.
- Validated webcam accuracy expires after about 5 minutes; run `Check accuracy` again for longer sessions.
- Treat any high capture p90 or worst-target number as a setup problem: adjust lighting/camera/face position and recalibrate.

The prototype pauses the video during calibration and accuracy checks so moving video content does not distract your gaze.

## Reading The Result

Exported JSON contains:

- `project`: lightweight package metadata tying the recording to video identity, AOI source, and AOI count. The export includes AOI definitions, but not the video binary.
- `video`: current video metadata such as name, type, size, duration, and source URL/path.
- `samples`: raw per-sample gaze, quality/trust metadata, panorama yaw/pitch, active AOI bounds, AOI hit ids, and uncertainty.
- `aois`: AOI definitions, including optional dynamic `keyframes`.
- `summary.totalSamples`: number of recorded samples.
- `summary.durationSec`: estimated recording duration.
- `summary.aoiHitCounts`: exact AOI hit counts.
- `summary.aoiDwellSec`: estimated seconds inside each exact AOI.
- `summary.likelyAoiDwellSec`: estimated seconds in AOIs where the validated webcam error still fits inside the AOI.
- `summary.ambiguousSampleCount`: samples near an AOI boundary or inside the gaze uncertainty radius.
- `summary.trustedSampleCount`: samples trusted for AOI analysis.
- `accuracy`: independent validation result after correction, including mean, median, p90, worst-target pixel error, and target-capture dispersion.
- `accuracyValidated`: whether webcam data was trusted for recording.
- `gazeUncertainty`: per-sample webcam uncertainty; after validation it grows near player regions that had larger local error or capture dispersion.

For the MVP demo, prefer `likelyAoiDwellSec` when webcam accuracy is noisy. Use exact `aoiDwellSec` for mouse-mode sanity checks or very good webcam validation.

## Reviewing A Past Recording

Use the same video that was used for recording. For the bundled test video this happens automatically.

1. Open `http://localhost:5179`.
2. Load the matching video first if the recording used a local video.
3. Use `Load recording JSON` and choose an exported `aoi-samples-*.json` file.
4. Click `Review Recording`.
5. Press `Play` to replay over time, or scrub the video timeline to inspect individual moments.

Review mode replays the recorded tracker from the exported panorama yaw/pitch, restores the recorded camera direction, and uses the packaged active AOIs for hit readouts. The export still does not include the video binary, so local-video recordings need the matching video loaded manually.

## Practical Limits

This is not hardware eye tracking. WebGazer webcam accuracy depends heavily on lighting, face angle, glasses, webcam quality, and how still you keep your head. The app blocks or invalidates obviously unreliable recording, but real accuracy still has to be judged from the validation pixel error and the exported uncertainty fields.

For small AOIs, webcam gaze may only be useful as `possible` or `ambiguous` attention evidence. Larger AOIs and dwell-time analysis are much more reliable for this POC.
