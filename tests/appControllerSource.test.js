import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const controllerSource = await readFile(new URL('../src/app/appController.js', import.meta.url), 'utf8');
const stylesSource = await readFile(new URL('../styles.css', import.meta.url), 'utf8');

test('participant record control synchronizes video playback with recording', () => {
  assert.match(
    controllerSource,
    /async function toggleParticipantRecording\(\)[\s\S]*startSynchronizedParticipantPlayback/,
    'Participant recording should start the video through a synchronized participant path.',
  );
  assert.match(
    controllerSource,
    /async function toggleParticipantRecording\(\)[\s\S]*await setWebcamMode\(\);[\s\S]*if \(!state\.webcamStarted\) \{[\s\S]*return;[\s\S]*\}[\s\S]*startSynchronizedParticipantPlayback/,
    'Participant recording should start the gaze tracker before video playback and recording.',
  );
  assert.match(
    controllerSource,
    /participantRecordButton\.addEventListener\('click',\s*toggleParticipantRecording\)/,
    'Participant record button should use participant-specific synchronized behavior.',
  );
  assert.match(
    controllerSource,
    /async function toggleParticipantRecording\(\)[\s\S]*await requestParticipantFullscreen\(\);[\s\S]*setRecordingActive\(true\)/,
    'Participant recording should request fullscreen from the recording click before entering recording focus.',
  );
});

test('participant recording shows startup feedback before awaiting the tracker', () => {
  assert.match(
    controllerSource,
    /async function toggleParticipantRecording\(\)[\s\S]*setWebcamStatus\('starting'\);[\s\S]*syncParticipantSessionControls\(\);[\s\S]*await setWebcamMode\(\);[\s\S]*startSynchronizedParticipantPlayback/,
    'Participant recording should immediately show tracker startup feedback before awaiting camera/provider startup.',
  );
});

test('participant video playback also synchronizes recording state', () => {
  assert.match(
    controllerSource,
    /sourceVideo\.addEventListener\('play',\s*syncParticipantRecordingFromPlayback\)/,
    'Participant mode should start recording when the video starts by any playback gesture.',
  );
  assert.match(
    controllerSource,
    /sourceVideo\.addEventListener\('pause',\s*syncParticipantRecordingFromPlayback\)/,
    'Participant mode should stop recording when the video pauses.',
  );
});

test('participant hosted calibration return starts gaze before direct recording', () => {
  assert.doesNotMatch(
    controllerSource,
    /participantAccuracyButton\.addEventListener\('click',\s*startAccuracyCheck\)/,
    'Participant mode should not require a separate in-app accuracy action before recording.',
  );
  assert.doesNotMatch(
    controllerSource,
    /function canRecordCurrentMode\(\)[\s\S]*state\.appMode === 'participant'[\s\S]*state\.accuracyValidated/,
    'Participant recording should not require a completed in-app accuracy validation.',
  );
  assert.match(
    controllerSource,
    /state\.appMode === 'participant'[\s\S]*getSeeSoCalibrationData\(\)/,
    'Participant recording should become available after hosted camera calibration.',
  );
  assert.match(
    controllerSource,
    /autoStartGazeAfterCalibrationReturn/,
    'Participant mode should have an explicit hosted calibration return auto-start hook.',
  );
  assert.match(
    controllerSource,
    /restoreParticipantState\(\);[\s\S]*applyAppMode\(\);[\s\S]*void autoStartGazeAfterCalibrationReturn\(\);/,
    'Participant state should restore before auto-starting gaze from returned hosted calibration.',
  );
});

test('validation hosted calibration return starts gaze before accuracy recording', () => {
  assert.match(
    controllerSource,
    /returnedCalibrationData && isSeeSoProviderSelected\(\)[\s\S]*shouldAutoStartSeeSoGazeAfterCalibrationReturn = true/,
    'Hosted calibration return should schedule tracker startup after calibration data is stored.',
  );
  assert.match(
    controllerSource,
    /function getHostedCalibrationReturnNotice\([\s\S]*mode === 'validation'[\s\S]*kiểm tra độ chính xác/,
    'Hosted calibration return notice should be specific to standalone validation mode.',
  );
  assert.match(
    controllerSource,
    /async function autoStartGazeAfterCalibrationReturn\(\)[\s\S]*state\.appMode !== 'participant'[\s\S]*state\.appMode !== 'validation'[\s\S]*return;/,
    'Calibration return auto-start should allow both participant and validation modes.',
  );
  assert.match(
    controllerSource,
    /autoStartGazeAfterCalibrationReturn\(\)[\s\S]*setWebcamStatus\('starting'\);[\s\S]*await setWebcamMode\(\);/,
    'Validation mode should start the tracker immediately after returning from hosted calibration.',
  );
  assert.match(
    controllerSource,
    /applyAppMode\(\);[\s\S]*void autoStartGazeAfterCalibrationReturn\(\);/,
    'App mode should be applied before deciding whether to auto-start validation gaze.',
  );
});

test('participant mode uses the selected study video instead of random assignment', () => {
  assert.doesNotMatch(
    controllerSource,
    /getRandomStudyVideo/,
    'Participant mode should not randomly choose a study video.',
  );
  assert.match(
    controllerSource,
    /participantStudyVideoSelect\.addEventListener\('change',\s*handleParticipantStudyVideoChange\)/,
    'Participant setup should wire an explicit study-video selector.',
  );
  assert.doesNotMatch(
    controllerSource,
    /if \(isParticipant\) \{[\s\S]*setStudyVideo\(getRandomStudyVideo\(\)\.id/,
    'Participant mode should preserve the selected study video before the participant starts.',
  );
  assert.match(
    controllerSource,
    /function\s+collectParticipantDraft\(\)[\s\S]*studyVideoId:\s*selectedStudyVideo\.id/,
    'Participant draft state should remember the selected study video before hosted calibration.',
  );
  assert.match(
    controllerSource,
    /function\s+persistParticipantSessionState\(\)[\s\S]*studyVideoId:\s*selectedStudyVideo\.id/,
    'Participant session state should persist the selected study video across calibration redirects.',
  );
  assert.match(
    controllerSource,
    /function\s+restoreParticipantStudyVideo\(\s*videoId\s*\)[\s\S]*setStudyVideo\(videoId,\s*\{\s*clearAois:\s*true\s*\}\)/,
    'Participant restore should set the saved study video instead of falling back to the default.',
  );
});

test('participant restore selects the saved study video before the initial AOI load', () => {
  assert.match(
    controllerSource,
    /restoreParticipantState\(\);[\s\S]*if \(!sourceVideo\.getAttribute\('src'\)\) \{[\s\S]*setStudyVideo\(selectedStudyVideo\.id,\s*\{\s*clearAois:\s*true\s*\}\)/,
    'Startup should restore a participant-selected study video before loading the first generated AOI package.',
  );
  assert.doesNotMatch(
    controllerSource,
    /setStudyVideo\(selectedStudyVideo\.id,\s*\{\s*clearAois:\s*true\s*\}\);[\s\S]*restoreParticipantState\(\);/,
    'Startup should not load the default study AOIs before restoring the participant session.',
  );
});

test('flat study videos mark the viewer as non-interactive for camera drag', () => {
  assert.match(
    controllerSource,
    /viewer\.classList\.toggle\('is-flat-video',\s*getCurrentProjection\(\)\s*===\s*'flat'\)/,
    'Flat 2D videos should mark the viewer with a non-interactive class.',
  );
});

test('AOI stats are gated behind explicit analytics mode entry points', () => {
  assert.match(
    controllerSource,
    /let\s+analyticsMode\s*=\s*null/,
    'The controller should track whether the sidebar is in analytics mode.',
  );
  assert.match(
    controllerSource,
    /function\s+enterAnalyticsMode\(\s*source\s*\)/,
    'The controller should have one explicit analytics mode entry helper.',
  );
  assert.match(
    controllerSource,
    /function\s+exitAnalyticsMode\(/,
    'The controller should have one explicit analytics mode exit helper.',
  );
  assert.match(
    controllerSource,
    /function\s+renderAoiStatsPanel\(\)\s*\{[\s\S]*?analyticsMode\s*===\s*null[\s\S]*?return;/,
    'AOI stats should not render into the sidebar outside analytics mode.',
  );
});

test('recording stop and JSON load enter analytics mode', () => {
  assert.match(
    controllerSource,
    /function\s+setRecordingActive\(\s*isRecording\s*\)[\s\S]*?enterAnalyticsMode\('live'\)/,
    'Stopping a live recording should enter analytics mode for live samples.',
  );
  assert.match(
    controllerSource,
    /function\s+registerRecording\(\s*json,\s*source\s*\)[\s\S]*?enterAnalyticsMode\('review'\)/,
    'Loading a recording JSON should enter analytics mode for review samples.',
  );
  assert.match(
    controllerSource,
    /exitAnalyticsButton\.addEventListener\('click',\s*\(\)\s*=>\s*exitAnalyticsMode\(\)\)/,
    'The analytics panel should wire a Back to controls action.',
  );
});

test('sidebar heatmap preview is removed from the app controller', () => {
  assert.doesNotMatch(
    controllerSource,
    /drawHeatmapPreview/,
    'The old sidebar heatmap renderer should be removed.',
  );
  assert.doesNotMatch(
    controllerSource,
    /heatmapCanvas/,
    'The controller should no longer reference the sidebar heatmap canvas.',
  );
  assert.match(
    controllerSource,
    /function\s+drawGazeHeatmapOverlay\(/,
    'The controller should render heatmap data into the player overlay.',
  );
});

test('player heatmap uses a high-contrast hotspot palette', () => {
  assert.match(
    controllerSource,
    /gradient\.addColorStop\(0,\s*`rgba\(255,\s*255,\s*255,/,
    'The player heatmap should use a white-hot center so dense hotspots stand out.',
  );
  assert.match(
    controllerSource,
    /gradient\.addColorStop\(0\.16,\s*`rgba\(255,\s*24,\s*16,/,
    'The player heatmap should add a saturated red core around the hotspot.',
  );
  assert.match(
    controllerSource,
    /gradient\.addColorStop\(0\.42,\s*`rgba\(255,\s*210,\s*28,/,
    'The player heatmap should include a vivid amber body before fading outward.',
  );
  assert.match(
    controllerSource,
    /gradient\.addColorStop\(0\.72,\s*`rgba\(0,\s*220,\s*255,/,
    'The player heatmap should use an electric cyan fringe for visible falloff.',
  );
});

test('player heatmap updates a dynamic intensity ruler', () => {
  assert.match(
    controllerSource,
    /function\s+updateHeatmapRuler\(\s*range\s*=\s*null\s*\)/,
    'The controller should update one heatmap ruler helper from overlay state.',
  );
  assert.match(
    controllerSource,
    /heatmapRuler\.hidden\s*=\s*analyticsMode\s*===\s*null\s*\|\|\s*!range/,
    'The ruler should be hidden outside analytics mode or when no heatmap points draw.',
  );
  assert.match(
    controllerSource,
    /heatmapRulerMin\.textContent\s*=\s*formatHeatmapWeightMs\(range\.minWeightMs\)/,
    'The ruler minimum label should be based on the currently drawn heatmap weights.',
  );
  assert.match(
    controllerSource,
    /heatmapRulerMax\.textContent\s*=\s*formatHeatmapWeightMs\(range\.maxWeightMs\)/,
    'The ruler maximum label should be based on the currently drawn heatmap weights.',
  );
  assert.match(
    controllerSource,
    /updateHeatmapRuler\(\{\s*minWeightMs,\s*maxWeightMs,\s*pointCount:\s*drawnPoints\.length\s*\}\)/,
    'Drawing the heatmap should publish the active intensity range to the ruler.',
  );
});

test('video ready events do not overwrite visible workflow notices', () => {
  assert.match(
    controllerSource,
    /const\s+initialViewerNoticeText\s*=\s*viewerNotice\.textContent/,
    'The controller should remember the initial placeholder notice separately from runtime workflow notices.',
  );
  assert.match(
    controllerSource,
    /function\s+isViewerNoticeShowingWorkflowMessage\(\)[\s\S]*viewerNotice\.textContent\s*!==\s*initialViewerNoticeText/,
    'The controller should distinguish visible workflow notices from the initial placeholder.',
  );
  assert.match(
    controllerSource,
    /function\s+syncVideoNotice\(\)[\s\S]*if\s*\(\s*isViewerNoticeShowingWorkflowMessage\(\)\s*\)\s*\{[\s\S]*?return;[\s\S]*?\}[\s\S]*setNotice\('Video/,
    'Video readiness should not replace visible AOI upload or workflow messages.',
  );
});

test('participant export downloads local CSV instead of uploading study data', () => {
  assert.match(
    controllerSource,
    /function\s+setParticipantUploadStatus\(/,
    'The controller should keep a participant export status helper for local-download feedback.',
  );
  assert.match(
    controllerSource,
    /state\.appMode === 'participant'[\s\S]*?exportParticipantStatsCsv\(\);[\s\S]*?return;/,
    'Participant export should download a stats CSV locally instead of submitting data online.',
  );
  assert.match(
    controllerSource,
    /const\s+fileName\s*=\s*buildParticipantCsvFileName\(\);[\s\S]*?downloadText\(csv,\s*fileName,\s*'text\/csv;charset=utf-8'\)/,
    'Participant CSV export should use one local file name for the download and status message.',
  );
  assert.match(
    controllerSource,
    /function\s+exportParticipantJson\(\)[\s\S]*downloadJson\(payload,\s*buildParticipantJsonFileName\(\)\)/,
    'Participant results should offer a local JSON export.',
  );
  assert.match(
    controllerSource,
    /function\s+exportParticipantHeatmap\(\)[\s\S]*summary\.heatmaps[\s\S]*downloadJson\(heatmapPayload,\s*buildParticipantHeatmapFileName\(\)\)/,
    'Participant results should offer a local heatmap export.',
  );
  assert.match(
    controllerSource,
    /PARTICIPANT_EXPORT_SUCCESS_MESSAGE/,
    'Participant exports should show the requested success message after data is ready.',
  );
  assert.doesNotMatch(
    controllerSource,
    /await\s+submitParticipantExport/,
    'Participant export should not attempt an R2 upload before downloading locally.',
  );
});

test('participant recording focus mode hides chrome while recording', () => {
  assert.match(
    controllerSource,
    /appShell\.classList\.toggle\('is-participant-recording-focus',\s*state\.appMode\s*===\s*'participant'\s*&&\s*state\.isRecording\)/,
    'Participant recording should expose a focused fullscreen class while recording is active.',
  );
});

test('participant recording stops when the study clip ends', () => {
  assert.match(
    controllerSource,
    /async function startSynchronizedParticipantPlayback\(\)[\s\S]*?if \(state\.appMode === 'participant'\) \{[\s\S]*?sourceVideo\.loop = false;[\s\S]*?\}/,
    'Participant recording should play the study clip once instead of looping while chrome is hidden.',
  );
  assert.match(
    controllerSource,
    /function handleParticipantVideoEnded\(\)[\s\S]*?state\.appMode !== 'participant'[\s\S]*?state\.isRecording[\s\S]*?setRecordingActive\(false\)/,
    'Participant recording should return to the export controls after the clip ends.',
  );
  assert.match(
    controllerSource,
    /sourceVideo\.addEventListener\('ended',\s*handleParticipantVideoEnded\)/,
    'The participant-ended handler should be wired to the study video element.',
  );
});

test('participant recording has a visible countdown and a 30 second guardrail', () => {
  assert.match(
    controllerSource,
    /const\s+PARTICIPANT_RECORDING_LIMIT_SEC\s*=\s*30/,
    'Participant recording should default to a 30 second max duration.',
  );
  assert.match(
    controllerSource,
    /function\s+updateParticipantRecordingCountdown\([\s\S]*participantRecordingCountdown\.textContent/,
    'Participant recording should update an on-player countdown.',
  );
  assert.match(
    controllerSource,
    /function\s+enforceParticipantRecordingLimit\([\s\S]*setRecordingActive\(false\)[\s\S]*pauseSynchronizedParticipantPlayback\(\)/,
    'Participant recording should stop automatically when the countdown expires.',
  );
});

test('participant recording samples are trusted for AOI analysis without in-app accuracy validation', () => {
  assert.match(
    controllerSource,
    /state\.appMode === 'participant'\s*\|\|\s*state\.mode !== 'webcam'\s*\|\|\s*state\.accuracyValidated/,
    'Participant samples should count for AOI metrics even when validation is handled by the separate validation flow.',
  );
});

test('recording sample collection does not resync the participant panel every frame', () => {
  const maybeSampleFunction = controllerSource.match(
    /function maybeSample\(now\) \{[\s\S]*?\n  \}/,
  )?.[0] || '';

  assert.notEqual(maybeSampleFunction, '', 'The controller should define maybeSample.');
  assert.match(
    maybeSampleFunction,
    /sampleCount\.textContent = String\(state\.samples\.length\);/,
    'Recording samples should keep the sample counter current.',
  );
  assert.doesNotMatch(
    maybeSampleFunction,
    /syncParticipantSessionControls\(\);/,
    'Recording samples should not resync participant controls at sampling rate.',
  );
});

test('validation mode shows a stats popup after accuracy validation completes', () => {
  assert.match(
    controllerSource,
    /function\s+showValidationStatsPopup\(\s*evaluation,\s*summary\s*\)/,
    'Validation mode should have one helper that renders the validation results popup.',
  );
  assert.match(
    controllerSource,
    /state\.appMode !== 'validation'/,
    'The popup should be scoped to the standalone validation test flow.',
  );
  assert.match(
    controllerSource,
    /setAccuracySummary\(correctedValidationSummary\);\s*showValidationStatsPopup\(evaluation,\s*correctedValidationSummary\);/,
    'A completed validation run should render the popup with the corrected validation summary.',
  );
  assert.match(
    controllerSource,
    /setAccuracySummary\(evaluation\.accuracySummary\);\s*showValidationStatsPopup\(evaluation,\s*evaluation\.accuracySummary\);/,
    'Incomplete validation runs should still show the popup instead of silently ending.',
  );
  assert.match(
    controllerSource,
    /validationStatsCloseButton\.addEventListener\('click',\s*hideValidationStatsPopup\)/,
    'The popup should have a direct close action.',
  );
});

test('validation mode hides controls beside the screen during active accuracy targets', () => {
  assert.match(
    controllerSource,
    /const\s+isAccuracyTargetActive\s*=\s*isValidationTest\s*&&\s*state\.targetMode\s*===\s*'accuracy'\s*&&\s*!calibrationOverlay\.hidden/,
    'Validation mode should identify when the active accuracy target overlay is running.',
  );
  assert.match(
    controllerSource,
    /appShell\.classList\.toggle\('is-accuracy-check-active',\s*isAccuracyTargetActive\)/,
    'Validation mode should expose an accuracy-active class for hiding the controls.',
  );
});

test('validation recording focus keeps a small sidebar popup over a fullscreen viewer', () => {
  assert.match(
    controllerSource,
    /appShell\.classList\.toggle\('is-validation-recording-focus',\s*isAccuracyTargetActive\)/,
    'Validation mode should expose a recording-focus class while accuracy targets are active.',
  );
  assert.match(
    stylesSource,
    /\.app-shell\.is-validation-test\.is-validation-recording-focus\s+#validationTestPanel\s*\{[\s\S]*?width:\s*56px;[\s\S]*?height:\s*56px;/,
    'The validation sidebar should collapse into a small popup while recording validation targets.',
  );
  assert.doesNotMatch(
    stylesSource,
    /\.app-shell\.is-validation-test\.is-validation-recording-focus\s+#validationTestPanel\s*\{[\s\S]*?translateX\(calc\(100%/,
    'The collapsed validation popup should stay visible instead of moving completely offscreen.',
  );
  assert.match(
    stylesSource,
    /\.app-shell\.is-validation-test\.is-validation-recording-focus\s+\.viewer\s*\{[\s\S]*?width:\s*100vw;[\s\S]*?height:\s*100vh;/,
    'Validation recording focus should keep the viewer fullscreen for participants.',
  );
});

test('validation mode shows pending feedback immediately after starting accuracy check', () => {
  const startAccuracyCheckFunction = controllerSource.match(
    /async\s+function\s+startAccuracyCheck\(\)\s*\{[\s\S]*?\n  \}/,
  )?.[0] || '';

  assert.notEqual(startAccuracyCheckFunction, '', 'The controller should define the accuracy-check starter.');
  assert.match(
    startAccuracyCheckFunction,
    /setWebcamStatus\('validating'\);\s*await\s+setWebcamMode\(\);/,
    'Validation mode should enter a visible validating state before awaiting tracker startup.',
  );
  assert.match(
    controllerSource,
    /validationTestAccuracyButton\.disabled\s*=\s*\([\s\S]*?!hasSeeSoKey\s*\|\|[\s\S]*?!hasSeeSoGeometry\s*\|\|[\s\S]*?!hasSeeSoCalibration\s*\|\|[\s\S]*?state\.isRecording\s*\|\|[\s\S]*?state\.webcamStatus\s*===\s*'validating'[\s\S]*?\);/,
    'Validation mode should disable the accuracy button while the check is starting or running.',
  );
});

test('validation mode submits the completed validation result to deployment storage', () => {
  assert.match(
    controllerSource,
    /submitValidationResult/,
    'The controller should use the deployment upload helper for validation submissions.',
  );
  assert.match(
    controllerSource,
    /async\s+function\s+submitValidationTestResult\(\s*evaluation,\s*summary\s*\)/,
    'Validation uploads should be handled by a scoped helper.',
  );
  assert.match(
    controllerSource,
    /showValidationStatsPopup\(evaluation,\s*correctedValidationSummary\);\s*await\s+submitValidationTestResult\(evaluation,\s*correctedValidationSummary\);/,
    'A completed validation run should upload after rendering the stats popup.',
  );
});

test('validation mode submits aborted validation attempts to deployment storage', () => {
  const abortFunction = controllerSource.match(
    /async\s+function\s+abortAccuracyCheckForUnstableTarget\(\s*targetSampleSummary,\s*rejection\s*\)\s*\{[\s\S]*?\n  \}/,
  )?.[0] || '';

  assert.notEqual(abortFunction, '', 'The controller should define the unstable-target abort helper.');
  assert.match(
    abortFunction,
    /showValidationStatsPopup\(evaluation,\s*evaluation\.accuracySummary\);[\s\S]*await\s+submitValidationTestResult\(evaluation,\s*evaluation\.accuracySummary\);/,
    'Validation attempts that abort before all targets should still show the result popup and upload a failed validation result.',
  );
});

test('accuracy validation resets live gaze filter after changing correction', () => {
  assert.match(
    controllerSource,
    /function\s+resetLiveGazeFilterState\(\)\s*\{[\s\S]*?state\.gaze\s*=\s*createDefaultGaze\(\);[\s\S]*?state\.lastAcceptedGazeAt\s*=\s*0;[\s\S]*?state\.gazeDropReason\s*=\s*null;[\s\S]*?\}/,
    'The controller should have a helper that clears live gaze smoothing and hold state.',
  );
  assert.match(
    controllerSource,
    /state\.gazeCorrection\s*=\s*evaluation\.validationPassed\s*\?\s*evaluation\.liveCalibration\s*:\s*null;\s*resetLiveGazeFilterState\(\);/,
    'Changing the validation correction should reset the live gaze filter so corrected samples are not smoothed against pre-correction gaze.',
  );
});

test('active accuracy validation bypasses laggy live gaze smoothing and hold', () => {
  assert.match(
    controllerSource,
    /function\s+getLiveGazeUpdateOptions\(\)\s*\{[\s\S]*?hasActiveAccuracyValidation\(\)[\s\S]*?alpha:\s*1,[\s\S]*?maxJumpPx:\s*Number\.POSITIVE_INFINITY,[\s\S]*?adaptiveSmoothing:\s*false,[\s\S]*?\}/,
    'Accuracy validation should use latest gaze immediately instead of applying participant-recording smoothing.',
  );
  assert.match(
    controllerSource,
    /function\s+canHoldLastWebcamGaze[\s\S]*?\{\s*if\s*\(hasActiveAccuracyValidation\(\)\)\s*\{[\s\S]*?return\s+false;[\s\S]*?\}/,
    'Accuracy validation should not hold stale gaze points because they make the live dot look delayed.',
  );
  assert.match(
    controllerSource,
    /const\s+liveGazeUpdateOptions\s*=\s*getLiveGazeUpdateOptions\(\);[\s\S]*?resolveGazeUpdate\(\{[\s\S]*?\.\.\.liveGazeUpdateOptions,/,
    'Webcam gaze processing should apply the validation-specific live gaze options.',
  );
});

test('SeeSo tracking uses explicit monitor and face-distance geometry', () => {
  assert.match(
    controllerSource,
    /function\s+requireSeeSoGeometrySettings\(\)[\s\S]*?Nhập kích thước màn hình và khoảng cách mặt/,
    'SeeSo setup should require participant screen geometry instead of using hidden defaults.',
  );
  assert.match(
    controllerSource,
    /const geometrySettings = requireSeeSoGeometrySettings\(\);[\s\S]*?createSeeSoProvider\(\{[\s\S]*?monitorSizeInch:\s*geometrySettings\.monitorSizeInch,[\s\S]*?faceDistanceCm:\s*geometrySettings\.faceDistanceCm,/,
    'SeeSo provider startup should receive the explicit geometry settings.',
  );
  assert.match(
    controllerSource,
    /openCalibrationPage\(\{[\s\S]*?monitorSizeInch:\s*geometrySettings\.monitorSizeInch,[\s\S]*?faceDistanceCm:\s*geometrySettings\.faceDistanceCm,/,
    'Hosted SeeSo calibration should receive the same explicit geometry settings.',
  );
});

test('validation calibration can start with default SeeSo geometry before accuracy check', () => {
  assert.match(
    controllerSource,
    /const\s+DEFAULT_VALIDATION_MONITOR_SIZE_INCH\s*=\s*15\.6/,
    'Validation mode should have a monitor-size fallback so calibration is not blocked by an empty placeholder field.',
  );
  assert.match(
    controllerSource,
    /const\s+DEFAULT_VALIDATION_FACE_DISTANCE_CM\s*=\s*60/,
    'Validation mode should have a face-distance fallback so calibration can start before accuracy validation.',
  );
  assert.match(
    controllerSource,
    /state\.appMode\s*===\s*'validation'[\s\S]*?DEFAULT_VALIDATION_MONITOR_SIZE_INCH[\s\S]*?DEFAULT_VALIDATION_FACE_DISTANCE_CM/,
    'The default geometry fallback should be scoped to standalone validation mode.',
  );
});

test('recording import ignores empty AOI arrays from incomplete participant exports', () => {
  assert.match(
    controllerSource,
    /Array\.isArray\(json\.aois\)\s*&&\s*json\.aois\.length\s*>\s*0/,
    'A participant export with aois: [] should still load review samples instead of failing AOI registration.',
  );
});

test('batch heatmap merge imports the merge helper', () => {
  assert.match(
    controllerSource,
    /import\s+\{[\s\S]*buildMergedHeatmapExport[\s\S]*readHeatmapExportFiles[\s\S]*\}\s+from\s+'\.\.\/recording\/heatmapMerge\.js'/,
    'The app controller should import the batch heatmap merge and file reader helpers.',
  );
});

test('batch heatmap image export imports render helpers', () => {
  assert.match(
    controllerSource,
    /import\s+\{[\s\S]*getHeatmapRenderDimensions[\s\S]*normalizeHeatmapBins[\s\S]*\}\s+from\s+'\.\.\/recording\/heatmapRender\.js'/,
    'The app controller should import merged heatmap image render helpers.',
  );
});

test('batch heatmap merge destructures DOM controls', () => {
  const domDestructure = controllerSource.match(/const\s+\{[\s\S]*?\}\s*=\s*dom;/)?.[0] || '';

  [
    'heatmapMergeFileInput',
    'heatmapMergeStatus',
    'mergedHeatmapGroupSelect',
    'mergedHeatmapVariantSelect',
    'mergedHeatmapTypeSelect',
    'exportMergedHeatmapJsonButton',
    'exportMergedHeatmapImageButton',
  ].forEach((nodeName) => {
    assert.match(
      domDestructure,
      new RegExp(`\\b${nodeName}\\b`),
      `The app controller should destructure ${nodeName} from queryAppDom().`,
    );
  });
});

test('batch heatmap merge keeps merged export controller state', () => {
  assert.match(
    controllerSource,
    /let\s+mergedHeatmapExport\s*=\s*null\s*;/,
    'The app controller should track the merged heatmap export package.',
  );
  assert.match(
    controllerSource,
    /let\s+heatmapMergeLoadId\s*=\s*0\s*;/,
    'The app controller should track the current batch heatmap file load.',
  );
});

test('batch heatmap file import reads all selected JSON files and resets the input', () => {
  const loadFunction = controllerSource.match(
    /async\s+function\s+loadHeatmapMergeFiles\(event\)[\s\S]*?\n  }\n\n  function resize/,
  )?.[0] || '';

  assert.notEqual(loadFunction, '', 'The app controller should define loadHeatmapMergeFiles.');
  [
    [/readHeatmapExportFiles\(files\)/, 'read all selected files with per-file parse diagnostics'],
    [/buildMergedHeatmapExport\(entries,\s*\{[\s\S]*skipped[\s\S]*sourceFileCount[\s\S]*\}\)/, 'build the merge package with skipped-file diagnostics'],
    [/syncMergedHeatmapControls\(\)/, 'sync controls after load or failure'],
    [/event\.target\.value\s*=\s*''/, 'reset the file input'],
  ].forEach(([pattern, message]) => {
    assert.match(loadFunction, pattern, `Batch heatmap import should ${message}.`);
  });
});

test('batch heatmap file import ignores stale async completions', () => {
  const loadFunction = controllerSource.match(
    /async\s+function\s+loadHeatmapMergeFiles\(event\)[\s\S]*?\n  }\n\n  function resize/,
  )?.[0] || '';

  assert.notEqual(loadFunction, '', 'The app controller should define loadHeatmapMergeFiles.');
  assert.match(
    loadFunction,
    /const\s+loadId\s*=\s*\+\+heatmapMergeLoadId\s*;/,
    'Batch heatmap import should capture a monotonic load id before async reads.',
  );
  assert.match(
    loadFunction,
    /const\s+\{\s*entries,\s*skipped,\s*sourceFileCount\s*\}\s*=\s*await\s+readHeatmapExportFiles\(files\)[\s\S]*?if\s*\(\s*loadId\s*!==\s*heatmapMergeLoadId\s*\)\s*\{[\s\S]*?return;[\s\S]*?\}[\s\S]*?mergedHeatmapExport\s*=\s*buildMergedHeatmapExport\(entries,\s*\{[\s\S]*skipped[\s\S]*sourceFileCount[\s\S]*\}\)/,
    'Batch heatmap import should ignore stale successful reads before writing merged state.',
  );
  assert.match(
    loadFunction,
    /catch\s*\(error\)\s*\{[\s\S]*?if\s*\(\s*loadId\s*!==\s*heatmapMergeLoadId\s*\)\s*\{[\s\S]*?return;[\s\S]*?\}[\s\S]*?mergedHeatmapExport\s*=\s*null[\s\S]*?syncMergedHeatmapControls\(\)[\s\S]*?setNotice/,
    'Batch heatmap import should ignore stale failures before clearing state or showing failure.',
  );
});

test('batch heatmap JSON export downloads the merged package', () => {
  assert.match(
    controllerSource,
    /function\s+exportMergedHeatmapJson\(\)[\s\S]*downloadJson\(mergedHeatmapExport,\s*buildMergedHeatmapFileName\('json'\)\)/,
    'Merged heatmap JSON export should download the current merged package with the shared filename helper.',
  );
});

test('batch heatmap image export resolves the selected variant before top-level fallback', () => {
  const getSelectedHeatmapFunction = controllerSource.match(
    /function\s+getSelectedMergedHeatmap\(\)\s*\{[\s\S]*?\n  \}/,
  )?.[0] || '';

  assert.notEqual(getSelectedHeatmapFunction, '', 'The app controller should define getSelectedMergedHeatmap.');
  assert.match(
    getSelectedHeatmapFunction,
    /getSelectedMergedHeatmapGroup\(\)/,
    'Merged heatmap image export should use the selected merged group.',
  );
  assert.match(
    getSelectedHeatmapFunction,
    /mergedHeatmapVariantSelect\.value[\s\S]*mergedHeatmapTypeSelect\.value/,
    'Merged heatmap image export should use the selected variant and heatmap type controls.',
  );
  assert.match(
    getSelectedHeatmapFunction,
    /summary\.heatmaps\.variants\?\.\[variant\]\?\.\[type\][\s\S]*summary\.heatmaps\?\.\[type\][\s\S]*null/,
    'Merged heatmap selection should prefer variant heatmaps before falling back to top-level heatmaps.',
  );
});

test('batch heatmap image export draws merged heatmaps to a canvas', () => {
  const drawFunction = controllerSource.match(
    /function\s+drawMergedHeatmapToCanvas\(canvas,\s*heatmap\)\s*\{[\s\S]*?\n  \}/,
  )?.[0] || '';

  assert.notEqual(drawFunction, '', 'The app controller should define drawMergedHeatmapToCanvas.');
  assert.match(
    drawFunction,
    /getHeatmapRenderDimensions\(heatmap\)/,
    'Merged heatmap canvas drawing should size the canvas from render dimensions.',
  );
  assert.match(
    drawFunction,
    /normalizeHeatmapBins\(heatmap\)/,
    'Merged heatmap canvas drawing should normalize bins before painting.',
  );
  assert.match(
    drawFunction,
    /createRadialGradient/,
    'Merged heatmap canvas drawing should use radial gradients for heat spots.',
  );
  assert.match(
    drawFunction,
    /globalCompositeOperation\s*=\s*'lighter'/,
    'Merged heatmap canvas drawing should blend heat spots with a lighter composite operation.',
  );
});

test('batch heatmap image export downloads the selected heatmap as PNG', () => {
  const exportFunction = controllerSource.match(
    /function\s+exportMergedHeatmapImage\(\)\s*\{[\s\S]*?\n  \}/,
  )?.[0] || '';

  assert.notEqual(exportFunction, '', 'The app controller should define exportMergedHeatmapImage.');
  assert.match(
    exportFunction,
    /getSelectedMergedHeatmap\(\)/,
    'Merged heatmap image export should use the selected heatmap instead of only checking package state.',
  );
  assert.match(
    exportFunction,
    /document\.createElement\('canvas'\)/,
    'Merged heatmap image export should create an offscreen canvas.',
  );
  assert.match(
    exportFunction,
    /canvas\.toDataURL\('image\/png'\)/,
    'Merged heatmap image export should serialize the canvas as PNG.',
  );
  assert.match(
    exportFunction,
    /buildMergedHeatmapFileName\('png'\)/,
    'Merged heatmap image export should use the shared filename helper with a PNG extension.',
  );
});

test('batch heatmap image export handles PNG serialization failures', () => {
  const exportFunction = controllerSource.match(
    /function\s+exportMergedHeatmapImage\(\)\s*\{[\s\S]*?\n  \}/,
  )?.[0] || '';

  assert.notEqual(exportFunction, '', 'The app controller should define exportMergedHeatmapImage.');
  assert.match(
    exportFunction,
    /try\s*\{[\s\S]*canvas\.toDataURL\('image\/png'\)[\s\S]*\}\s*catch\s*\(/,
    'Merged heatmap image export should catch canvas PNG serialization failures.',
  );
  assert.match(
    exportFunction,
    /dataUrl\s*===\s*'data:,'/,
    'Merged heatmap image export should reject empty data URLs returned by canvas serialization.',
  );
});

test('batch heatmap image export clicks download only after a valid PNG data URL', () => {
  const exportFunction = controllerSource.match(
    /function\s+exportMergedHeatmapImage\(\)\s*\{[\s\S]*?\n  \}/,
  )?.[0] || '';

  assert.notEqual(exportFunction, '', 'The app controller should define exportMergedHeatmapImage.');
  assert.match(
    exportFunction,
    /if\s*\(\s*!dataUrl\s*\|\|\s*dataUrl\s*===\s*'data:,'\s*\)\s*\{[\s\S]*?return;[\s\S]*?\}[\s\S]*anchor\.href\s*=\s*dataUrl[\s\S]*anchor\.click\(\)/,
    'Merged heatmap image export should return on invalid data URLs before assigning and clicking the download anchor.',
  );
});

test('batch heatmap merge controls are disabled when no merged groups exist', () => {
  assert.match(
    controllerSource,
    /function\s+syncMergedHeatmapControls\(\)[\s\S]*mergedHeatmapGroupSelect\.disabled[\s\S]*mergedHeatmapVariantSelect\.disabled[\s\S]*mergedHeatmapTypeSelect\.disabled[\s\S]*exportMergedHeatmapJsonButton\.disabled[\s\S]*exportMergedHeatmapImageButton\.disabled/,
    'Merged heatmap controls should set disabled state for selectors and export buttons.',
  );
});

test('batch heatmap merge status summarizes files groups and skips', () => {
  assert.match(
    controllerSource,
    /heatmapMergeStatus\.textContent[\s\S]*sourceFileCount[\s\S]*groupCount[\s\S]*skipped\.length/,
    'Merged heatmap status should summarize source files, merged groups, and skipped items.',
  );
  assert.match(
    controllerSource,
    /Chua tai heatmap JSON\./,
    'Merged heatmap status should show an initial no-data message.',
  );
});

test('batch heatmap merge event listeners are wired', () => {
  assert.match(
    controllerSource,
    /heatmapMergeFileInput\.addEventListener\('change',\s*loadHeatmapMergeFiles\)/,
    'The heatmap merge file input should load selected files.',
  );
  assert.match(
    controllerSource,
    /exportMergedHeatmapJsonButton\.addEventListener\('click',\s*exportMergedHeatmapJson\)/,
    'The merged heatmap JSON export button should be wired.',
  );
  assert.match(
    controllerSource,
    /exportMergedHeatmapImageButton\.addEventListener\('click',\s*exportMergedHeatmapImage\)/,
    'The merged heatmap image export button should stay wired to the image export handler.',
  );
  assert.match(
    controllerSource,
    /mergedHeatmapGroupSelect\.addEventListener\('change',\s*syncMergedHeatmapControls\)/,
    'The merged heatmap group selector should resync controls.',
  );
  assert.match(
    controllerSource,
    /mergedHeatmapVariantSelect\.addEventListener\('change',\s*syncMergedHeatmapControls\)/,
    'The merged heatmap variant selector should resync controls.',
  );
  assert.match(
    controllerSource,
    /mergedHeatmapTypeSelect\.addEventListener\('change',\s*syncMergedHeatmapControls\)/,
    'The merged heatmap type selector should resync controls.',
  );
});
