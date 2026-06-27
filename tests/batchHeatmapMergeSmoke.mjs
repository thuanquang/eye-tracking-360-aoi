import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { chromium } from 'playwright';

import { STUDY_VIDEOS } from '../src/app/studyVideos.js';

const TARGET_URL = process.env.AOI_PROTOTYPE_URL || 'http://127.0.0.1:5179?mode=admin';

const tmpDir = await mkdtemp(join(tmpdir(), 'batch-heatmap-smoke-'));
const defaultPanoramaStudyVideo = STUDY_VIDEOS.find((video) => video.projection === 'equirectangular');
if (!defaultPanoramaStudyVideo) {
  throw new Error('Batch heatmap smoke requires one panorama study video.');
}
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

function createMergePanoramaHeatmap({ weightSec, sampleCount }) {
  return {
    type: 'panorama',
    columns: 2,
    rows: 2,
    yawRange: [-40, 40],
    pitchRange: [-20, 20],
    trustedOnly: true,
    totalWeightSec: weightSec,
    bins: [{ column: 1, row: 0, weightSec, sampleCount }],
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
          likely: {
            screen: createMergeScreenHeatmap({ weightSec: weightSec * 2, sampleCount, column }),
          },
        },
      },
    },
  }, null, 2));

  return filePath;
}

async function writeMergedPanoramaPackage(fileName) {
  const filePath = join(tmpDir, fileName);
  const heatmap = createMergePanoramaHeatmap({ weightSec: 0.8, sampleCount: 6 });

  await writeFile(filePath, JSON.stringify({
    kind: 'merged-heatmaps',
    version: 1,
    exportedAt: '2026-06-27T10:05:00.000Z',
    sourceFileCount: 1,
    groupCount: 1,
    skipped: [],
    groups: [{
      groupKey: defaultPanoramaStudyVideo.id,
      video: {
        id: defaultPanoramaStudyVideo.id,
        name: defaultPanoramaStudyVideo.name,
        src: defaultPanoramaStudyVideo.path,
        projection: defaultPanoramaStudyVideo.projection,
        stereoLayout: defaultPanoramaStudyVideo.stereoLayout,
      },
      sourceCount: 1,
      sources: [{ fileName: 'panorama-source.json', participantId: 'merge-smoke-p3' }],
      summary: {
        heatmaps: {
          panorama: heatmap,
          variants: {
            trusted: {
              panorama: heatmap,
            },
          },
        },
      },
    }],
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
const panoramaMergedPackagePath = await writeMergedPanoramaPackage('batch-heatmap-panorama-package.json');

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
    return /3\s+file/i.test(status) && /1\s+nhóm/i.test(status) && /bỏ qua\s+1/i.test(status);
  });
  assert.match(
    await page.locator('#heatmapMergeStatus').innerText(),
    /3\s+file[\s\S]*1\s+nhóm[\s\S]*bỏ qua\s+1/i,
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
  const mergedHeatmapJsonPath = await mergedHeatmapJsonDownload.path();
  assert.equal(
    typeof mergedHeatmapJsonPath,
    'string',
    'Merged heatmap JSON download should produce a local path.',
  );
  const mergedHeatmapJson = JSON.parse(await readFile(mergedHeatmapJsonPath, 'utf8'));

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

  await page.locator('#mergedHeatmapPackageFileInput').setInputFiles(mergedHeatmapJsonPath);
  await page.waitForFunction(() => (
    document.querySelector('.app-shell')?.classList.contains('is-merged-heatmap-view') &&
    document.querySelector('#viewer')?.classList.contains('is-flat-video') &&
    document.querySelector('#heatmapRuler')?.hidden === false &&
    document.querySelector('#heatmapRulerMax')?.textContent === '500ms'
  ));
  assert.equal(
    await page.locator('#clearMergedHeatmapViewButton').isEnabled(),
    true,
    'Loading final merged heatmap JSON should enable clearing the active merged view.',
  );
  assert.equal(
    await page.locator('#mergedHeatmapTypeSelect').inputValue(),
    'screen',
    'Loading final merged heatmap JSON should select the renderable screen heatmap type.',
  );
  const overlayStats = await page.locator('#gazeHeatmapOverlay').evaluate((canvas) => {
    const context = canvas.getContext('2d');
    if (!context || canvas.width <= 0 || canvas.height <= 0) {
      return { hasDrawnPixels: false };
    }

    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let index = 3; index < pixels.length; index += 4) {
      if (pixels[index] > 0) {
        return { hasDrawnPixels: true };
      }
    }

    return { hasDrawnPixels: false };
  });
  assert.equal(
    overlayStats.hasDrawnPixels,
    true,
    'Loading final merged heatmap JSON should draw non-empty heatmap pixels in the player overlay.',
  );

  await page.locator('#mergedHeatmapVariantSelect').selectOption('likely');
  await page.waitForFunction(() => document.querySelector('#heatmapRulerMax')?.textContent === '1.0s');

  await page.locator('#mergedHeatmapPackageFileInput').setInputFiles(panoramaMergedPackagePath);
  await page.waitForFunction(() => (
    document.querySelector('.app-shell')?.classList.contains('is-merged-heatmap-view') &&
    !document.querySelector('#viewer')?.classList.contains('is-flat-video') &&
    document.querySelector('#mergedHeatmapTypeSelect')?.value === 'panorama' &&
    document.querySelector('#heatmapRuler')?.hidden === false &&
    document.querySelector('#heatmapRulerMax')?.textContent === '800ms'
  ));

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
