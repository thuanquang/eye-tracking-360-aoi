import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  buildParticipantSubmissionFileName,
  buildParticipantSubmissionRequest,
  buildStudyAssetFetchPath,
  getDeploymentSeeSoLicenseKey,
  submitParticipantExport,
  submitValidationResult,
} from '../src/app/deploymentConfig.js';

test('deployment config uploads submissions without rewriting study assets through a remote worker', async () => {
  const configSource = await readFile(new URL('../deployment-config.js', import.meta.url), 'utf8');

  assert.doesNotMatch(configSource, /assetBaseUrl\s*:/);
  assert.doesNotMatch(configSource, /aoiAssetBaseUrl\s*:/);
  assert.match(configSource, /submissionEndpoint\s*:/);
});

test('reads the SeeSo license key from deployment config', () => {
  assert.equal(getDeploymentSeeSoLicenseKey({ seeSoLicenseKey: ' key-from-config ' }), 'key-from-config');
  assert.equal(getDeploymentSeeSoLicenseKey({}), '');
  assert.equal(getDeploymentSeeSoLicenseKey({ seeSoLicenseKey: 123 }), '');
});

test('builds fetch paths for bundled local study assets only', () => {
  assert.equal(
    buildStudyAssetFetchPath('runpod-aoi-results/example.json'),
    './runpod-aoi-results/example.json',
  );
  assert.equal(
    buildStudyAssetFetchPath('/runpod-aoi-results/example.json'),
    './runpod-aoi-results/example.json',
  );
  assert.equal(
    buildStudyAssetFetchPath('https://assets.example.test/runpod-aoi-results/example.json'),
    './runpod-aoi-results/example.json',
  );
});

test('builds participant submission requests for JSON uploads', () => {
  const payload = {
    exportedAt: '2026-06-16T12:34:56.000Z',
    participant: { id: 'P 001' },
    project: { video: { id: 'nguyen-hue-360-0500' } },
  };

  const fileName = buildParticipantSubmissionFileName(payload);
  assert.equal(fileName, 'pilot-nguyen-hue-360-0500-P-001-2026-06-16T12-34-56-000Z.json');

  assert.deepEqual(
    buildParticipantSubmissionRequest(payload, {
      studyId: 'pilot',
      uploadToken: 'token-123',
    }),
    {
      fileName,
      body: JSON.stringify(payload),
      headers: {
        'content-type': 'application/json',
        'x-file-name': fileName,
        'x-study-id': 'pilot',
        'x-upload-token': 'token-123',
      },
    },
  );
});

test('submits participant exports to the configured endpoint', async () => {
  const calls = [];
  const result = await submitParticipantExport(
    {
      exportedAt: '2026-06-16T12:34:56.000Z',
      participant: { id: 'P001' },
      project: { video: { id: 'nature-tam-coc-2d' } },
    },
    {
      config: {
        studyId: 'pilot',
        submissionEndpoint: 'https://worker.example.test/upload',
      },
      fetchFn: async (...args) => {
        calls.push(args);
        return { ok: true, status: 200 };
      },
    },
  );

  assert.deepEqual(result, {
    ok: true,
    fileName: 'pilot-nature-tam-coc-2d-P001-2026-06-16T12-34-56-000Z.json',
  });
  assert.equal(calls[0][0], 'https://worker.example.test/upload');
  assert.equal(calls[0][1].method, 'POST');
  assert.equal(calls[0][1].headers['x-study-id'], 'pilot');
});

test('submits validation results to the configured endpoint with a validation filename', async () => {
  const calls = [];
  const result = await submitValidationResult(
    {
      exportedAt: '2026-06-17T09:10:11.000Z',
      validation: { id: 'see so check', passed: true },
      project: { video: { id: 'nguyen-hue-validation' } },
    },
    {
      config: {
        studyId: 'pilot',
        submissionEndpoint: 'https://worker.example.test/upload',
      },
      fetchFn: async (...args) => {
        calls.push(args);
        return { ok: true, status: 200 };
      },
    },
  );

  assert.deepEqual(result, {
    ok: true,
    fileName: 'pilot-validation-nguyen-hue-validation-see-so-check-2026-06-17T09-10-11-000Z.json',
  });
  assert.equal(calls[0][0], 'https://worker.example.test/upload');
  assert.equal(calls[0][1].method, 'POST');
  assert.equal(calls[0][1].headers['x-study-id'], 'pilot');
  assert.equal(calls[0][1].headers['x-file-name'], result.fileName);
});

test('skips participant export submission when no endpoint is configured', async () => {
  const result = await submitParticipantExport({}, {
    config: {},
    fetchFn: async () => {
      throw new Error('fetch should not be called');
    },
  });

  assert.deepEqual(result, {
    ok: false,
    skipped: true,
    reason: 'missing-endpoint',
  });
});
