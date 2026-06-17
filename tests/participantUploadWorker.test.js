import assert from 'node:assert/strict';
import test from 'node:test';

import worker from '../cloudflare/participant-upload-worker.js';

test('stores participant JSON submissions in R2', async () => {
  const puts = [];
  const request = new Request('https://upload.example.test/', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'origin': 'https://study.example.test',
      'x-file-name': 'pilot-video-P001-2026-06-16T12-34-56-000Z.json',
    },
    body: JSON.stringify({ participant: { id: 'P001' } }),
  });

  const response = await worker.fetch(request, {
    RESULTS_BUCKET: {
      put: async (...args) => {
        puts.push(args);
      },
    },
    ALLOWED_ORIGIN: 'https://study.example.test',
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('access-control-allow-origin'), 'https://study.example.test');
  assert.equal(puts[0][0], 'submissions/pilot-video-P001-2026-06-16T12-34-56-000Z.json');
  assert.equal(puts[0][2].httpMetadata.contentType, 'application/json');
});

test('answers CORS preflight requests', async () => {
  const response = await worker.fetch(
    new Request('https://upload.example.test/', { method: 'OPTIONS' }),
    { ALLOWED_ORIGIN: '*' },
  );

  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-methods'), 'POST, OPTIONS');
});

test('does not serve study assets because local bundles own runtime assets', async () => {
  const response = await worker.fetch(
    new Request('https://upload.example.test/assets/clips/example.mp4'),
    { ALLOWED_ORIGIN: '*' },
  );

  assert.equal(response.status, 405);
  assert.deepEqual(await response.json(), { ok: false, error: 'method-not-allowed' });
});

test('worker config only binds the R2 results bucket', async () => {
  const config = await import('node:fs/promises')
    .then(({ readFile }) => readFile(new URL('../cloudflare/wrangler.worker.toml', import.meta.url), 'utf8'));

  assert.match(config, /binding\s*=\s*"RESULTS_BUCKET"/);
  assert.doesNotMatch(config, /ASSETS_BUCKET/);
});
