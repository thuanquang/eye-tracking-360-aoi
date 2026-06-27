import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildMergedHeatmapExport,
  getHeatmapCompatibilityKey,
  getHeatmapVideoKey,
  mergeCompatibleHeatmaps,
} from '../src/recording/heatmapMerge.js';

function hasOwn(value, property) {
  return Object.prototype.hasOwnProperty.call(value, property);
}

function screenHeatmap({
  width = 100,
  height = 80,
  bins = [{ column: 0, row: 0, weightSec: 0.1, sampleCount: 1 }],
} = {}) {
  return {
    type: 'screen',
    columns: 2,
    rows: 2,
    width,
    height,
    dimensionSource: 'provided',
    trustedOnly: true,
    totalWeightSec: bins.reduce((sum, bin) => sum + bin.weightSec, 0),
    bins,
  };
}

function panoramaHeatmap({
  columns = 4,
  rows = 2,
  bins = [{ column: 0, row: 0, weightSec: 0.2, sampleCount: 1 }],
} = {}) {
  return {
    type: 'panorama',
    columns,
    rows,
    yawRange: [-180, 180],
    pitchRange: [-90, 90],
    trustedOnly: true,
    totalWeightSec: bins.reduce((sum, bin) => sum + bin.weightSec, 0),
    bins,
  };
}

function payload(options = {}) {
  const {
    exportedAt = '2026-06-01T00:00:00.000Z',
    participantId,
    project,
    heatmaps,
  } = options;
  const participant = hasOwn(options, 'participant')
    ? options.participant
    : { id: 'P1' };
  const video = hasOwn(options, 'video')
    ? options.video
    : { name: 'Clip A.mp4', src: 'assets/clips/a.mp4' };
  const result = {
    exportedAt,
    summary: { heatmaps },
  };

  if (participant !== undefined) {
    result.participant = participant;
  }

  if (video !== undefined) {
    result.video = video;
  }

  if (participantId !== undefined) {
    result.participantId = participantId;
  }

  if (project !== undefined) {
    result.project = project;
  }

  return result;
}

test('merges compatible screen heatmaps by row and column', () => {
  const merged = mergeCompatibleHeatmaps([
    {
      type: 'screen',
      columns: 2,
      rows: 2,
      width: 100,
      height: 80,
      dimensionSource: 'provided',
      trustedOnly: true,
      totalWeightSec: 0.3,
      bins: [
        { column: 1, row: 0, weightSec: 0.2, sampleCount: 1 },
        { column: 0, row: 0, weightSec: 0.1, sampleCount: 1 },
      ],
    },
    {
      type: 'screen',
      columns: 2,
      rows: 2,
      width: 100,
      height: 80,
      dimensionSource: 'provided',
      trustedOnly: true,
      totalWeightSec: 0.6,
      bins: [
        { column: 0, row: 0, weightSec: 0.2, sampleCount: 2 },
        { column: 1, row: 1, weightSec: 0.3, sampleCount: 3 },
        { column: 1, row: 0, weightSec: 0.1, sampleCount: 1 },
        { column: Number.NaN, row: 0, weightSec: 1, sampleCount: 10 },
      ],
    },
  ]);

  assert.deepEqual(merged, {
    type: 'screen',
    columns: 2,
    rows: 2,
    width: 100,
    height: 80,
    dimensionSource: 'provided',
    trustedOnly: true,
    sourceHeatmapCount: 2,
    totalWeightSec: 0.9,
    bins: [
      { column: 0, row: 0, weightSec: 0.3, sampleCount: 3 },
      { column: 1, row: 0, weightSec: 0.3, sampleCount: 2 },
      { column: 1, row: 1, weightSec: 0.3, sampleCount: 3 },
    ],
  });
});

test('ignores out-of-grid and fractional heatmap bins', () => {
  const merged = mergeCompatibleHeatmaps([
    {
      type: 'screen',
      columns: 2,
      rows: 2,
      width: 100,
      height: 80,
      bins: [
        { column: 0, row: 0, weightSec: 0.1, sampleCount: 1 },
        { column: -1, row: 0, weightSec: 1, sampleCount: 10 },
        { column: 0, row: -1, weightSec: 1, sampleCount: 10 },
        { column: 2, row: 0, weightSec: 1, sampleCount: 10 },
        { column: 1, row: 2, weightSec: 1, sampleCount: 10 },
        { column: 0.5, row: 0, weightSec: 1, sampleCount: 10 },
        { column: 1, row: 0.5, weightSec: 1, sampleCount: 10 },
      ],
    },
  ]);

  assert.deepEqual(merged.bins, [
    { column: 0, row: 0, weightSec: 0.1, sampleCount: 1 },
  ]);
  assert.equal(merged.totalWeightSec, 0.1);
});

test('merges panorama heatmaps and preserves angular ranges', () => {
  const yawRange = [-180, 180];
  const pitchRange = [-90, 90];
  const merged = mergeCompatibleHeatmaps([
    {
      type: 'panorama',
      columns: 4,
      rows: 2,
      yawRange,
      pitchRange,
      trustedOnly: false,
      totalWeightSec: 0.2,
      bins: [
        { column: 0, row: 0, weightSec: 0.125, sampleCount: 1 },
      ],
    },
    {
      type: 'panorama',
      columns: 4,
      rows: 2,
      yawRange: [-180, 180],
      pitchRange: [-90, 90],
      trustedOnly: false,
      totalWeightSec: 0.4,
      bins: [
        { column: 0, row: 0, weightSec: 0.125, sampleCount: 2 },
        { column: 3, row: 1, weightSec: 0.25, sampleCount: 1 },
      ],
    },
  ]);

  assert.deepEqual(merged, {
    type: 'panorama',
    columns: 4,
    rows: 2,
    yawRange: [-180, 180],
    pitchRange: [-90, 90],
    trustedOnly: false,
    sourceHeatmapCount: 2,
    totalWeightSec: 0.5,
    bins: [
      { column: 0, row: 0, weightSec: 0.25, sampleCount: 3 },
      { column: 3, row: 1, weightSec: 0.25, sampleCount: 1 },
    ],
  });

  assert.notEqual(merged.yawRange, yawRange);
  assert.notEqual(merged.pitchRange, pitchRange);
});

test('throws when heatmap grids are incompatible', () => {
  assert.throws(() => mergeCompatibleHeatmaps([
    {
      type: 'screen',
      columns: 2,
      rows: 2,
      width: 100,
      height: 80,
      bins: [],
    },
    {
      type: 'screen',
      columns: 2,
      rows: 2,
      width: 120,
      height: 80,
      bins: [],
    },
  ]), /Incompatible heatmap grids/);
});

test('includes expected and actual compatibility keys in incompatible grid errors', () => {
  assert.throws(() => mergeCompatibleHeatmaps([
    {
      type: 'screen',
      columns: 2,
      rows: 2,
      width: 100,
      height: 80,
      bins: [],
    },
    {
      type: 'screen',
      columns: 2,
      rows: 2,
      width: 120,
      height: 80,
      bins: [],
    },
  ]), (error) => {
    assert.match(error.message, /Incompatible heatmap grids/);
    assert.match(error.message, /expected screen\|2x2\|100x80/);
    assert.match(error.message, /actual screen\|2x2\|120x80/);
    return true;
  });
});

test('throws when no heatmaps are provided', () => {
  assert.throws(
    () => mergeCompatibleHeatmaps([]),
    /No heatmaps to merge\./,
  );
});

test('groups selected heatmap exports by video and merges compatible top-level and variant heatmaps', () => {
  const firstHeatmaps = {
    screen: screenHeatmap({
      bins: [{ column: 0, row: 0, weightSec: 0.1, sampleCount: 1 }],
    }),
    panorama: panoramaHeatmap({
      bins: [{ column: 0, row: 0, weightSec: 0.2, sampleCount: 2 }],
    }),
    variants: {
      trusted: {
        screen: screenHeatmap({
          bins: [{ column: 1, row: 0, weightSec: 0.3, sampleCount: 3 }],
        }),
        panorama: panoramaHeatmap({
          bins: [{ column: 1, row: 0, weightSec: 0.4, sampleCount: 4 }],
        }),
      },
      likely: {
        screen: screenHeatmap({
          bins: [{ column: 0, row: 1, weightSec: 0.5, sampleCount: 5 }],
        }),
      },
      possible: {
        panorama: panoramaHeatmap({
          bins: [{ column: 2, row: 1, weightSec: 0.6, sampleCount: 6 }],
        }),
      },
    },
  };
  const secondHeatmaps = {
    screen: screenHeatmap({
      bins: [{ column: 0, row: 0, weightSec: 0.2, sampleCount: 2 }],
    }),
    panorama: panoramaHeatmap({
      bins: [{ column: 3, row: 1, weightSec: 0.1, sampleCount: 1 }],
    }),
    variants: {
      trusted: {
        screen: screenHeatmap({
          bins: [{ column: 1, row: 0, weightSec: 0.2, sampleCount: 2 }],
        }),
        panorama: panoramaHeatmap({
          bins: [{ column: 1, row: 0, weightSec: 0.1, sampleCount: 1 }],
        }),
      },
      likely: {
        screen: screenHeatmap({
          bins: [{ column: 0, row: 1, weightSec: 0.1, sampleCount: 1 }],
        }),
      },
      possible: {
        panorama: panoramaHeatmap({
          bins: [{ column: 2, row: 1, weightSec: 0.2, sampleCount: 2 }],
        }),
      },
    },
  };

  const mergedExport = buildMergedHeatmapExport([
    {
      fileName: 'p1-heatmaps.json',
      payload: payload({
        exportedAt: '2026-06-01T00:00:00.000Z',
        participant: { id: 'P1' },
        heatmaps: firstHeatmaps,
      }),
    },
    {
      fileName: 'p2-heatmaps.json',
      payload: payload({
        exportedAt: '2026-06-02T00:00:00.000Z',
        participant: { participantId: 'P2' },
        heatmaps: secondHeatmaps,
      }),
    },
  ], { exportedAt: '2026-06-27T12:00:00.000Z' });

  assert.equal(mergedExport.kind, 'merged-heatmaps');
  assert.equal(mergedExport.version, 1);
  assert.equal(mergedExport.exportedAt, '2026-06-27T12:00:00.000Z');
  assert.equal(mergedExport.sourceFileCount, 2);
  assert.equal(mergedExport.groupCount, 1);
  assert.deepEqual(mergedExport.skipped, []);

  const [group] = mergedExport.groups;
  assert.equal(group.groupKey, 'clip-a-mp4|assets-clips-a-mp4');
  assert.deepEqual(group.video, { name: 'Clip A.mp4', src: 'assets/clips/a.mp4' });
  assert.equal(group.sourceCount, 2);
  assert.deepEqual(group.sources, [
    {
      fileName: 'p1-heatmaps.json',
      exportedAt: '2026-06-01T00:00:00.000Z',
      participantId: 'P1',
    },
    {
      fileName: 'p2-heatmaps.json',
      exportedAt: '2026-06-02T00:00:00.000Z',
      participantId: 'P2',
    },
  ]);
  assert.deepEqual(group.summary.heatmaps.screen.bins, [
    { column: 0, row: 0, weightSec: 0.3, sampleCount: 3 },
  ]);
  assert.equal(group.summary.heatmaps.screen.sourceHeatmapCount, 2);
  assert.deepEqual(group.summary.heatmaps.panorama.bins, [
    { column: 0, row: 0, weightSec: 0.2, sampleCount: 2 },
    { column: 3, row: 1, weightSec: 0.1, sampleCount: 1 },
  ]);
  assert.deepEqual(group.summary.heatmaps.variants.trusted.screen.bins, [
    { column: 1, row: 0, weightSec: 0.5, sampleCount: 5 },
  ]);
  assert.deepEqual(group.summary.heatmaps.variants.trusted.panorama.bins, [
    { column: 1, row: 0, weightSec: 0.5, sampleCount: 5 },
  ]);
  assert.deepEqual(group.summary.heatmaps.variants.likely, {
    screen: {
      ...firstHeatmaps.variants.likely.screen,
      sourceHeatmapCount: 2,
      totalWeightSec: 0.6,
      bins: [{ column: 0, row: 1, weightSec: 0.6, sampleCount: 6 }],
    },
  });
  assert.deepEqual(group.summary.heatmaps.variants.possible.panorama.bins, [
    { column: 2, row: 1, weightSec: 0.8, sampleCount: 8 },
  ]);
});

test('keeps different videos in separate merged heatmap groups', () => {
  const mergedExport = buildMergedHeatmapExport([
    {
      fileName: 'clip-a.json',
      payload: payload({ heatmaps: { screen: screenHeatmap() } }),
    },
    {
      fileName: 'clip-b.json',
      payload: payload({
        video: { name: 'Clip B.mp4', src: 'assets/clips/b.mp4' },
        participantId: 'top-level-p2',
        participant: undefined,
        heatmaps: { screen: screenHeatmap() },
      }),
    },
  ], { exportedAt: '2026-06-27T12:00:00.000Z' });

  assert.equal(mergedExport.groupCount, 2);
  assert.deepEqual(
    mergedExport.groups.map((group) => group.groupKey),
    [
      'clip-a-mp4|assets-clips-a-mp4',
      'clip-b-mp4|assets-clips-b-mp4',
    ],
  );
  assert.equal(mergedExport.groups[1].sources[0].participantId, 'top-level-p2');
});

test('skips files with missing heatmaps and reports why', () => {
  const mergedExport = buildMergedHeatmapExport([
    {
      fileName: 'good.json',
      payload: payload({ heatmaps: { screen: screenHeatmap() } }),
    },
    {
      fileName: 'bad.json',
      payload: { exportedAt: '2026-06-02T00:00:00.000Z', summary: {} },
    },
  ], { exportedAt: '2026-06-27T12:00:00.000Z' });

  assert.equal(mergedExport.sourceFileCount, 2);
  assert.equal(mergedExport.groupCount, 1);
  assert.deepEqual(mergedExport.skipped, [
    { fileName: 'bad.json', reason: 'missing-summary-heatmaps' },
  ]);
});

test('builds stable video keys from metadata', () => {
  assert.equal(
    getHeatmapVideoKey({ video: { name: 'Clip A.mp4', src: 'assets/clips/a.mp4' } }),
    'clip-a-mp4|assets-clips-a-mp4',
  );
});

test('falls back to project video metadata when top-level video is absent', () => {
  const projectVideo = { name: 'Project Clip.mov', src: 'project/clips/main.mov' };
  const mergedExport = buildMergedHeatmapExport([
    {
      fileName: 'project-video.json',
      payload: payload({
        video: undefined,
        project: { video: projectVideo },
        heatmaps: { panorama: panoramaHeatmap() },
      }),
    },
  ], { exportedAt: '2026-06-27T12:00:00.000Z' });

  assert.equal(
    getHeatmapVideoKey({ project: { video: projectVideo } }),
    'project-clip-mov|project-clips-main-mov',
  );
  assert.equal(mergedExport.groups[0].groupKey, 'project-clip-mov|project-clips-main-mov');
  assert.deepEqual(mergedExport.groups[0].video, projectVideo);
});

test('reports incompatible heatmap paths without throwing and keeps compatible paths', () => {
  const mergedExport = buildMergedHeatmapExport([
    {
      fileName: 'p1.json',
      payload: payload({
        participant: { id: 'P1' },
        heatmaps: {
          screen: screenHeatmap({ width: 100 }),
          panorama: panoramaHeatmap({
            bins: [{ column: 0, row: 0, weightSec: 0.1, sampleCount: 1 }],
          }),
          variants: {
            trusted: {
              screen: screenHeatmap({
                bins: [{ column: 0, row: 0, weightSec: 0.2, sampleCount: 2 }],
              }),
              panorama: panoramaHeatmap({ columns: 4 }),
            },
            likely: {
              screen: screenHeatmap({
                bins: [{ column: 1, row: 1, weightSec: 0.3, sampleCount: 3 }],
              }),
            },
          },
        },
      }),
    },
    {
      fileName: 'p2.json',
      payload: payload({
        participant: { id: 'P2' },
        heatmaps: {
          screen: screenHeatmap({ width: 120 }),
          panorama: panoramaHeatmap({
            bins: [{ column: 1, row: 0, weightSec: 0.1, sampleCount: 1 }],
          }),
          variants: {
            trusted: {
              screen: screenHeatmap({
                bins: [{ column: 0, row: 0, weightSec: 0.1, sampleCount: 1 }],
              }),
              panorama: panoramaHeatmap({ columns: 8 }),
            },
            likely: {
              screen: screenHeatmap({
                bins: [{ column: 1, row: 1, weightSec: 0.1, sampleCount: 1 }],
              }),
            },
          },
        },
      }),
    },
  ], { exportedAt: '2026-06-27T12:00:00.000Z' });

  const [group] = mergedExport.groups;
  assert.equal(group.summary.heatmaps.screen, undefined);
  assert.deepEqual(group.summary.heatmaps.panorama.bins, [
    { column: 0, row: 0, weightSec: 0.1, sampleCount: 1 },
    { column: 1, row: 0, weightSec: 0.1, sampleCount: 1 },
  ]);
  assert.deepEqual(group.summary.heatmaps.variants.trusted.screen.bins, [
    { column: 0, row: 0, weightSec: 0.3, sampleCount: 3 },
  ]);
  assert.equal(group.summary.heatmaps.variants.trusted.panorama, undefined);
  assert.deepEqual(group.summary.heatmaps.variants.likely.screen.bins, [
    { column: 1, row: 1, weightSec: 0.4, sampleCount: 4 },
  ]);

  assert.equal(mergedExport.skipped.length, 2);
  assert.deepEqual(
    mergedExport.skipped.map(({ reason, groupKey, heatmapPath }) => ({
      reason,
      groupKey,
      heatmapPath,
    })),
    [
      {
        reason: 'incompatible-heatmap-grid',
        groupKey: 'clip-a-mp4|assets-clips-a-mp4',
        heatmapPath: 'screen',
      },
      {
        reason: 'incompatible-heatmap-grid',
        groupKey: 'clip-a-mp4|assets-clips-a-mp4',
        heatmapPath: 'variants.trusted.panorama',
      },
    ],
  );
  assert.match(mergedExport.skipped[0].message, /Incompatible heatmap grids/);
  assert.match(mergedExport.skipped[1].message, /Incompatible heatmap grids/);
});

test('throws a clear error for null heatmaps', () => {
  assert.throws(
    () => mergeCompatibleHeatmaps([null]),
    /Invalid heatmap at index 0/,
  );
});

test('throws a clear error for missing grid metadata before reading bins', () => {
  const missingHeight = {
    type: 'screen',
    columns: 2,
    rows: 2,
    width: 100,
    get bins() {
      throw new Error('bins should not be read');
    },
  };

  assert.throws(
    () => mergeCompatibleHeatmaps([missingHeight]),
    /Invalid heatmap at index 0/,
  );
});

test('rounds total weight from raw merged bin weights', () => {
  const merged = mergeCompatibleHeatmaps([
    {
      type: 'panorama',
      columns: 2,
      rows: 1,
      yawRange: [-180, 180],
      pitchRange: [-90, 90],
      bins: [
        { column: 0, row: 0, weightSec: 0.1114, sampleCount: 1 },
        { column: 1, row: 0, weightSec: 0.1114, sampleCount: 1 },
      ],
    },
  ]);

  assert.deepEqual(
    merged.bins.map((bin) => bin.weightSec),
    [0.111, 0.111],
  );
  assert.equal(merged.totalWeightSec, 0.223);
});

test('returns stable heatmap compatibility keys', () => {
  assert.equal(
    getHeatmapCompatibilityKey({
      type: 'screen',
      columns: 48,
      rows: 27,
      width: 1280,
      height: 720,
    }),
    'screen|48x27|1280x720',
  );

  assert.equal(
    getHeatmapCompatibilityKey({
      type: 'panorama',
      columns: 72,
      rows: 36,
      yawRange: [-180, 180],
      pitchRange: [-90, 90],
    }),
    'panorama|72x36|-180,180|-90,90',
  );
});
