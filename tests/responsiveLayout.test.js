import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');

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
