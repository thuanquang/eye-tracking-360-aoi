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
  const document = createDocument([
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
    '#calibrateButton',
    '#accuracyButton',
    '#calibrationProfileSelect',
    '#videoFileInput',
    '#aoiFileInput',
    '#projectionSelect',
    '#stereoLayoutSelect',
    '#manualAoiLabelInput',
    '#manualAoiSizeInput',
    '#manualAoiColorInput',
    '#addManualAoiButton',
    '#cloudAoiPromptsInput',
    '#cloudAoiSampleIntervalInput',
    '#exportColabJobButton',
    '#cloudAoiResultInput',
    '#recordingFileInput',
    '#recordButton',
    '#reviewButton',
    '#clearButton',
    '#exportButton',
    '#sampleCount',
    '#modeLabel',
    '#webcamStatusLabel',
    '#accuracyStatusLabel',
    '#aoiSourceLabel',
    '#screenReadout',
    '#cameraReadout',
    '#panoramaReadout',
    '#hitReadout',
    '#aoiList',
    '#controlPanel',
    '#participantPanel',
    '#adminModeLink',
    '#participantModeLink',
    '#participantIdInput',
    '#participantNameInput',
    '#participantAgeInput',
    '#participantConsentInput',
    '#participantStartButton',
    '#participantStageLabel',
    '#participantSessionPanel',
    '#participantSessionStatus',
    '#participantCalibrateButton',
    '#participantAccuracyButton',
    '#participantRecordButton',
    '#participantExportButton',
    '#participantFlowRail .flow-step',
    '#calibrationOverlay',
    '#calibrationTarget',
    '#calibrationProgress',
    '#calibrationDescription',
    '#cancelCalibrationButton',
  ]);

  const dom = queryAppDom(document);

  assert.equal(dom.viewer.selector, '#viewer');
  assert.equal(dom.sourceVideo.selector, '#sourceVideo');
  assert.equal(dom.calibrationProfileSelect.selector, '#calibrationProfileSelect');
});
