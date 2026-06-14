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

function baseProject(aois, videoOverrides = {}) {
  return {
    kind: 'eye-tracking-360-aoi-project',
    version: 1,
    video: {
      name: 'sample.mp4',
      projection: 'flat',
      stereoLayout: 'mono',
      ...videoOverrides,
    },
    aois,
  };
}

test('merges duplicate same-label tracks when 80 percent overlap is sustained for 80 percent of both tracks', () => {
  const project = baseProject([
    videoBoxAoi('person-a', 'person', [
      { t: 0, xMin: 0.1, xMax: 0.3, yMin: 0.1, yMax: 0.4 },
      { t: 1, xMin: 0.12, xMax: 0.32, yMin: 0.1, yMax: 0.4 },
      { t: 2, xMin: 0.14, xMax: 0.34, yMin: 0.1, yMax: 0.4 },
      { t: 3, xMin: 0.16, xMax: 0.36, yMin: 0.1, yMax: 0.4 },
      { t: 4, xMin: 0.18, xMax: 0.38, yMin: 0.1, yMax: 0.4 },
    ]),
    videoBoxAoi('person-b', 'person', [
      { t: 0, xMin: 0.11, xMax: 0.31, yMin: 0.12, yMax: 0.42 },
      { t: 1, xMin: 0.13, xMax: 0.33, yMin: 0.12, yMax: 0.42 },
      { t: 2, xMin: 0.15, xMax: 0.35, yMin: 0.12, yMax: 0.42 },
      { t: 3, xMin: 0.17, xMax: 0.37, yMin: 0.12, yMax: 0.42 },
      { t: 4, xMin: 0.72, xMax: 0.92, yMin: 0.12, yMax: 0.42 },
    ]),
  ]);

  const cleaned = postprocessAoiProject(project, { minKeyframes: 1 });

  assert.equal(cleaned.aois.length, 1);
  assert.equal(cleaned.aois[0].label, 'person');
  assert.deepEqual(cleaned.aois[0].keyframes.map((keyframe) => keyframe.t), [0, 1, 2, 3, 4]);
  assert.equal(cleaned.stats.postprocess.mergedAois, 1);
});

test('keeps same-label tracks when a short fragment overlaps less than 80 percent of the larger track time', () => {
  const project = baseProject([
    videoBoxAoi('building-long', 'building', [
      { t: 0, xMin: 0.1, xMax: 0.6, yMin: 0.1, yMax: 0.6 },
      { t: 1, xMin: 0.1, xMax: 0.6, yMin: 0.1, yMax: 0.6 },
      { t: 2, xMin: 0.1, xMax: 0.6, yMin: 0.1, yMax: 0.6 },
      { t: 3, xMin: 0.1, xMax: 0.6, yMin: 0.1, yMax: 0.6 },
      { t: 4, xMin: 0.1, xMax: 0.6, yMin: 0.1, yMax: 0.6 },
    ]),
    videoBoxAoi('building-short-fragment', 'building', [
      { t: 0, xMin: 0.18, xMax: 0.32, yMin: 0.18, yMax: 0.32 },
      { t: 1, xMin: 0.18, xMax: 0.32, yMin: 0.18, yMax: 0.32 },
      { t: 2, xMin: 0.18, xMax: 0.32, yMin: 0.18, yMax: 0.32 },
    ]),
  ], { width: 1000, height: 1000 });

  const cleaned = postprocessAoiProject(project, { minKeyframes: 1 });

  assert.deepEqual(cleaned.aois.map((aoi) => aoi.id), ['building-long', 'building-short-fragment']);
  assert.equal(cleaned.stats.postprocess.mergedAois, 0);
});

test('merges sub-50px same-label fragments into a larger containing AOI', () => {
  const project = baseProject([
    videoBoxAoi('sign-large', 'sign', [
      { t: 0, xMin: 0.1, xMax: 0.4, yMin: 0.1, yMax: 0.4 },
      { t: 1, xMin: 0.1, xMax: 0.4, yMin: 0.1, yMax: 0.4 },
      { t: 2, xMin: 0.1, xMax: 0.4, yMin: 0.1, yMax: 0.4 },
      { t: 3, xMin: 0.1, xMax: 0.4, yMin: 0.1, yMax: 0.4 },
      { t: 4, xMin: 0.1, xMax: 0.4, yMin: 0.1, yMax: 0.4 },
    ]),
    videoBoxAoi('sign-speck', 'sign', [
      { t: 0, xMin: 0.16, xMax: 0.19, yMin: 0.16, yMax: 0.19 },
      { t: 1, xMin: 0.16, xMax: 0.19, yMin: 0.16, yMax: 0.19 },
    ]),
  ], { width: 1000, height: 1000 });

  const cleaned = postprocessAoiProject(project, { minKeyframes: 1 });

  assert.deepEqual(cleaned.aois.map((aoi) => aoi.id), ['sign-large']);
  assert.equal(cleaned.stats.postprocess.mergedAois, 0);
  assert.equal(cleaned.stats.postprocess.smallMergedAois, 1);
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

test('keeps contained semantic scene-detail AOIs by default', () => {
  const project = baseProject([
    videoBoxAoi('planter-large', 'planter', [
      { t: 0, xMin: 0.2, xMax: 0.5, yMin: 0.3, yMax: 0.7 },
      { t: 1, xMin: 0.2, xMax: 0.5, yMin: 0.3, yMax: 0.7 },
    ]),
    videoBoxAoi('plant-inside', 'plant', [
      { t: 0, xMin: 0.28, xMax: 0.38, yMin: 0.38, yMax: 0.58 },
      { t: 1, xMin: 0.28, xMax: 0.38, yMin: 0.38, yMax: 0.58 },
    ]),
  ]);

  const cleaned = postprocessAoiProject(project, { minKeyframes: 1 });

  assert.deepEqual(cleaned.aois.map((aoi) => aoi.id), ['plant-inside', 'planter-large']);
  assert.equal(cleaned.stats.postprocess.suppressedAois, 0);
});

test('suppresses contained semantic scene-detail AOIs when enabled', () => {
  const project = baseProject([
    videoBoxAoi('planter-large', 'planter', [
      { t: 0, xMin: 0.2, xMax: 0.5, yMin: 0.3, yMax: 0.7 },
      { t: 1, xMin: 0.2, xMax: 0.5, yMin: 0.3, yMax: 0.7 },
    ]),
    videoBoxAoi('plant-inside', 'plant', [
      { t: 0, xMin: 0.28, xMax: 0.38, yMin: 0.38, yMax: 0.58 },
      { t: 1, xMin: 0.28, xMax: 0.38, yMin: 0.38, yMax: 0.58 },
    ]),
  ]);

  const cleaned = postprocessAoiProject(project, {
    minKeyframes: 1,
    suppressContainedSemanticAois: true,
  });

  assert.deepEqual(cleaned.aois.map((aoi) => aoi.id), ['planter-large']);
  assert.equal(cleaned.stats.postprocess.suppressedAois, 1);
});

test('keeps overlapping generic scene labels by default', () => {
  const project = baseProject([
    videoBoxAoi('tree-main', 'tree', [
      { t: 0, xMin: 0.2, xMax: 0.5, yMin: 0.1, yMax: 0.4 },
      { t: 1, xMin: 0.2, xMax: 0.5, yMin: 0.1, yMax: 0.4 },
    ]),
    videoBoxAoi('plant-duplicate', 'plant', [
      { t: 0, xMin: 0.205, xMax: 0.495, yMin: 0.105, yMax: 0.395 },
      { t: 1, xMin: 0.205, xMax: 0.495, yMin: 0.105, yMax: 0.395 },
    ]),
    videoBoxAoi('riverbank-main', 'shoreline riverbank', [
      { t: 0, xMin: 0.1, xMax: 0.3, yMin: 0.7, yMax: 0.85 },
      { t: 1, xMin: 0.1, xMax: 0.3, yMin: 0.7, yMax: 0.85 },
    ]),
    videoBoxAoi('shoreline-duplicate', 'shoreline', [
      { t: 0, xMin: 0.105, xMax: 0.295, yMin: 0.705, yMax: 0.845 },
      { t: 1, xMin: 0.105, xMax: 0.295, yMin: 0.705, yMax: 0.845 },
    ]),
  ]);

  const cleaned = postprocessAoiProject(project, { minKeyframes: 1 });

  assert.deepEqual(cleaned.aois.map((aoi) => aoi.id), [
    'plant-duplicate',
    'shoreline-duplicate',
    'riverbank-main',
    'tree-main',
  ]);
  assert.equal(cleaned.stats.postprocess.suppressedAois, 0);
});

test('suppresses overlapping generic scene labels when enabled', () => {
  const project = baseProject([
    videoBoxAoi('tree-main', 'tree', [
      { t: 0, xMin: 0.2, xMax: 0.5, yMin: 0.1, yMax: 0.4 },
      { t: 1, xMin: 0.2, xMax: 0.5, yMin: 0.1, yMax: 0.4 },
    ]),
    videoBoxAoi('plant-duplicate', 'plant', [
      { t: 0, xMin: 0.205, xMax: 0.495, yMin: 0.105, yMax: 0.395 },
      { t: 1, xMin: 0.205, xMax: 0.495, yMin: 0.105, yMax: 0.395 },
    ]),
    videoBoxAoi('riverbank-main', 'shoreline riverbank', [
      { t: 0, xMin: 0.1, xMax: 0.3, yMin: 0.7, yMax: 0.85 },
      { t: 1, xMin: 0.1, xMax: 0.3, yMin: 0.7, yMax: 0.85 },
    ]),
    videoBoxAoi('shoreline-duplicate', 'shoreline', [
      { t: 0, xMin: 0.105, xMax: 0.295, yMin: 0.705, yMax: 0.845 },
      { t: 1, xMin: 0.105, xMax: 0.295, yMin: 0.705, yMax: 0.845 },
    ]),
  ]);

  const cleaned = postprocessAoiProject(project, {
    minKeyframes: 1,
    suppressContainedSemanticAois: true,
  });

  assert.deepEqual(cleaned.aois.map((aoi) => aoi.id), ['riverbank-main', 'tree-main']);
  assert.equal(cleaned.stats.postprocess.suppressedAois, 2);
});

test('keeps semantic overlap when it is not sustained across enough timestamps', () => {
  const project = baseProject([
    videoBoxAoi('tree-main', 'tree', [
      { t: 0, xMin: 0.2, xMax: 0.5, yMin: 0.1, yMax: 0.4 },
      { t: 1, xMin: 0.2, xMax: 0.5, yMin: 0.1, yMax: 0.4 },
      { t: 2, xMin: 0.2, xMax: 0.5, yMin: 0.1, yMax: 0.4 },
      { t: 3, xMin: 0.2, xMax: 0.5, yMin: 0.1, yMax: 0.4 },
      { t: 4, xMin: 0.2, xMax: 0.5, yMin: 0.1, yMax: 0.4 },
    ]),
    videoBoxAoi('plant-brief-overlap', 'plant', [
      { t: 0, xMin: 0.205, xMax: 0.495, yMin: 0.105, yMax: 0.395 },
      { t: 1, xMin: 0.205, xMax: 0.495, yMin: 0.105, yMax: 0.395 },
      { t: 2, xMin: 0.205, xMax: 0.495, yMin: 0.105, yMax: 0.395 },
      { t: 3, xMin: 0.6, xMax: 0.8, yMin: 0.1, yMax: 0.3 },
      { t: 4, xMin: 0.6, xMax: 0.8, yMin: 0.1, yMax: 0.3 },
    ]),
  ]);

  const cleaned = postprocessAoiProject(project, { minKeyframes: 1 });

  assert.deepEqual(cleaned.aois.map((aoi) => aoi.id), ['plant-brief-overlap', 'tree-main']);
  assert.equal(cleaned.stats.postprocess.suppressedAois, 0);
});

test('merges same-label object tracks when one duplicate is mostly contained', () => {
  const project = baseProject([
    videoBoxAoi('person-large', 'person', [
      { t: 0, xMin: 0.1, xMax: 0.6, yMin: 0.1, yMax: 0.6 },
      { t: 1, xMin: 0.1, xMax: 0.6, yMin: 0.1, yMax: 0.6 },
    ]),
    videoBoxAoi('person-small-duplicate', 'person', [
      { t: 0, xMin: 0.18, xMax: 0.28, yMin: 0.18, yMax: 0.28 },
      { t: 1, xMin: 0.18, xMax: 0.28, yMin: 0.18, yMax: 0.28 },
    ]),
  ]);

  const cleaned = postprocessAoiProject(project, { minKeyframes: 1 });

  assert.equal(cleaned.aois.length, 1);
  assert.equal(cleaned.aois[0].label, 'person');
  assert.equal(cleaned.stats.postprocess.mergedAois, 1);
});

test('keeps contained same-label scene tracks when overlap is not sustained across 80 percent of both tracks', () => {
  const project = baseProject([
    videoBoxAoi('tree-canopy-large', 'tree', [
      { t: 0, xMin: 0.1, xMax: 0.6, yMin: 0.1, yMax: 0.6 },
      { t: 1, xMin: 0.1, xMax: 0.6, yMin: 0.1, yMax: 0.6 },
      { t: 2, xMin: 0.1, xMax: 0.6, yMin: 0.1, yMax: 0.6 },
      { t: 3, xMin: 0.1, xMax: 0.6, yMin: 0.1, yMax: 0.6 },
      { t: 4, xMin: 0.1, xMax: 0.6, yMin: 0.1, yMax: 0.6 },
    ]),
    videoBoxAoi('tree-canopy-detail', 'tree', [
      { t: 0, xMin: 0.18, xMax: 0.28, yMin: 0.18, yMax: 0.28 },
      { t: 1, xMin: 0.18, xMax: 0.28, yMin: 0.18, yMax: 0.28 },
      { t: 2, xMin: 0.18, xMax: 0.28, yMin: 0.18, yMax: 0.28 },
    ]),
  ], { width: 1000, height: 1000 });

  const cleaned = postprocessAoiProject(project, { minKeyframes: 1 });

  assert.deepEqual(cleaned.aois.map((aoi) => aoi.id), ['tree-canopy-detail', 'tree-canopy-large']);
  assert.equal(cleaned.stats.postprocess.mergedAois, 0);
});

test('keeps same-label tracks when high overlap is not sustained across enough timestamps', () => {
  const project = baseProject([
    videoBoxAoi('cliff-main', 'cliff', [
      { t: 0, xMin: 0, xMax: 0.6, yMin: 0, yMax: 0.3 },
      { t: 1, xMin: 0, xMax: 0.6, yMin: 0, yMax: 0.3 },
      { t: 2, xMin: 0, xMax: 0.6, yMin: 0, yMax: 0.3 },
      { t: 3, xMin: 0, xMax: 0.6, yMin: 0, yMax: 0.3 },
      { t: 4, xMin: 0, xMax: 0.6, yMin: 0, yMax: 0.3 },
    ]),
    videoBoxAoi('cliff-brief-overlap', 'cliff', [
      { t: 0, xMin: 0.15, xMax: 0.45, yMin: 0, yMax: 0.3 },
      { t: 1, xMin: 0.15, xMax: 0.45, yMin: 0, yMax: 0.3 },
      { t: 2, xMin: 0.15, xMax: 0.45, yMin: 0, yMax: 0.3 },
      { t: 3, xMin: 0.65, xMax: 0.95, yMin: 0, yMax: 0.3 },
      { t: 4, xMin: 0.65, xMax: 0.95, yMin: 0, yMax: 0.3 },
    ]),
  ]);

  const cleaned = postprocessAoiProject(project, { minKeyframes: 1 });

  assert.equal(cleaned.aois.length, 2);
  assert.equal(cleaned.stats.postprocess.mergedAois, 0);
});

test('merges same-label scene tracks when most of the smaller duplicate overlaps', () => {
  const project = baseProject([
    videoBoxAoi('cliff-left', 'cliff', [
      { t: 0, xMin: 0, xMax: 0.6, yMin: 0, yMax: 0.3 },
      { t: 1, xMin: 0, xMax: 0.6, yMin: 0, yMax: 0.3 },
    ]),
    videoBoxAoi('cliff-overlap', 'cliff', [
      { t: 0, xMin: 0.15, xMax: 0.45, yMin: 0, yMax: 0.35 },
      { t: 1, xMin: 0.15, xMax: 0.45, yMin: 0, yMax: 0.35 },
    ]),
  ]);

  const cleaned = postprocessAoiProject(project, { minKeyframes: 1 });

  assert.equal(cleaned.aois.length, 1);
  assert.equal(cleaned.aois[0].label, 'cliff');
  assert.equal(cleaned.stats.postprocess.mergedAois, 1);
});

test('keeps wearable part AOIs contained inside person AOIs by default', () => {
  const project = baseProject([
    videoBoxAoi('person-main', 'person', [
      { t: 0, xMin: 0.2, xMax: 0.4, yMin: 0.2, yMax: 0.8 },
      { t: 1, xMin: 0.2, xMax: 0.4, yMin: 0.2, yMax: 0.8 },
    ]),
    videoBoxAoi('costume-inside', 'costume', [
      { t: 0, xMin: 0.22, xMax: 0.38, yMin: 0.35, yMax: 0.75 },
      { t: 1, xMin: 0.22, xMax: 0.38, yMin: 0.35, yMax: 0.75 },
    ]),
    videoBoxAoi('dress-inside', 'dress', [
      { t: 0, xMin: 0.23, xMax: 0.37, yMin: 0.38, yMax: 0.74 },
      { t: 1, xMin: 0.23, xMax: 0.37, yMin: 0.38, yMax: 0.74 },
    ]),
  ]);

  const cleaned = postprocessAoiProject(project, { minKeyframes: 1 });

  assert.deepEqual(cleaned.aois.map((aoi) => aoi.id), ['costume-inside', 'dress-inside', 'person-main']);
  assert.equal(cleaned.stats.postprocess.suppressedAois, 0);
});

test('suppresses wearable part AOIs contained inside person AOIs when enabled', () => {
  const project = baseProject([
    videoBoxAoi('person-main', 'person', [
      { t: 0, xMin: 0.2, xMax: 0.4, yMin: 0.2, yMax: 0.8 },
      { t: 1, xMin: 0.2, xMax: 0.4, yMin: 0.2, yMax: 0.8 },
    ]),
    videoBoxAoi('costume-inside', 'costume', [
      { t: 0, xMin: 0.22, xMax: 0.38, yMin: 0.35, yMax: 0.75 },
      { t: 1, xMin: 0.22, xMax: 0.38, yMin: 0.35, yMax: 0.75 },
    ]),
    videoBoxAoi('dress-inside', 'dress', [
      { t: 0, xMin: 0.23, xMax: 0.37, yMin: 0.38, yMax: 0.74 },
      { t: 1, xMin: 0.23, xMax: 0.37, yMin: 0.38, yMax: 0.74 },
    ]),
  ]);

  const cleaned = postprocessAoiProject(project, {
    minKeyframes: 1,
    suppressContainedSemanticAois: true,
  });

  assert.deepEqual(cleaned.aois.map((aoi) => aoi.id), ['person-main']);
  assert.equal(cleaned.stats.postprocess.suppressedAois, 2);
});

test('merges duplicate label-family tracks without merging separate people', () => {
  const project = baseProject([
    videoBoxAoi('motorbike-a', 'motorbike', [
      { t: 0, xMin: 0.1, xMax: 0.3, yMin: 0.5, yMax: 0.8 },
      { t: 1, xMin: 0.11, xMax: 0.31, yMin: 0.5, yMax: 0.8 },
    ]),
    videoBoxAoi('motorcycle-b', 'motorcycle', [
      { t: 0, xMin: 0.11, xMax: 0.31, yMin: 0.51, yMax: 0.81 },
      { t: 1, xMin: 0.12, xMax: 0.32, yMin: 0.51, yMax: 0.81 },
    ]),
    videoBoxAoi('person-left', 'person', [
      { t: 0, xMin: 0.55, xMax: 0.65, yMin: 0.3, yMax: 0.7 },
      { t: 1, xMin: 0.55, xMax: 0.65, yMin: 0.3, yMax: 0.7 },
    ]),
    videoBoxAoi('person-right', 'person', [
      { t: 0, xMin: 0.68, xMax: 0.78, yMin: 0.3, yMax: 0.7 },
      { t: 1, xMin: 0.68, xMax: 0.78, yMin: 0.3, yMax: 0.7 },
    ]),
  ]);

  const cleaned = postprocessAoiProject(project, { minKeyframes: 1 });

  assert.deepEqual(cleaned.aois.map((aoi) => aoi.label), ['motorcycle', 'person', 'person']);
  assert.equal(cleaned.stats.postprocess.mergedAois, 1);
  assert.equal(cleaned.aois.filter((aoi) => aoi.label === 'person').length, 2);
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

test('does not cap AOIs by default', () => {
  const manyDistinctAois = Array.from({ length: 85 }, (_, index) => (
    videoBoxAoi(`object-${index}`, `object ${index}`, [
      { t: 0, xMin: 0.1, xMax: 0.3, yMin: 0.1, yMax: 0.3 },
      { t: 1, xMin: 0.1, xMax: 0.3, yMin: 0.1, yMax: 0.3 },
    ])
  ));

  const cleaned = postprocessAoiProject(baseProject(manyDistinctAois));

  assert.equal(cleaned.aois.length, 85);
  assert.equal(cleaned.stats.postprocess.cappedAois, 0);
  assert.equal(cleaned.stats.postprocess.options.maxAois, null);
});

test('filters generated scene background masks while preserving manual labels', () => {
  const generatedRoad = {
    ...videoBoxAoi('road-auto', 'road', [
      { t: 0, xMin: 0, xMax: 1, yMin: 0.7, yMax: 1 },
      { t: 1, xMin: 0, xMax: 1, yMin: 0.7, yMax: 1 },
    ]),
    metadata: { generatedBy: 'runpod-auto-aoi' },
  };
  const generatedSky = {
    ...videoBoxAoi('sky-auto', 'sky', [
      { t: 0, xMin: 0, xMax: 1, yMin: 0, yMax: 0.4 },
      { t: 1, xMin: 0, xMax: 1, yMin: 0, yMax: 0.4 },
    ]),
    metadata: { generatedBy: 'runpod-auto-aoi' },
  };
  const manualRoad = videoBoxAoi('road-manual', 'road', [
    { t: 0, xMin: 0.1, xMax: 0.3, yMin: 0.8, yMax: 0.95 },
    { t: 1, xMin: 0.1, xMax: 0.3, yMin: 0.8, yMax: 0.95 },
  ]);

  const cleaned = postprocessAoiProject(
    baseProject([generatedRoad, generatedSky, manualRoad]),
    { minKeyframes: 1 },
  );

  assert.deepEqual(cleaned.aois.map((aoi) => aoi.id), ['road-manual']);
  assert.equal(cleaned.stats.postprocess.filteredAois, 2);
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
    smallMergedAois: 0,
  });
});
