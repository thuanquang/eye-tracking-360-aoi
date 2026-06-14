import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('serve command uses a cross-origin isolated dev server for SeeSo', async () => {
  const packageJson = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8'),
  );

  assert.equal(packageJson.scripts.serve, 'node scripts/serve_dev.mjs');

  const serverSource = await readFile(
    new URL('../scripts/serve_dev.mjs', import.meta.url),
    'utf8',
  );

  assert.match(serverSource, /Cross-Origin-Opener-Policy['"]:\s*['"]same-origin/);
  assert.match(serverSource, /Cross-Origin-Embedder-Policy['"]:\s*['"]credentialless/);
  assert.match(serverSource, /Cross-Origin-Resource-Policy['"]:\s*['"]cross-origin/);
  assert.match(serverSource, /http-server/);
});
