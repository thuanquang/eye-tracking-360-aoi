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
  '#recordingFileInput',
  '#recordButton',
  '#reviewButton',
  '#clearButton',
  '#exportButton',
  '#exportStatsCsvButton',
  '#aoiStatsPanel',
  '#exitAnalyticsButton',
  '#refreshStatsButton',
  '#analyticsClearButton',
  '#analyticsExportButton',
  '#analyticsExportStatsCsvButton',
  '#aoiStatsSummary',
  '#aoiStatsCards',
  '#aoiStatsDetails',
  '#aoiStatsTable',
  '#gazeHeatmapOverlay',
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
  '#participantStudyVideoSelect',
  '#participantIdInput',
  '#participantNameInput',
  '#participantAgeInput',
  '#participantConsentInput',
  '#participantStartButton',
  '#participantSessionPanel',
  '#participantCalibrateButton',
  '#participantRecordButton',
  '#participantExportButton',
  '#participantFlowRail .flow-step',
  '#adminWorkflowRail .admin-flow-step',
  '#validationTestPanel',
  '#validationTestStatus',
  '#validationTestCalibrateButton',
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
    /Thiếu phần tử DOM bắt buộc: #viewer/,
  );
});

test('queryAppDom resolves core app selectors', () => {
  const document = createDocument(APP_SELECTORS);

  const dom = queryAppDom(document);

  assert.equal(dom.viewer.selector, '#viewer');
  assert.equal(dom.sourceVideo.selector, '#sourceVideo');
  assert.equal(dom.studyVideoSelect.selector, '#studyVideoSelect');
  assert.equal(dom.participantStudyVideoSelect.selector, '#participantStudyVideoSelect');
  assert.equal(dom.gazeProviderSelect.selector, '#gazeProviderSelect');
  assert.equal(dom.gazeEngineStatus.selector, '#gazeEngineStatus');
  assert.equal(dom.calibrationProfileSelect.selector, '#calibrationProfileSelect');
  assert.equal(dom.validationPolicySelect.selector, '#validationPolicySelect');
  assert.equal(dom.validationTestPanel.selector, '#validationTestPanel');
  assert.equal(dom.rawGazeDiagnosticButton.selector, '#rawGazeDiagnosticButton');
  assert.equal(dom.rawGazeDiagnosticStatus.selector, '#rawGazeDiagnosticStatus');
  assert.equal(dom.gazeQualityReadout.selector, '#gazeQualityReadout');
  assert.equal(dom.exportStatsCsvButton.selector, '#exportStatsCsvButton');
  assert.equal(dom.aoiStatsPanel.selector, '#aoiStatsPanel');
  assert.equal(dom.exitAnalyticsButton.selector, '#exitAnalyticsButton');
  assert.equal(dom.refreshStatsButton.selector, '#refreshStatsButton');
  assert.equal(dom.analyticsClearButton.selector, '#analyticsClearButton');
  assert.equal(dom.analyticsExportButton.selector, '#analyticsExportButton');
  assert.equal(dom.analyticsExportStatsCsvButton.selector, '#analyticsExportStatsCsvButton');
  assert.equal(dom.aoiStatsSummary.selector, '#aoiStatsSummary');
  assert.equal(dom.aoiStatsCards.selector, '#aoiStatsCards');
  assert.equal(dom.aoiStatsDetails.selector, '#aoiStatsDetails');
  assert.equal(dom.aoiStatsTable.selector, '#aoiStatsTable');
  assert.equal(dom.gazeHeatmapOverlay.selector, '#gazeHeatmapOverlay');
  assert.equal('heatmapCanvas' in dom, false);
  assert.deepEqual(dom.adminFlowSteps.map((element) => element.selector), ['#adminWorkflowRail .admin-flow-step']);
});

test('queryAppDom does not require removed Colab auto-AOI controls', () => {
  const document = createDocument(APP_SELECTORS);

  assert.doesNotThrow(() => queryAppDom(document));
});

test('queryAppDom requires the AOI stats CSV export button', () => {
  const document = createDocument(APP_SELECTORS.filter((selector) => selector !== '#exportStatsCsvButton'));

  assert.throws(
    () => queryAppDom(document),
    /Thiếu phần tử DOM bắt buộc: #exportStatsCsvButton/,
  );
});
