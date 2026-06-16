import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { mergeSceneSurfaceAois } from '../scripts/merge_scene_surface_aois.mjs';

test('merges scene surface AOIs into matching base AOI project files', async (t) => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'scene-surface-merge-'));
  t.after(() => fs.rm(tempRoot, { recursive: true, force: true }));

  const baseDir = path.join(tempRoot, 'base');
  const sceneDir = path.join(tempRoot, 'scene');
  const outputDir = path.join(tempRoot, 'output');
  await fs.mkdir(baseDir);
  await fs.mkdir(sceneDir);

  const baseProject = {
    kind: 'aoi-project',
    source: 'runpod-auto-aoi',
    video: { name: 'sample.mp4', projection: 'flat' },
    aois: [{ id: 'person-1', label: 'person' }],
  };
  const sceneProject = {
    kind: 'aoi-project',
    source: 'runpod-scene-surface-aoi',
    video: { name: 'sample.mp4', projection: 'flat' },
    aois: [
      { id: 'sky-scene-surface', label: 'sky', metadata: { sceneSurface: true } },
      { id: 'ground-scene-surface', label: 'ground', metadata: { sceneSurface: true } },
    ],
  };

  await fs.writeFile(
    path.join(baseDir, 'sample.enhanced-aois.json'),
    `${JSON.stringify(baseProject, null, 2)}\n`,
    'utf8',
  );
  await fs.writeFile(
    path.join(sceneDir, 'sample.scene-surface-aois.json'),
    `${JSON.stringify(sceneProject, null, 2)}\n`,
    'utf8',
  );

  const manifest = await mergeSceneSurfaceAois({ baseDir, sceneDir, outputDir });
  const merged = JSON.parse(
    await fs.readFile(path.join(outputDir, 'sample.enhanced-aois.json'), 'utf8'),
  );

  assert.equal(manifest.files[0].sceneSurfaceAois, 2);
  assert.deepEqual(merged.aois.map((aoi) => aoi.id), [
    'person-1',
    'sky-scene-surface',
    'ground-scene-surface',
  ]);
  assert.equal(merged.source.sceneSurfaceMerge, 'merge_scene_surface_aois');
});
