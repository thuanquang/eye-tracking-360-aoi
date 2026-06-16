import test from 'node:test';
import assert from 'node:assert/strict';

import { getRequiredElement, queryAppDom } from '../src/app/dom.js';

function createDocument(selectors) {
  const elements = new Map(selectors.map((selector) => [selector, { selector }]));

  return {
    querySelector(selector) {
      return elements.get(selector) || null;
    },
    querySelectorAll(selector) {
      return elements.has(selector) ? [elements.get(selector)] : [];
    },
  };
}

const APP_SELECTORS = [
  '#appShell',
  '#viewer',
  '#viewerSection',
  '#viewerNotice',
  '#aoiOverlay',
  '#gazeDot',
  '#sourceVideo',
  '#miniMap',
  '#playVideoButton',
  '#resetViewButton',
  '#mouseModeButton',
  '#webcamModeButton',
  '#gazeProviderSelect',
  '#seesoLicenseKeyInput',
  '#gazeEngineStatus',
  '#calibrateButton',
  '#accuracyButton',
  '#rawGazeDiagnosticButton',
  '#rawGazeDiagnosticStatus',
  '#calibrationProfileSelect',
  '#validationPolicySelect',
  '#studyVideoSelect',
  '#aoiFileInput',
  '#projectionSelect',
  '#stereoLayoutSelect',
  '#manualAoiLabelInput',
  '#manualAoiSizeInput',
  '#manualAoiColorInput',
  '#addManualAoiButton',
  '#drawPolygonAoiButton',
  '#finishPolygonAoiButton',
  '#cancelPolygonAoiButton',
  '#manualAoiStatus',
  '#selectedAoiPanel',
  '#selectedAoiLabelInput',
  '#selectedAoiPaddingInput',
  '#selectedAoiColorInput',
  '#saveSelectedAoiButton',
  '#deleteSelectedAoiButton',
  '#cloudAoiPromptsInput',
  '#cloudAoiSampleIntervalInput',
  '#cloudAoiMaxPointsInput',
  '#cloudAoiSimplifyInput',
  '#exportColabJobButton',
  '#cloudAoiResultInput',
  '#recordingFileInput',
  '#recordButton',
  '#reviewButton',
  '#clearButton',
  '#exportButton',
  '#exportStatsCsvButton',
  '#aoiStatsPanel',
  '#refreshStatsButton',
  '#aoiStatsTable',
  '#heatmapCanvas',
  '#sampleCount',
  '#modeLabel',
  '#webcamStatusLabel',
  '#accuracyStatusLabel',
  '#aoiSourceLabel',
  '#screenReadout',
  '#cameraReadout',
  '#panoramaReadout',
  '#hitReadout',
  '#gazeQualityReadout',
  '#aoiList',
  '#controlPanel',
  '#participantPanel',
  '#adminModeLink',
  '#participantModeLink',
  '#participantIdInput',
  '#participantNameInput',
  '#participantAgeInput',
  '#participantConsentInput',
  '#participantGazeSetup',
  '#participantGazeProviderSelect',
  '#participantSeeSoLicenseKeyInput',
  '#participantGazeSetupStatus',
  '#participantStartButton',
  '#participantStageLabel',
  '#participantSessionPanel',
  '#participantSessionStatus',
  '#participantCalibrateButton',
  '#participantAccuracyButton',
  '#participantRecordButton',
  '#participantExportButton',
  '#participantFlowRail .flow-step',
  '#validationTestPanel',
  '#validationTestStatus',
  '#validationTestKeyInput',
  '#validationTestCalibrateButton',
  '#validationTestBlankButton',
  '#validationTestAccuracyButton',
  '#calibrationOverlay',
  '#calibrationTarget',
  '#calibrationProgress',
  '#calibrationDescription',
  '#cancelCalibrationButton',
];

test('getRequiredElement returns an existing selector', () => {
  const document = createDocument(['#viewer']);

  assert.deepEqual(getRequiredElement(document, '#viewer'), { selector: '#viewer' });
});

test('getRequiredElement throws a useful error for missing selectors', () => {
  const document = createDocument([]);

  assert.throws(
    () => getRequiredElement(document, '#viewer'),
    /Missing required DOM element: #viewer/,
  );
});

test('queryAppDom resolves core app selectors', () => {
  const document = createDocument(APP_SELECTORS);

  const dom = queryAppDom(document);

  assert.equal(dom.viewer.selector, '#viewer');
  assert.equal(dom.sourceVideo.selector, '#sourceVideo');
  assert.equal(dom.studyVideoSelect.selector, '#studyVideoSelect');
  assert.equal(dom.gazeProviderSelect.selector, '#gazeProviderSelect');
  assert.equal(dom.seesoLicenseKeyInput.selector, '#seesoLicenseKeyInput');
  assert.equal(dom.gazeEngineStatus.selector, '#gazeEngineStatus');
  assert.equal(dom.participantGazeSetup.selector, '#participantGazeSetup');
  assert.equal(dom.participantGazeProviderSelect.selector, '#participantGazeProviderSelect');
  assert.equal(dom.participantSeeSoLicenseKeyInput.selector, '#participantSeeSoLicenseKeyInput');
  assert.equal(dom.participantGazeSetupStatus.selector, '#participantGazeSetupStatus');
  assert.equal(dom.calibrationProfileSelect.selector, '#calibrationProfileSelect');
  assert.equal(dom.validationPolicySelect.selector, '#validationPolicySelect');
  assert.equal(dom.validationTestPanel.selector, '#validationTestPanel');
  assert.equal(dom.validationTestBlankButton.selector, '#validationTestBlankButton');
  assert.equal(dom.rawGazeDiagnosticButton.selector, '#rawGazeDiagnosticButton');
  assert.equal(dom.rawGazeDiagnosticStatus.selector, '#rawGazeDiagnosticStatus');
  assert.equal(dom.gazeQualityReadout.selector, '#gazeQualityReadout');
  assert.equal(dom.exportStatsCsvButton.selector, '#exportStatsCsvButton');
  assert.equal(dom.aoiStatsPanel.selector, '#aoiStatsPanel');
  assert.equal(dom.refreshStatsButton.selector, '#refreshStatsButton');
  assert.equal(dom.aoiStatsTable.selector, '#aoiStatsTable');
  assert.equal(dom.heatmapCanvas.selector, '#heatmapCanvas');
});

test('queryAppDom requires the AOI stats CSV export button', () => {
  const document = createDocument(APP_SELECTORS.filter((selector) => selector !== '#exportStatsCsvButton'));

  assert.throws(
    () => queryAppDom(document),
    /Missing required DOM element: #exportStatsCsvButton/,
  );
});
