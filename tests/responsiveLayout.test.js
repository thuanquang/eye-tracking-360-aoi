import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');
const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');

function readRule(selector, source = css) {
  const pattern = new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([\\s\\S]*?)\\}`);
  return pattern.exec(source)?.[1] || '';
}

function readMediaRule(query) {
  const pattern = new RegExp(`@media\\s*\\(${query}\\)\\s*\\{([\\s\\S]*?)(?=\\n\\})\\n\\}`, 'm');
  return pattern.exec(css)?.[1] || '';
}

test('viewer keeps a usable aspect ratio in stacked responsive layouts', () => {
  const viewerRule = readRule('.viewer');
  assert.match(
    viewerRule,
    /aspect-ratio:\s*16\s*\/\s*9/,
    'The main 360 viewer should keep a 16:9 render area instead of collapsing into a strip.',
  );

  const responsiveShellRule = readRule('.app-shell', readMediaRule('max-width:\\s*980px'));
  assert.match(
    responsiveShellRule,
    /height:\s*auto/,
    'Stacked layouts should let the page grow vertically.',
  );
  assert.match(
    responsiveShellRule,
    /min-height:\s*100vh/,
    'Stacked layouts should still fill the viewport when content is short.',
  );
  assert.match(
    responsiveShellRule,
    /overflow-y:\s*auto/,
    'Stacked layouts should scroll instead of shrinking the 360 viewer.',
  );
});

test('admin control panels follow the visible workflow order', () => {
  const orderedPanelIds = [
    'adminSetupPanel',
    'manualAoiPanel',
    'adminCalibrationPanel',
    'adminRecordingPanel',
    'adminReadoutPanel',
    'adminAoiListPanel',
  ];

  const positions = orderedPanelIds.map((id) => html.indexOf(`id="${id}"`));

  positions.forEach((position, index) => {
    assert.notEqual(position, -1, `${orderedPanelIds[index]} should exist in the page markup.`);
  });

  assert.deepEqual(
    positions,
    [...positions].sort((a, b) => a - b),
    'Admin panels should scan in setup, AOI, calibration, record, export/readout order.',
  );
});

test('admin view removes Google Colab auto-AOI controls', () => {
  assert.equal(html.includes('id="cloudAoiPanel"'), false);
  assert.equal(html.includes('Google Colab job'), false);
  assert.equal(html.includes('Export Colab Job'), false);
});

test('admin setup exposes only the study video choice', () => {
  const setupSection = /<section id="adminSetupPanel"[\s\S]*?<\/section>/.exec(html)?.[0] || '';

  assert.match(setupSection, /id="studyVideoSelect"/);
  assert.equal(
    setupSection.includes('id="projectionSelect"'),
    false,
    'Projection should not appear in the first admin setup step.',
  );
  assert.equal(
    setupSection.includes('id="stereoLayoutSelect"'),
    false,
    'Stereo should not appear in the first admin setup step.',
  );
  assert.match(
    html,
    /<div class="source-metadata-controls" hidden>[\s\S]*id="projectionSelect"[\s\S]*id="stereoLayoutSelect"[\s\S]*<\/div>/,
    'Projection and stereo should remain as hidden backing controls for study video metadata.',
  );
});

test('admin workflow nav exposes a selectable active step style', () => {
  assert.match(
    html,
    /<a class="admin-flow-step is-active" href="#adminSetupPanel" aria-current="step">01 [^<]+<\/a>/,
    'The first admin workflow step should render selected by default.',
  );
  assert.match(
    css,
    /\.admin-flow-step\.is-active,\s*\.admin-flow-step\[aria-current="step"\]\s*\{[\s\S]*?background:\s*var\(--line-strong\)/,
    'The selected admin workflow step should have a distinct active color.',
  );
});

test('AOI results prioritize summary and ranked cards before the detail table', () => {
  const resultIds = [
    'aoiStatsSummary',
    'aoiStatsCards',
    'aoiStatsDetails',
    'aoiStatsTable',
  ];
  const positions = resultIds.map((id) => html.indexOf(`id="${id}"`));

  positions.forEach((position, index) => {
    assert.notEqual(position, -1, `${resultIds[index]} should exist in the AOI results markup.`);
  });
  assert.deepEqual(
    positions,
    [...positions].sort((a, b) => a - b),
    'AOI results should scan from summary, to ranked AOI cards, to the detailed table.',
  );
  assert.match(
    css,
    /\.aoi-stats-cards\s*\{[\s\S]*?display:\s*grid/,
    'AOI results should use a card list instead of making the table the primary read.',
  );
  assert.match(
    css,
    /\.aoi-stat-card-bar-fill\s*\{[\s\S]*?width:\s*var\(--bar-width,\s*0%\)/,
    'AOI cards should include proportional bars for quick comparison.',
  );
});

test('AOI analytics mode uses player heatmap instead of sidebar preview', () => {
  const viewerPosition = html.indexOf('id="viewer"');
  const heatmapPosition = html.indexOf('id="gazeHeatmapOverlay"');
  const heatmapRulerPosition = html.indexOf('id="heatmapRuler"');
  const aoiOverlayPosition = html.indexOf('id="aoiOverlay"');

  assert.notEqual(viewerPosition, -1, 'The viewer should exist in the page markup.');
  assert.notEqual(heatmapPosition, -1, 'The gaze heatmap overlay should exist in the viewer.');
  assert.notEqual(heatmapRulerPosition, -1, 'The gaze heatmap ruler should exist in the viewer.');
  assert.notEqual(aoiOverlayPosition, -1, 'The AOI overlay should exist in the viewer.');
  assert.ok(
    viewerPosition < heatmapPosition && heatmapPosition < heatmapRulerPosition && heatmapRulerPosition < aoiOverlayPosition,
    'The heatmap canvas and ruler should be layered inside the player before the AOI overlay.',
  );
  assert.equal(html.includes('id="heatmapCanvas"'), false);
  assert.equal(html.includes('class="aoi-heatmap-panel"'), false);
  assert.match(
    css,
    /\.gaze-heatmap-overlay\s*\{[\s\S]*?position:\s*absolute/,
    'The gaze heatmap should be an absolute player overlay.',
  );
  assert.match(
    css,
    /\.app-shell\.is-analytics-mode\s+\.gaze-heatmap-overlay\s*\{[\s\S]*?opacity:/,
    'Analytics mode should reveal the player heatmap overlay.',
  );
  assert.match(
    css,
    /\.heatmap-ruler\s*\{[\s\S]*?position:\s*absolute[\s\S]*?top:\s*16px[\s\S]*?left:\s*16px/,
    'The heatmap ruler should pin to the top-left of the player.',
  );
  assert.match(
    css,
    /\.heatmap-ruler-bar\s*\{[\s\S]*?linear-gradient\(90deg[\s\S]*?0,\s*220,\s*255[\s\S]*?255,\s*210,\s*28[\s\S]*?255,\s*24,\s*16[\s\S]*?255,\s*255,\s*255/,
    'The heatmap ruler should mirror the cyan-to-white hotspot palette.',
  );
  assert.match(
    css,
    /\.app-shell\.is-analytics-mode\s+\.heatmap-ruler:not\(\[hidden\]\)\s*\{[\s\S]*?opacity:\s*1/,
    'Analytics mode should reveal the heatmap ruler when data exists.',
  );
});

test('analytics mode clears the admin sidebar to the AOI results panel', () => {
  assert.match(
    html,
    /id="exitAnalyticsButton"/,
    'Analytics mode should provide a way back to normal controls.',
  );
  assert.match(
    css,
    /\.app-shell\.is-analytics-mode[\s\S]*?#adminWorkflowRail[\s\S]*?display:\s*none/,
    'Analytics mode should hide the admin workflow rail.',
  );
  assert.match(
    css,
    /\.app-shell\.is-analytics-mode[\s\S]*?#controlPanel\s*>\s*\.panel-section:not\(#adminRecordingPanel\)[\s\S]*?display:\s*none/,
    'Analytics mode should hide non-result admin panels.',
  );
  assert.match(
    css,
    /\.app-shell\.is-analytics-mode[\s\S]*?#adminRecordingPanel\s*>\s*:not\(#aoiStatsPanel\)[\s\S]*?display:\s*none/,
    'Analytics mode should leave only the stats panel in the recording section.',
  );
});

test('dense admin regions are progressively disclosed', () => {
  assert.match(
    html,
    /<details[^>]+id="adminAoiListPanel"/,
    'The long AOI list should be a collapsible details region.',
  );
  assert.match(
    html,
    /<details[^>]+id="adminReadoutPanel"/,
    'Live diagnostic readouts should be a collapsible details region.',
  );
  assert.match(
    css,
    /details\.panel-section\s*>\s*summary/,
    'Collapsible panel summaries should have explicit layout styling.',
  );
});

test('participant and validation modes keep primary layouts usable on mobile', () => {
  assert.match(
    css,
    /\.participant-card\s+\.wide-action\s*\{[\s\S]*?position:\s*sticky/,
    'Participant setup should keep the start action visible while the form scrolls.',
  );

  assert.match(
    css,
    /\.app-shell\.is-participant-mode\s+#playVideoButton\s*\{[\s\S]*?display:\s*none/,
    'Participant mode should remove the separate video play control.',
  );
  assert.match(
    css,
    /\.app-shell\.is-participant-started\s+\.viewer-section\s*\{[\s\S]*?border:\s*0/,
    'Participant sessions should make the video stage feel fullscreen instead of framed.',
  );
  assert.match(
    css,
    /\.app-shell\.is-participant-started\s+\.viewer\s*\{[\s\S]*?height:\s*100vh/,
    'Participant sessions should size the viewer to the full viewport height.',
  );

  const mobileRules = readMediaRule('max-width:\\s*620px');
  assert.match(
    mobileRules,
    /\.app-shell\.is-validation-test\s+\.viewer\s*\{[\s\S]*?min-height:\s*min\(46vh,\s*360px\)/,
    'Mobile validation mode should preserve a real blank viewer area.',
  );
  assert.match(
    mobileRules,
    /\.app-shell\.is-validation-test\s+\.viewer\s*\{[\s\S]*?aspect-ratio:\s*auto/,
    'Mobile validation mode should not let the 16:9 viewer force horizontal overflow.',
  );
});

test('validation mode is hidden from admin UI before app JavaScript hydrates', () => {
  assert.match(
    html,
    /document\.documentElement\.dataset\.initialAppMode/,
    'The page should mark the requested mode in the head before the app controller loads.',
  );
  assert.match(
    css,
    /html\[data-initial-app-mode="validation"\][\s\S]*?#controlPanel[\s\S]*?display:\s*none/,
    'Validation mode should hide admin controls from first paint to prevent transition flashes.',
  );
  assert.match(
    css,
    /html\[data-initial-app-mode="validation"\][\s\S]*?\.viewer-section[\s\S]*?grid-template-rows:\s*minmax\(0,\s*1fr\)/,
    'Validation mode should apply the blank viewer layout from first paint.',
  );
});

test('tracker branding and key inputs are not participant-facing', () => {
  const appHtml = html.toLowerCase();
  assert.equal(appHtml.includes('eyedid'), false);
  assert.equal(appHtml.includes('license key'), false);
  assert.equal(appHtml.includes('participantgazesetup'), false);
  assert.equal(appHtml.includes('participantgazeproviderselect'), false);
  assert.equal(appHtml.includes('participantgazesetupstatus'), false);
  assert.equal(appHtml.includes('seesolicensekeyinput'), false);
  assert.equal(appHtml.includes('validationtestkeyinput'), false);
  assert.equal(appHtml.includes('participantseesolicensekeyinput'), false);
});

test('participant setup does not show tracker or stage status boxes', () => {
  const appHtml = html.toLowerCase();
  assert.equal(appHtml.includes('eye tracker'), false);
  assert.equal(appHtml.includes('participantstagelabel'), false);
  assert.equal(appHtml.includes('<span>stage</span>'), false);
});

test('participant mode hides the live gaze cursor while validation keeps it visible', () => {
  assert.match(
    css,
    /\.app-shell\.is-participant-mode\s+#gazeDot\s*\{[\s\S]*?visibility:\s*hidden/,
    'Participant mode should not show the live gaze cursor to participants.',
  );
  assert.match(
    css,
    /\.app-shell\.is-validation-test\s+#gazeDot\s*\{[\s\S]*?opacity:\s*1/,
    'Validation mode should keep the gaze cursor visible for tracker checks.',
  );
});

test('validation result stats popup is present and responsive', () => {
  assert.match(
    html,
    /id="validationStatsPopup"[\s\S]*role="dialog"[\s\S]*id="validationStatsMean"[\s\S]*id="validationStatsTargetCount"[\s\S]*id="validationStatsCloseButton"/,
    'Validation mode should include a stats dialog with metric fields and a close button.',
  );
  assert.match(
    css,
    /\.validation-stats-popup\s*\{[\s\S]*?position:\s*fixed/,
    'The validation stats popup should overlay the validation screen.',
  );
  assert.match(
    css,
    /\.validation-stats-grid\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/,
    'The validation stats should use a stable two-column grid on larger screens.',
  );

  const mobileRules = readMediaRule('max-width:\\s*620px');
  assert.match(
    mobileRules,
    /\.validation-stats-grid\s*\{[\s\S]*?grid-template-columns:\s*1fr/,
    'The validation stats grid should collapse to one column on small screens.',
  );
});

test('validation controls slide offscreen during active accuracy checks', () => {
  assert.match(
    css,
    /\.app-shell\.is-validation-test\.is-accuracy-check-active\s+#validationTestPanel\s*\{[\s\S]*?transform:\s*translateX\(calc\(100%\s*\+\s*32px\)\)/,
    'The validation controls should move off to the side while accuracy targets are being captured.',
  );
  assert.match(
    css,
    /\.app-shell\.is-validation-test\s+#validationTestPanel\s*\{[\s\S]*?transition:\s*transform/,
    'The validation controls should have a stable slide transition.',
  );
});

test('participant setup is concise and exposes explicit video choice', () => {
  assert.equal(
    html.includes('class="participant-copy"'),
    false,
    'Participant setup should not show explanatory subtitle copy.',
  );
  assert.match(
    html,
    /id="participantStudyVideoSelect"/,
    'Participant setup should include a visible study video dropdown.',
  );
  assert.equal(
    html.includes('id="participantSessionStatus"'),
    false,
    'Participant session controls should not include the extra status card.',
  );
  assert.equal(
    html.includes('id="participantModeLink"'),
    false,
    'The viewer toolbar should not include a participant mode button.',
  );
  assert.match(
    html,
    /Tôi đồng ý cho ghi lại ánh nhìn qua webcam trong phiên nghiên cứu này\./,
    'Consent copy should use the requested webcam gaze wording.',
  );
});

test('flat video viewer styling removes drag affordance', () => {
  assert.match(
    css,
    /\.viewer\.is-flat-video\s*\{[\s\S]*?cursor:\s*default/,
    'Flat 2D videos should not present a draggable viewer cursor.',
  );
});
