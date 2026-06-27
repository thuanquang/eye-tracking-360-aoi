import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  clampCameraPitch,
  getNextCameraFromDrag,
  shouldAllowCameraDrag,
} from '../src/viewer/cameraControls.js';
import {
  getContainedMediaRect,
  getCurrentProjection,
  getCurrentStereoLayout,
  getProjectionTextureTransform,
  getStereoTextureTransform,
  normalizeVideoProjection,
  normalizeStereoLayout,
} from '../src/viewer/projection.js';
import { STUDY_VIDEOS } from '../src/app/studyVideos.js';

test('normalizes video projection metadata', () => {
  assert.equal(normalizeVideoProjection('flat'), 'flat');
  assert.equal(normalizeVideoProjection('weird'), 'equirectangular');
});

test('normalizes stereo layout metadata', () => {
  assert.equal(normalizeStereoLayout('top-bottom'), 'top-bottom');
  assert.equal(normalizeStereoLayout('side-by-side'), 'side-by-side');
  assert.equal(normalizeStereoLayout('broken'), 'mono');
});

test('resolves projection from controls before metadata fallback', () => {
  assert.equal(
    getCurrentProjection({ controlValue: 'flat', metadataProjection: 'equirectangular' }),
    'flat',
  );
  assert.equal(
    getCurrentStereoLayout({ controlValue: '', metadataStereoLayout: 'top-bottom' }),
    'top-bottom',
  );
});

test('updates camera yaw and clamps pitch from pointer drag', () => {
  assert.deepEqual(
    getNextCameraFromDrag({
      cameraYaw: 0,
      cameraPitch: 0,
      dx: 100,
      dy: -100,
      sensitivity: 0.12,
    }),
    { cameraYaw: -12, cameraPitch: 12 },
  );
  assert.equal(clampCameraPitch(100), 85);
});

test('allows drag for equirectangular viewer only', () => {
  assert.equal(shouldAllowCameraDrag('equirectangular'), true);
  assert.equal(shouldAllowCameraDrag('flat'), false);
});

test('computes centered contained media rect for flat video overlays', () => {
  assert.deepEqual(
    getContainedMediaRect({
      containerWidth: 1000,
      containerHeight: 500,
      mediaWidth: 640,
      mediaHeight: 480,
    }),
    {
      x: 166.666667,
      y: 0,
      width: 666.666667,
      height: 500,
    },
  );

  assert.deepEqual(
    getContainedMediaRect({
      containerWidth: 500,
      containerHeight: 1000,
      mediaWidth: 1920,
      mediaHeight: 1080,
    }),
    {
      x: 0,
      y: 359.375,
      width: 500,
      height: 281.25,
    },
  );
});

test('computes left-eye texture transforms for stereo study videos', () => {
  assert.deepEqual(getStereoTextureTransform('mono'), {
    offsetX: 0,
    offsetY: 0,
    repeatX: 1,
    repeatY: 1,
  });

  assert.deepEqual(getStereoTextureTransform('top-bottom'), {
    offsetX: 0,
    offsetY: 0.5,
    repeatX: 1,
    repeatY: 0.5,
  });

  assert.deepEqual(getStereoTextureTransform('side-by-side'), {
    offsetX: 0,
    offsetY: 0,
    repeatX: 0.5,
    repeatY: 1,
  });
});

test('keeps stereo eye crop when rendering flat stereo sources', () => {
  assert.deepEqual(
    getProjectionTextureTransform({
      projection: 'flat',
      stereoLayout: 'top-bottom',
      eye: 'top-left',
    }),
    {
      offsetX: 0,
      offsetY: 0.5,
      repeatX: 0.5,
      repeatY: 0.5,
    },
  );
});

test('browser entrypoint cache-busts viewer projection modules', async () => {
  const indexSource = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const appSource = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  const controllerSource = await readFile(new URL('../src/app/appController.js', import.meta.url), 'utf8');

  assert.match(indexSource, /src="\.\/src\/app\.js\?v=nguyen-hue-updated-angle-1"/);
  assert.match(appSource, /'\.\/app\/appController\.js\?v=nguyen-hue-updated-angle-1'/);
  assert.match(controllerSource, /'\.\.\/aois\/aoiMath\.js\?v=aoi-active-window-1'/);
  assert.match(controllerSource, /'\.\.\/viewer\/projection\.js\?v=nguyen-hue-360-1'/);
  assert.match(controllerSource, /'\.\/studyVideos\.js\?v=nguyen-hue-updated-angle-1'/);
});

test('browser entrypoint lists finalized study videos', async () => {
  const indexSource = await readFile(new URL('../index.html', import.meta.url), 'utf8');

  [
    'culture-thap-ba-360',
    'culture-thap-ba-2d',
    'nature-tam-coc-360',
    'nature-tam-coc-2d',
    'nguyen-hue-360-0532',
    'nguyen-hue-2d-0532-updated-angle',
    'youtube-tcgwknsclhq-2d-0045-yaw-29p9-pitch-17p6',
  ].forEach((id) => {
    assert.match(indexSource, new RegExp(`<option value="${id}"`));
  });
  for (const selectId of ['studyVideoSelect', 'participantStudyVideoSelect']) {
    const selectSource = indexSource.match(
      new RegExp(`<select id="${selectId}">([\\s\\S]*?)<\\/select>`),
    )?.[1] || '';
    assert.notEqual(selectSource, '', `${selectId} should be present in the entrypoint.`);

    for (const match of selectSource.matchAll(/<option value="([^"]+)">/g)) {
      assert.ok(
        STUDY_VIDEOS.some((video) => video.id === match[1]),
        `${match[1]} should be defined in STUDY_VIDEOS before it is shown in ${selectId}.`,
      );
    }
  }
  assert.doesNotMatch(indexSource, /<option value="nguyen-hue-360-0500"/);
  assert.doesNotMatch(indexSource, /<option value="nguyen-hue-2d-0500"/);
  assert.doesNotMatch(indexSource, /<option value="nguyen-hue-2d-0532">/);
  assert.doesNotMatch(indexSource, /<option value="nguyen-hue-2d-0532-yaw-30p4-pitch-18p0"/);
  assert.doesNotMatch(indexSource, /<option value="youtube-tcgwknsclhq-360-0045"/);
});
