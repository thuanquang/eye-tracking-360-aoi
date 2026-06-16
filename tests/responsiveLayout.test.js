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
    'cloudAoiPanel',
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
