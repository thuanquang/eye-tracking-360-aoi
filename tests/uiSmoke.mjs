import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { chromium } from 'playwright';

const TARGET_URL = process.env.AOI_PROTOTYPE_URL || 'http://127.0.0.1:5179';

function urlWithMode(mode) {
  const url = new URL(TARGET_URL);
  url.searchParams.set('mode', mode);
  return url.toString();
}

function hasColorVariance(samples) {
  const uniqueColors = new Set();

  for (let index = 0; index < samples.length; index += 4) {
    const alpha = samples[index + 3];
    if (alpha === 0) {
      continue;
    }

    uniqueColors.add(`${samples[index]},${samples[index + 1]},${samples[index + 2]}`);
    if (uniqueColors.size > 12) {
      return true;
    }
  }

  return false;
}

async function recordMouseExport(page, viewerBox) {
  await page.mouse.move(viewerBox.x + viewerBox.width / 2, viewerBox.y + viewerBox.height / 2);
  await page.locator('#recordButton').click();
  await page.waitForFunction(() => document.querySelector('#sampleCount')?.textContent !== '0');
  await page.locator('#recordButton').click();

  const downloadPromise = page.waitForEvent('download');
  await page.locator('#exportButton').click();
  const download = await downloadPromise;

  return JSON.parse(await readFile(await download.path(), 'utf8'));
}

const browser = await chromium.launch();
const page = await browser.newPage({
  acceptDownloads: true,
  viewport: { width: 1366, height: 900 },
});
const consoleErrors = [];

page.on('console', (message) => {
  if (message.type() === 'error') {
    consoleErrors.push(message.text());
  }
});

try {
  await page.goto(urlWithMode('admin'), { waitUntil: 'networkidle' });
  await page.waitForSelector('#viewer canvas');
  await page.waitForFunction(() => document.querySelector('#sourceVideo')?.readyState >= 1);

  const hasContent = await page.evaluate(() => document.body.innerText.trim().length > 0);
  assert.equal(hasContent, true, 'Page body should contain visible UI text.');
  assert.equal(await page.locator('#controlPanel').isVisible(), true, 'Admin controls should be visible by default.');
  assert.equal(await page.locator('#participantPanel').isVisible(), false, 'Participant panel should be hidden in admin mode.');
  assert.equal(await page.locator('#modeLabel').innerText(), 'webcam');
  assert.match(await page.locator('#screenReadout').innerText(), /waiting for webcam gaze|--/);
  await assert.doesNotReject(
    page.locator('#manualAoiPanel').waitFor({ state: 'visible', timeout: 1000 }),
    'Admin should expose manual AOI authoring controls.',
  );
  await assert.doesNotReject(
    page.locator('#cloudAoiPanel').waitFor({ state: 'visible', timeout: 1000 }),
    'Admin should expose Google Colab auto-AOI controls.',
  );
  await assert.doesNotReject(
    page.locator('#projectionSelect').waitFor({ state: 'visible', timeout: 1000 }),
    'Admin should expose video projection metadata controls.',
  );

  const participantPage = await browser.newPage({
    viewport: { width: 1366, height: 900 },
  });
  await participantPage.goto(urlWithMode('participant'), { waitUntil: 'networkidle' });
  await participantPage.waitForSelector('#participantPanel');
  assert.equal(await participantPage.locator('#controlPanel').isVisible(), false, 'Research controls should be hidden in participant mode.');
  assert.equal(await participantPage.locator('#participantPanel').isVisible(), true, 'Participant panel should be visible in participant mode.');
  assert.equal(await participantPage.locator('#participantStartButton').isEnabled(), false, 'Participant start should require required fields.');
  await participantPage.locator('#participantIdInput').fill('P042');
  await participantPage.locator('#participantNameInput').fill('Nguyen A');
  await participantPage.locator('#participantAgeInput').fill('22');
  await participantPage.locator('#participantConsentInput').check();
  assert.equal(await participantPage.locator('#participantStartButton').isEnabled(), true, 'Participant start should enable after valid metadata.');
  await participantPage.locator('#participantStartButton').click();
  await participantPage.waitForFunction(() => document.querySelector('#participantStageLabel')?.textContent?.includes('Ready'));
  assert.equal(await participantPage.locator('#modeLabel').innerText(), 'webcam');
  await participantPage.close();

  await page.waitForFunction(() => document.querySelector('#aoiList')?.textContent?.includes('AOI JSON'));
  assert.equal(
    await page.locator('#aoiSourceLabel').innerText(),
    'assets/aois.json',
    'UI should show whether AOIs came from the editable JSON file.',
  );
  await page.locator('#projectionSelect').selectOption('flat');
  await page.locator('#manualAoiLabelInput').fill('Manual flat AOI');
  await page.locator('#manualAoiSizeInput').fill('24');
  await page.locator('#addManualAoiButton').click();
  await page.waitForFunction(() => document.querySelector('#aoiList')?.textContent?.includes('Manual flat AOI'));
  await page.locator('#cloudAoiPromptsInput').fill('person\nscreen, sign');
  await page.locator('#cloudAoiSampleIntervalInput').fill('0.75');
  const colabJobDownloadPromise = page.waitForEvent('download');
  await page.locator('#exportColabJobButton').click();
  const colabJobDownload = await colabJobDownloadPromise;
  const colabJob = JSON.parse(await readFile(await colabJobDownload.path(), 'utf8'));
  assert.equal(colabJob.kind, 'aoi-colab-job', 'Colab job export should identify the job kind.');
  assert.equal(colabJob.video.projection, 'flat', 'Colab job export should preserve selected projection metadata.');
  assert.deepEqual(
    colabJob.aoiPolicy.prompts,
    ['person', 'screen', 'sign'],
    'Colab job export should parse newline and comma separated AOI prompts.',
  );
  const tmpDir = await mkdtemp(join(tmpdir(), 'aoi-sidecar-'));
  const sidecarPath = join(tmpDir, 'test-video.aoi.json');
  await writeFile(sidecarPath, JSON.stringify({
    video: {
      name: 'test-video.mp4',
      durationSec: 16,
      projection: 'equirectangular',
      stereoLayout: 'top-bottom',
    },
    aois: [
      {
        id: 'sidecar-center',
        label: 'Sidecar center AOI',
        color: '#ff4f9a',
        yawMin: -12,
        yawMax: 12,
        pitchMin: -8,
        pitchMax: 8,
        keyframes: [
          { t: 0, yawMin: -12, yawMax: 12, pitchMin: -8, pitchMax: 8 },
          { t: 8, yawMin: 12, yawMax: 36, pitchMin: -6, pitchMax: 10 },
        ],
      },
      {
        id: 'sidecar-right-edge',
        label: 'Sidecar right-edge AOI',
        color: '#5dd7c8',
        yawMin: 42,
        yawMax: 76,
        pitchMin: -8,
        pitchMax: 8,
      },
    ],
  }, null, 2));
  await page.locator('#aoiFileInput').setInputFiles(sidecarPath);
  await page.waitForFunction(() => document.querySelector('#aoiList')?.textContent?.includes('Sidecar center AOI'));
  assert.equal(
    await page.locator('#aoiSourceLabel').innerText(),
    'test-video.aoi.json',
    'Local AOI sidecar files should register as the active AOI source.',
  );
  await page.waitForFunction(() => document.querySelectorAll('#aoiOverlay .aoi-overlay-shape').length > 0);
  assert.equal(
    await page.locator('#aoiOverlay .aoi-overlay-shape').count(),
    2,
    'Loaded AOIs should be projected as anchored shapes on the 360 player.',
  );
  assert.equal(
    await page.locator('#aoiOverlay [data-aoi-id="sidecar-right-edge"]').count(),
    1,
    'AOIs partly outside the player viewport should still render as clipped anchored shapes.',
  );

  const viewerBox = await page.locator('#viewer').boundingBox();
  const mouseMoveLeakCount = await page.locator('#viewer').evaluate((viewerElement) => {
    window.__aoiMouseMoveLeakCount = 0;
    document.addEventListener('mousemove', () => {
      window.__aoiMouseMoveLeakCount += 1;
    });
    viewerElement.dispatchEvent(new MouseEvent('mousemove', {
      bubbles: true,
      cancelable: true,
      clientX: viewerElement.getBoundingClientRect().left + 20,
      clientY: viewerElement.getBoundingClientRect().top + 20,
    }));

    return window.__aoiMouseMoveLeakCount;
  });
  assert.equal(mouseMoveLeakCount, 0, 'Mousemove events should not reach WebGazer-style document listeners.');

  await page.mouse.move(viewerBox.x + 48, viewerBox.y + 48);
  await page.mouse.move(viewerBox.x + viewerBox.width - 48, viewerBox.y + viewerBox.height - 48);
  assert.match(
    await page.locator('#screenReadout').innerText(),
    /waiting for webcam gaze|--/,
    'Mouse movement should not drive gaze unless mouse debug mode is selected.',
  );

  await assert.doesNotReject(
    page.locator('#calibrateButton').waitFor({ state: 'visible', timeout: 1000 }),
    'Webcam calibration control should be visible.',
  );
  await assert.doesNotReject(
    page.locator('#accuracyButton').waitFor({ state: 'visible', timeout: 1000 }),
    'Webcam accuracy control should be visible.',
  );

  const noticeHidden = await page.locator('#viewerNotice').evaluate((element) => {
    return element.classList.contains('is-hidden') || getComputedStyle(element).display === 'none';
  });
  assert.equal(noticeHidden, true, 'Loaded local video should hide the placeholder notice.');

  await page.locator('#recordButton').click();
  assert.equal(
    await page.locator('#recordButton').innerText(),
    'Start Recording',
    'Webcam recording should be blocked until accuracy is checked.',
  );
  assert.match(
    await page.locator('#viewerNotice').innerText(),
    /Check accuracy/,
    'Blocked webcam recording should explain that accuracy must be checked first.',
  );

  await page.locator('#mouseModeButton').click();
  assert.equal(await page.locator('#modeLabel').innerText(), 'mouse');

  const boxExportedJson = await recordMouseExport(page, viewerBox);
  const [boxSample] = boxExportedJson.samples;

  assert.equal(boxExportedJson.samples.length > 0, true, 'Mouse recording should export at least one 360 sidecar sample.');
  assert.equal(
    boxExportedJson.aoiSource,
    'test-video.aoi.json',
    'Export should identify the registered 360 AOI sidecar source.',
  );
  assert.equal(
    boxExportedJson.aois.some((aoi) => aoi.id === 'sidecar-center'),
    true,
    'Export should package AOI definitions from the registered 360 sidecar file.',
  );
  assert.equal(
    boxExportedJson.project.video.projection,
    'equirectangular',
    'Export should preserve 360 video projection metadata from the AOI sidecar.',
  );
  assert.equal(
    boxExportedJson.project.video.stereoLayout,
    'top-bottom',
    'Export should preserve 3D stereo layout metadata from the AOI sidecar.',
  );
  assert.equal(
    boxSample.activeAois.some((aoi) => aoi.id === 'sidecar-center' && Number.isFinite(aoi.yawMin)),
    true,
    'Time-resolved 360 AOI bounds should be inspectable by AOI id.',
  );

  await page.locator('#clearButton').click();
  assert.equal(await page.locator('#sampleCount').innerText(), '0', 'Clear should reset samples before polygon export coverage.');

  const invalidPolygonSidecarPath = join(tmpDir, 'invalid-polygon-video.aoi.json');
  await writeFile(invalidPolygonSidecarPath, JSON.stringify({
    video: {
      name: 'test-video.mp4',
      projection: 'flat',
      stereoLayout: 'mono',
    },
    aois: [
      {
        id: 'invalid-polygon-object',
        label: 'Invalid polygon object',
        color: '#ffd166',
        space: 'video',
        shape: 'polygon',
        points: [
          { x: 0.3, y: 0.2 },
          { x: 0.55, y: 0.24 },
          { x: 0.52, y: 0.5 },
          { x: 0.33, y: 0.46 },
        ],
        keyframes: [
          {
            t: 0,
            points: [
              { x: 0.3, y: 0.2 },
              { x: '', y: 0.24 },
              { x: 0.52, y: 0.5 },
              { x: 0.33, y: 0.46 },
            ],
          },
        ],
      },
    ],
  }, null, 2));

  await page.locator('#aoiFileInput').setInputFiles(invalidPolygonSidecarPath);
  await page.waitForFunction(() => (
    document.querySelector('#viewerNotice')?.textContent?.includes('Could not load AOI JSON') ||
    document.querySelector('#aoiSourceLabel')?.textContent === 'invalid-polygon-video.aoi.json'
  ));
  assert.match(
    await page.locator('#viewerNotice').innerText(),
    /Could not load AOI JSON/,
    'Invalid polygon keyframe coordinates should be rejected.',
  );
  assert.equal(
    await page.locator('#aoiSourceLabel').innerText(),
    'test-video.aoi.json',
    'Rejected polygon sidecars should not replace the active AOI source.',
  );
  assert.equal(
    (await page.locator('#aoiList').innerText()).includes('Invalid polygon object'),
    false,
    'Rejected polygon sidecars should not switch the AOI list.',
  );

  const polygonSidecarPath = join(tmpDir, 'polygon-video.aoi.json');
  await writeFile(polygonSidecarPath, JSON.stringify({
    video: {
      name: 'test-video.mp4',
      projection: 'flat',
      stereoLayout: 'mono',
    },
    aois: [
      {
        id: 'polygon-object',
        label: 'Polygon object',
        color: '#ffd166',
        space: 'video',
        shape: 'polygon',
        points: [
          { x: 0.3, y: 0.2 },
          { x: 0.55, y: 0.24 },
          { x: 0.52, y: 0.5 },
          { x: 0.33, y: 0.46 },
        ],
        keyframes: [
          {
            t: 0,
            points: [
              { x: 0.3, y: 0.2 },
              { x: 0.55, y: 0.24 },
              { x: 0.52, y: 0.5 },
              { x: 0.33, y: 0.46 },
            ],
          },
        ],
      },
    ],
  }, null, 2));

  await page.locator('#aoiFileInput').setInputFiles(polygonSidecarPath);
  await page.waitForFunction(() => document.querySelector('#aoiList')?.textContent?.includes('Polygon object'));
  await page.waitForFunction(() => document.querySelector('#aoiOverlay [data-aoi-id="polygon-object"]'));
  assert.equal(
    await page.locator('#aoiOverlay [data-aoi-id="polygon-object"]').count(),
    1,
    'Imported polygon AOIs should render as object-shaped overlay polygons.',
  );

  const exportedJson = await recordMouseExport(page, viewerBox);
  const [sample] = exportedJson.samples;

  assert.equal(exportedJson.samples.length > 0, true, 'Mouse recording should export at least one sample.');
  assert.equal(
    exportedJson.aoiSource,
    'polygon-video.aoi.json',
    'Export should identify the registered AOI sidecar source.',
  );
  assert.equal(
    exportedJson.aois.some((aoi) => aoi.id === 'polygon-object' && aoi.shape === 'polygon'),
    true,
    'Export should package AOI definitions from the registered sidecar file.',
  );
  assert.equal(
    exportedJson.project.video.name,
    'test-video.mp4',
    'Export should package usable video identity metadata with the AOIs.',
  );
  assert.equal(
    exportedJson.project.video.projection,
    'flat',
    'Export should preserve flat video projection metadata from the AOI sidecar.',
  );
  assert.equal(
    exportedJson.project.video.stereoLayout,
    'mono',
    'Export should preserve mono video layout metadata from the AOI sidecar.',
  );
  assert.equal(
    exportedJson.project.aois.count,
    exportedJson.aois.length,
    'Export should summarize how many AOIs are packaged with the video.',
  );
  assert.equal(
    exportedJson.aois[0].keyframes.length,
    1,
    'Export should package dynamic AOI keyframes with the video.',
  );
  assert.equal(
    exportedJson.summary.totalSamples,
    exportedJson.samples.length,
    'Export should include a quick sample count summary.',
  );
  assert.equal(
    exportedJson.summary.sources.mouse,
    exportedJson.samples.length,
    'Export summary should count samples by input source.',
  );
  assert.equal(
    typeof exportedJson.summary.durationSec,
    'number',
    'Export summary should include recording duration in seconds.',
  );
  assert.equal(
    typeof exportedJson.summary.aoiHitCounts,
    'object',
    'Export summary should include AOI hit counts.',
  );
  assert.equal(
    typeof exportedJson.summary.aoiDwellSec,
    'object',
    'Export summary should include estimated AOI dwell seconds.',
  );
  assert.equal(
    typeof exportedJson.summary.likelyAoiDwellSec,
    'object',
    'Export summary should include estimated likely-AOI dwell seconds.',
  );
  assert.equal(typeof exportedJson.namedAoiMetrics, 'object', 'Export should include named AOI metrics.');
  assert.equal(
    exportedJson.namedAoiMetrics.perAoi['polygon-object'].label,
    'Polygon object',
    'Named AOI metrics should retain AOI labels.',
  );
  assert.equal(
    typeof exportedJson.namedAoiMetrics.perAoi['polygon-object'].totalDwellSec,
    'number',
    'Named AOI metrics should include per-AOI dwell seconds.',
  );
  assert.equal(
    typeof exportedJson.namedAoiMetrics.session.averageFixationDurationMs,
    'number',
    'Named AOI metrics should include session fixation metrics.',
  );
  assert.equal(exportedJson.participant, null, 'Admin/mouse demo exports should not invent participant metadata.');
  assert.equal(
    exportedJson.summary.durationSec > 0,
    true,
    'Export summary duration should be useful even when the video is paused in a mouse-demo recording.',
  );
  assert.equal(
    exportedJson.summary.accuracyValidated,
    false,
    'Mouse demo exports should not pretend webcam accuracy was validated.',
  );
  assert.equal(Array.isArray(sample.hits), true, 'Exported samples should retain exact AOI hits.');
  assert.equal(Array.isArray(sample.likelyHits), true, 'Exported samples should include likely AOI hits.');
  assert.equal(Array.isArray(sample.possibleHits), true, 'Exported samples should include possible AOI hits.');
  assert.equal(Array.isArray(sample.ambiguousHits), true, 'Exported samples should include ambiguous AOI hits.');
  assert.equal(Array.isArray(sample.activeAois), true, 'Exported samples should include time-resolved AOI bounds.');
  assert.equal(
    sample.activeAois.some((aoi) => (
      aoi.id === 'polygon-object' &&
      aoi.shape === 'polygon' &&
      Array.isArray(aoi.points) &&
      aoi.points.length === 4
    )),
    true,
    'Time-resolved polygon AOI points should be inspectable by AOI id.',
  );
  assert.equal(
    sample.quality.trustedForAoiAnalysis,
    true,
    'Mouse-demo samples should be marked trusted for AOI analysis.',
  );
  assert.equal(
    sample.quality.webcamAccuracyValidated,
    false,
    'Mouse-demo samples should not claim webcam accuracy validation.',
  );
  assert.equal(
    exportedJson.summary.trustedSampleCount,
    exportedJson.samples.length,
    'Export summary should count trusted samples.',
  );
  assert.deepEqual(
    sample.gazeUncertainty,
    { px: 0, yawRadius: 0, pitchRadius: 0 },
    'Mouse-mode samples should export zero gaze uncertainty.',
  );

  const reviewPath = join(tmpDir, 'recording-review.json');
  await writeFile(reviewPath, JSON.stringify(exportedJson), 'utf8');
  await page.locator('#recordingFileInput').setInputFiles(reviewPath);
  await page.waitForFunction(() => document.querySelector('#reviewButton')?.disabled === false);
  assert.match(
    await page.locator('#viewerNotice').innerText(),
    /Loaded recording JSON/,
    'Loading an exported recording should explain that review mode is ready.',
  );
  await page.locator('#reviewButton').click();
  await page.waitForFunction(() => document.querySelector('#modeLabel')?.textContent === 'review');
  await page.waitForFunction(() => /^x \d+, y \d+$/.test(document.querySelector('#screenReadout')?.textContent || ''));
  assert.match(
    await page.locator('#hitReadout').innerText(),
    /Polygon object|none|possible|ambiguous/i,
    'Review mode should replay recorded tracker and AOI readout state.',
  );
  assert.equal(
    await page.locator('#sampleCount').innerText(),
    String(exportedJson.samples.length),
    'Review mode should show the loaded recording sample count.',
  );

  const calibrationHidden = await page.locator('#calibrationOverlay').evaluate((element) => element.hidden);
  assert.equal(calibrationHidden, true, 'Calibration overlay should be hidden before calibration starts.');

  const canvasSamples = await page.locator('#viewer canvas').evaluate((canvas) => {
    const context = canvas.getContext('webgl2') || canvas.getContext('webgl');
    const width = canvas.width;
    const height = canvas.height;
    const pixels = new Uint8Array(4 * 25);
    let offset = 0;

    for (let row = 0; row < 5; row += 1) {
      for (let column = 0; column < 5; column += 1) {
        context.readPixels(
          Math.floor((column + 0.5) * width / 5),
          Math.floor((row + 0.5) * height / 5),
          1,
          1,
          context.RGBA,
          context.UNSIGNED_BYTE,
          pixels,
          offset,
        );
        offset += 4;
      }
    }

    return Array.from(pixels);
  });

  assert.equal(hasColorVariance(canvasSamples), true, 'Three.js canvas should render nonblank video pixels.');
  assert.deepEqual(consoleErrors, [], 'Browser console should not contain errors.');
} finally {
  await browser.close();
}
