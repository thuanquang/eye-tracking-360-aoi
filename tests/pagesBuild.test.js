import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);

test('Cloudflare Pages build includes EyeDid runtime headers and SDK asset', async () => {
  await execFileAsync('node', ['scripts/build_pages_dist.mjs']);

  const headers = await readFile('dist/_headers', 'utf8');
  assert.match(headers, /Cross-Origin-Opener-Policy:\s*same-origin/);
  assert.match(headers, /Cross-Origin-Embedder-Policy:\s*credentialless/);
  assert.match(headers, /Cross-Origin-Resource-Policy:\s*cross-origin/);

  await access('dist/vendor/seeso/seeso.min.js');
});

test('browser entrypoint waits for deployment config before loading study video assets', async () => {
  const html = await readFile('index.html', 'utf8');

  assert.doesNotMatch(
    html,
    /<video[\s\S]*\ssrc=["']\.\/assets\//,
    'The app controller should set study video URLs after deployment config has loaded.',
  );
});
