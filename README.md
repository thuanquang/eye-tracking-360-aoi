# 360 Webcam AOI POC

Small browser proof of concept for mapping webcam gaze onto a 360 video player, classifying AOI hits, and exporting sample data for analysis.

AOIs can be static or time-keyframed boxes or polygons. 360 AOIs use panorama yaw/pitch. 2D AOIs use normalized video `x/y`. Polygon AOIs use a `shape: "polygon"` field with `points` in the same coordinate space. The bundled `assets/aois.json` marks `Front center object` as dynamic so hit testing changes with the video timestamp.

## Run

```powershell
npm install
npm run serve
```

Open `http://localhost:5179`. Use `localhost`, not `127.0.0.1`, because WebGazer needs a secure context or localhost camera access.

Use `http://localhost:5179/?mode=admin` for the researcher/admin view. This is the full setup and debugging interface: load video, load AOIs, calibrate, record, review, and export.

Use `http://localhost:5179/?mode=participant` for the participant view. This hides the researcher controls, collects participant metadata, then guides the participant toward calibration, accuracy check, recording, and fullscreen viewing. Browsers require a user click before entering fullscreen, so the participant presses `Start Participant Session` first.

The bundled test video is `assets/test-video.mp4`. You can also load any local MP4 from the file picker.

AOI definitions live in `assets/aois.json`. Edit that file to match the test video instead of changing app code. If the file is missing or invalid, the prototype falls back to built-in demo AOIs.

You can also load a local AOI sidecar with `Load AOI JSON`. The file can be either a bare AOI array or an exported project JSON with an `aois` array. Box AOIs use bounds such as `yawMin/yawMax` or normalized `xMin/xMax`; polygon AOIs use `shape: "polygon"` plus at least three `points`. This lets a local video and its AOI registration travel together without rebuilding the app.

For 360 or stereo 3D video, dynamic AOIs are stored as panorama-space yaw/pitch boxes or polygons with optional time `keyframes`. Sidecar project JSON may include `video.projection` such as `equirectangular` and `video.stereoLayout` such as `mono`, `top-bottom`, or `side-by-side`. The MVP does not model depth meshes or per-eye occlusion; it tracks attention to regions on the rendered panorama.

## Real Object AOIs

The app supports two AOI shapes:

- `box`: fast rectangular AOIs for rough regions.
- `polygon`: object-edge AOIs from manual drawing or Colab segmentation.

Polygon AOIs keep visible object edges editable while analysis can still use optional padding. For webcam gaze analysis, exact object-edge polygons may look precise, but gaze is still noisy. Use `analysisPaddingPx` to expand the effective AOI hit area while preserving the visible object edge for review.

Manual polygon annotation:

1. Open Admin mode.
2. Choose `2D flat` or `360 equirectangular`.
3. Click `Draw Polygon`.
4. Click around the visible object edge.
5. Double-click or press `Finish`.
6. Select the AOI row to rename, recolor, adjust padding, or delete.

Google Colab auto annotation:

1. Load the video in Admin mode.
2. Enter prompts such as `person`, `screen`, `sign`, or `product`.
3. Export the Colab job JSON.
4. Open `notebooks/google-colab-auto-aoi.ipynb` in Colab with a GPU runtime.
5. Upload the video and job JSON.
6. Download `generated-colab-aois.json`.
7. Import it with `Import Colab AOIs`.
8. Review and edit before participant collection.

Generated polygon AOIs are proposals. They may miss objects, merge objects, or produce imperfect edges. Review them before using them for research.

## Admin AOI Authoring

Admin mode now has three AOI creation paths:

1. `Manual AOI`: choose the video projection, label, size, and color, then add a centered box AOI at the current view. For `2D flat`, this creates normalized `x/y` AOIs. For `360 equirectangular`, this creates yaw/pitch AOIs at the current camera center.
2. `Draw Polygon`: click around a visible object edge to create an editable polygon AOI. Polygon vertices can be dragged at static AOIs or exact dynamic keyframes.
3. `Google Colab AOI`: enter detection prompts such as `person`, `screen`, `sign`, or `product`, export a Colab job JSON, run `notebooks/google-colab-auto-aoi.ipynb` in Google Colab with the video and job JSON, then import the generated AOI JSON.

The Colab notebook uses Florence-2 object detection, SAM 2 masks, and OpenCV contours on sampled video frames, then writes ordinary polygon AOI JSON. The generated AOIs are proposals: review labels, duplicates, missed objects, and low-quality tracks before recording participants.

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
- `participant`: participant metadata when the recording was started from Participant mode; `null` for admin/debug exports.
- `video`: current video metadata such as name, type, size, duration, and source URL/path.
- `samples`: raw per-sample gaze, quality/trust metadata, panorama yaw/pitch, active AOI bounds or polygon points, AOI hit ids, and uncertainty.
- `aois`: AOI definitions, including optional dynamic `keyframes` and polygon `points`.
- `namedAoiMetrics`: named per-AOI and session-level research metrics derived from the sample stream.
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

`namedAoiMetrics.perAoi` is keyed by AOI id and keeps the human AOI label from the AOI JSON. Each AOI includes hit counts, likely/possible/ambiguous counts, dwell seconds, first hit time, simple fixation count, average fixation duration, time to first fixation, and percentage of viewing time.

`namedAoiMetrics.session` includes total samples, total duration, total fixations, average fixation duration, average number of AOIs fixated, AOI coverage percent, and an MVP-level overall processing efficiency score based on time spent in AOIs. These fixation-style metrics are useful for the research demo, but with webcam tracking they should be described as approximations unless validated in a pilot.

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
