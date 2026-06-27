import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { chromium } from 'playwright';

const TARGET_URL = process.env.AOI_PROTOTYPE_URL || 'http://127.0.0.1:5179?mode=admin';

const tmpDir = await mkdtemp(join(tmpdir(), 'batch-heatmap-smoke-'));
const heatmapMergeVideo = {
  name: 'Batch Merge Smoke.mp4',
  src: 'assets/smoke/batch-merge-smoke.mp4',
  projection: 'flat',
};

function createMergeScreenHeatmap({ weightSec, sampleCount, column }) {
  return {
    type: 'screen',
    columns: 2,
    rows: 2,
    width: 320,
    height: 180,
    dimensionSource: 'provided',
    trustedOnly: true,
    totalWeightSec: weightSec,
    bins: [{ column, row: 0, weightSec, sampleCount }],
  };
}

async function writeHeatmapExport(fileName, { participantId, weightSec, sampleCount, column }) {
  const filePath = join(tmpDir, fileName);

  await writeFile(filePath, JSON.stringify({
    exportedAt: '2026-06-27T10:00:00.000Z',
    participant: { id: participantId },
    video: heatmapMergeVideo,
    summary: {
      heatmaps: {
        screen: createMergeScreenHeatmap({ weightSec, sampleCount, column }),
        variants: {
          trusted: {
            screen: createMergeScreenHeatmap({ weightSec, sampleCount, column }),
          },
        },
      },
    },
  }, null, 2));

  return filePath;
}

const firstHeatmapMergePath = await writeHeatmapExport('batch-heatmap-p1.json', {
  participantId: 'merge-smoke-p1',
  weightSec: 0.25,
  sampleCount: 3,
  column: 0,
});
const brokenHeatmapMergePath = join(tmpDir, 'batch-heatmap-broken.json');
await writeFile(brokenHeatmapMergePath, '{ not json');
const secondHeatmapMergePath = await writeHeatmapExport('batch-heatmap-p2.json', {
  participantId: 'merge-smoke-p2',
  weightSec: 0.5,
  sampleCount: 5,
  column: 1,
});

const browser = await chromium.launch();

try {
  const page = await browser.newPage({
    acceptDownloads: true,
    viewport: { width: 1280, height: 900 },
  });

  await page.goto(TARGET_URL);
  await page.waitForSelector('#heatmapMergeFileInput');

  const recordingNav = page.locator('#adminWorkflowRail a[href="#adminRecordingPanel"]');
  if (await recordingNav.isVisible()) {
    await recordingNav.click();
  }

  await page.locator('#heatmapMergeFileInput').scrollIntoViewIfNeeded();
  assert.equal(
    await page.locator('#heatmapMergeFileInput').isVisible(),
    true,
    'Batch heatmap merge file input should be visible.',
  );
  await page.locator('#heatmapMergeFileInput').setInputFiles([
    firstHeatmapMergePath,
    brokenHeatmapMergePath,
    secondHeatmapMergePath,
  ]);
  await page.waitForFunction(() => {
    const status = document.querySelector('#heatmapMergeStatus')?.textContent || '';
    return /3\s+file/i.test(status) && /1\s+nhom/i.test(status) && /bo qua\s+1/i.test(status);
  });
  assert.match(
    await page.locator('#heatmapMergeStatus').innerText(),
    /3\s+file[\s\S]*1\s+nhom[\s\S]*bo qua\s+1/i,
    'Batch heatmap merge status should report valid groups and skipped malformed files.',
  );
  assert.equal(
    await page.locator('#exportMergedHeatmapJsonButton').isEnabled(),
    true,
    'Merged heatmap JSON export should enable after compatible files load.',
  );
  assert.equal(
    await page.locator('#exportMergedHeatmapImageButton').isEnabled(),
    true,
    'Merged heatmap image export should enable after compatible files load.',
  );

  const mergedHeatmapJsonDownloadPromise = page.waitForEvent('download');
  await page.locator('#exportMergedHeatmapJsonButton').click();
  const mergedHeatmapJsonDownload = await mergedHeatmapJsonDownloadPromise;
  const mergedHeatmapJson = JSON.parse(await readFile(await mergedHeatmapJsonDownload.path(), 'utf8'));

  assert.equal(mergedHeatmapJson.kind, 'merged-heatmaps');
  assert.equal(mergedHeatmapJson.sourceFileCount, 3);
  assert.equal(mergedHeatmapJson.groupCount, 1);
  assert.equal(mergedHeatmapJson.groups[0].sourceCount, 2);
  assert.equal(mergedHeatmapJson.skipped.length, 1);
  assert.equal(mergedHeatmapJson.skipped[0].fileName, 'batch-heatmap-broken.json');
  assert.equal(mergedHeatmapJson.skipped[0].reason, 'invalid-json');
  assert.equal(
    mergedHeatmapJson.groups[0].summary.heatmaps.screen.totalWeightSec,
    0.75,
    'Merged heatmap JSON should sum compatible screen heatmap weight.',
  );

  await page.locator('#mergedHeatmapTypeSelect').selectOption('screen');
  const mergedHeatmapImageDownloadPromise = page.waitForEvent('download');
  await page.locator('#exportMergedHeatmapImageButton').click();
  const mergedHeatmapImageDownload = await mergedHeatmapImageDownloadPromise;
  const mergedHeatmapImagePath = await mergedHeatmapImageDownload.path();
  assert.equal(
    typeof mergedHeatmapImagePath,
    'string',
    'Merged heatmap PNG download should produce a local path.',
  );
  const mergedHeatmapImage = await readFile(mergedHeatmapImagePath);
  assert.equal(
    mergedHeatmapImage.length > 0,
    true,
    'Merged heatmap PNG download should write a non-empty file.',
  );

  console.log('batch heatmap merge smoke passed');
} finally {
  await browser.close();
}
