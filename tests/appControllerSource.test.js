import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const controllerSource = await readFile(new URL('../src/app/appController.js', import.meta.url), 'utf8');

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
    /autoStartParticipantGazeAfterCalibrationReturn/,
    'Participant mode should have an explicit hosted calibration return auto-start hook.',
  );
  assert.match(
    controllerSource,
    /restoreParticipantState\(\);[\s\S]*applyAppMode\(\);[\s\S]*void autoStartParticipantGazeAfterCalibrationReturn\(\);/,
    'Participant state should restore before auto-starting gaze from returned hosted calibration.',
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

test('participant export submits to deployment endpoint before falling back to download', () => {
  assert.match(
    controllerSource,
    /submitParticipantExport/,
    'The controller should use the deployment upload helper for participant submissions.',
  );
  assert.match(
    controllerSource,
    /state\.appMode === 'participant'/,
    'Participant upload behavior should be scoped to participant mode.',
  );
});

test('participant export shows R2 upload progress and fallback status', () => {
  assert.match(
    controllerSource,
    /function\s+setParticipantUploadStatus\(/,
    'The controller should render participant upload status separately from the global notice.',
  );
  assert.match(
    controllerSource,
    /setParticipantUploadStatus\('uploading'\);[\s\S]*await\s+submitParticipantExport/,
    'Participant export should show an uploading state while sending to R2.',
  );
  assert.match(
    controllerSource,
    /setParticipantUploadStatus\('uploaded',\s*result\.fileName\)/,
    'Participant export should show an uploaded state when R2 accepts the JSON.',
  );
  assert.match(
    controllerSource,
    /setParticipantUploadStatus\('fallback'\)/,
    'Participant export should explain that local download means the R2 upload failed.',
  );
});

test('participant recording samples are trusted for AOI analysis without in-app accuracy validation', () => {
  assert.match(
    controllerSource,
    /state\.appMode === 'participant'\s*\|\|\s*state\.mode !== 'webcam'\s*\|\|\s*state\.accuracyValidated/,
    'Participant samples should count for AOI metrics even when validation is handled by the separate validation flow.',
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
