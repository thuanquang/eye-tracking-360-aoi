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

test('participant hosted calibration return starts gaze without separate accuracy action', () => {
  assert.doesNotMatch(
    controllerSource,
    /participantAccuracyButton\.addEventListener/,
    'Participant mode should not wire a separate Start Gaze + Check Accuracy action.',
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
