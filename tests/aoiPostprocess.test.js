import test from 'node:test';
import assert from 'node:assert/strict';

import {
  postprocessAoiProject,
  summarizeAoiProjectCleanup,
} from '../src/aois/aoiPostprocess.js';

function videoBoxAoi(id, label, boxes) {
  const keyframes = boxes.map(({ t, xMin, xMax, yMin, yMax }) => ({
    t,
    points: [
      { x: xMin, y: yMin },
      { x: xMax, y: yMin },
      { x: xMax, y: yMax },
      { x: xMin, y: yMax },
    ],
  }));

  return {
    id,
    label,
    color: '#f97316',
    shape: 'polygon',
    space: 'video',
    points: keyframes[0].points,
    keyframes,
  };
}

function baseProject(aois) {
  return {
    kind: 'eye-tracking-360-aoi-project',
    version: 1,
    video: { name: 'sample.mp4', projection: 'flat', stereoLayout: 'mono' },
    aois,
  };
}

test('merges duplicate same-label tracks when keyframes overlap in time and space', () => {
  const project = baseProject([
    videoBoxAoi('person-a', 'person', [
      { t: 0, xMin: 0.1, xMax: 0.3, yMin: 0.1, yMax: 0.4 },
      { t: 1, xMin: 0.12, xMax: 0.32, yMin: 0.1, yMax: 0.4 },
    ]),
    videoBoxAoi('person-b', 'person', [
      { t: 0, xMin: 0.11, xMax: 0.31, yMin: 0.12, yMax: 0.42 },
      { t: 2, xMin: 0.14, xMax: 0.34, yMin: 0.12, yMax: 0.42 },
    ]),
  ]);

  const cleaned = postprocessAoiProject(project, { minKeyframes: 1 });

  assert.equal(cleaned.aois.length, 1);
  assert.equal(cleaned.aois[0].label, 'person');
  assert.deepEqual(cleaned.aois[0].keyframes.map((keyframe) => keyframe.t), [0, 1, 2]);
  assert.equal(cleaned.stats.postprocess.mergedAois, 1);
});

test('keeps same-label tracks separate when boxes do not overlap', () => {
  const project = baseProject([
    videoBoxAoi('person-left', 'person', [
      { t: 0, xMin: 0.1, xMax: 0.2, yMin: 0.1, yMax: 0.3 },
      { t: 1, xMin: 0.1, xMax: 0.2, yMin: 0.1, yMax: 0.3 },
    ]),
    videoBoxAoi('person-right', 'person', [
      { t: 0, xMin: 0.7, xMax: 0.8, yMin: 0.1, yMax: 0.3 },
      { t: 1, xMin: 0.7, xMax: 0.8, yMin: 0.1, yMax: 0.3 },
    ]),
  ]);

  const cleaned = postprocessAoiProject(project, { minKeyframes: 1 });

  assert.equal(cleaned.aois.length, 2);
  assert.equal(cleaned.stats.postprocess.mergedAois, 0);
});

test('filters short-lived and tiny automatic regions before optional quality cap', () => {
  const project = baseProject([
    videoBoxAoi('auto-region-1-noise', 'auto-region-1', [
      { t: 0, xMin: 0.2, xMax: 0.21, yMin: 0.2, yMax: 0.21 },
    ]),
    videoBoxAoi('auto-region-2-keep', 'auto-region-2', [
      { t: 0, xMin: 0.3, xMax: 0.5, yMin: 0.3, yMax: 0.5 },
      { t: 1, xMin: 0.31, xMax: 0.51, yMin: 0.3, yMax: 0.5 },
      { t: 2, xMin: 0.32, xMax: 0.52, yMin: 0.3, yMax: 0.5 },
    ]),
    videoBoxAoi('bench-keep', 'bench', [
      { t: 0, xMin: 0.05, xMax: 0.25, yMin: 0.5, yMax: 0.7 },
    ]),
  ]);

  const cleaned = postprocessAoiProject(project, {
    autoRegionMinKeyframes: 3,
    minAverageArea: 0.001,
    minKeyframes: 1,
  });

  assert.deepEqual(cleaned.aois.map((aoi) => aoi.id), ['auto-region-2-keep', 'bench-keep']);
  assert.equal(cleaned.stats.postprocess.filteredAois, 1);
});

test('preserves string source metadata as a method during cleanup', () => {
  const project = {
    ...baseProject([
      videoBoxAoi('person-a', 'person', [
        { t: 0, xMin: 0.1, xMax: 0.3, yMin: 0.1, yMax: 0.4 },
      ]),
    ]),
    source: 'runpod-auto-aoi',
  };

  const cleaned = postprocessAoiProject(project, { minKeyframes: 1 });

  assert.deepEqual(cleaned.source, {
    method: 'runpod-auto-aoi',
    postprocess: 'aoiPostprocess',
  });
});

test('repairs indexed-character source metadata during cleanup', () => {
  const project = {
    ...baseProject([
      videoBoxAoi('person-a', 'person', [
        { t: 0, xMin: 0.1, xMax: 0.3, yMin: 0.1, yMax: 0.4 },
      ]),
    ]),
    source: {
      0: 'r',
      1: 'u',
      2: 'n',
      3: 'p',
      4: 'o',
      5: 'd',
      postprocess: 'aoiPostprocess',
    },
  };

  const cleaned = postprocessAoiProject(project, { minKeyframes: 1 });

  assert.deepEqual(cleaned.source, {
    method: 'runpod',
    postprocess: 'aoiPostprocess',
  });
});

test('summarizes cleanup counts for a project', () => {
  const cleaned = {
    aois: [{ id: 'a' }, { id: 'b' }],
    stats: { postprocess: { inputAois: 5, filteredAois: 2, mergedAois: 1 } },
  };

  assert.deepEqual(summarizeAoiProjectCleanup(cleaned), {
    inputAois: 5,
    outputAois: 2,
    filteredAois: 2,
    mergedAois: 1,
  });
});
