import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { postprocessRunpodAois } from '../scripts/postprocess_runpod_aois.mjs';

function videoBoxAoi(id, label) {
  const keyframes = [0, 1].map((t) => ({
    t,
    points: [
      { x: 0.1, y: 0.1 },
      { x: 0.3, y: 0.1 },
      { x: 0.3, y: 0.3 },
      { x: 0.1, y: 0.3 },
    ],
  }));

  return {
    id,
    label,
    color: '#38bdf8',
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

test('RunPod postprocess script leaves AOIs uncapped by default', async (t) => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'runpod-postprocess-'));
  t.after(() => fs.rm(tempRoot, { recursive: true, force: true }));

  const inputDir = path.join(tempRoot, 'inputs');
  const outputDir = path.join(tempRoot, 'outputs');
  await fs.mkdir(inputDir);

  const project = baseProject(Array.from({ length: 85 }, (_, index) => (
    videoBoxAoi(`object-${index}`, `object ${index}`)
  )));
  await fs.writeFile(
    path.join(inputDir, 'sample.generated-aois.json'),
    `${JSON.stringify(project, null, 2)}\n`,
    'utf8',
  );

  const manifest = await postprocessRunpodAois({ inputDir, outputDir });
  const output = JSON.parse(
    await fs.readFile(path.join(outputDir, 'sample.enhanced-aois.json'), 'utf8'),
  );

  assert.equal(manifest.maxAois, null);
  assert.equal(output.aois.length, 85);
  assert.equal(output.stats.postprocess.cappedAois, 0);
  assert.equal(output.stats.postprocess.options.maxAois, null);
});
