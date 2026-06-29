import test from 'node:test';
import assert from 'node:assert/strict';

import {
  gzipTextToBlob,
  gunzipBlobToText,
  isGzipFile,
  supportsGzipStreams,
} from '../src/recording/jsonCompression.js';

test('gzip helpers round-trip JSON text without changing structure', async () => {
  if (!supportsGzipStreams()) {
    assert.equal(supportsGzipStreams(), false);
    return;
  }

  const payload = {
    samples: Array.from({ length: 100 }, (_, index) => ({
      t: Number((index / 30).toFixed(3)),
      panorama: { yaw: 1, pitch: 2 },
      activeAois: [{ id: 'front', label: 'Front', points: [{ yaw: 1, pitch: 2 }] }],
    })),
    summary: { totalSamples: 100 },
  };
  const text = JSON.stringify(payload);
  const compressed = await gzipTextToBlob(text);
  const restored = await gunzipBlobToText(compressed);

  assert.ok(compressed.size < text.length);
  assert.deepEqual(JSON.parse(restored), payload);
});

test('detects gzip recording files by filename or MIME type', () => {
  assert.equal(isGzipFile({ name: 'recording.json.gz', type: '' }), true);
  assert.equal(isGzipFile({ name: 'recording.JSON.GZ', type: '' }), true);
  assert.equal(isGzipFile({ name: 'recording.json', type: 'application/gzip' }), true);
  assert.equal(isGzipFile({ name: 'recording.json', type: 'application/json' }), false);
});
