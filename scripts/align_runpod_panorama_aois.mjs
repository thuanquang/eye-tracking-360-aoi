import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { rotatePanoramaProjectYaw } from '../src/aois/aoiCoordinateRepair.js';

const DEFAULT_INPUT_DIR = 'runpod-aoi-results-absolute-quality-enhanced/outputs';
const DEFAULT_OUTPUT_DIR = 'runpod-aoi-results-absolute-quality-aligned/outputs';

function parseArgs(argv) {
  const args = {
    inputDir: DEFAULT_INPUT_DIR,
    outputDir: DEFAULT_OUTPUT_DIR,
    yawOffsetDegrees: -90,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === '--input-dir' && next) {
      args.inputDir = next;
      index += 1;
    } else if (arg === '--output-dir' && next) {
      args.outputDir = next;
      index += 1;
    } else if (arg === '--yaw-offset' && next) {
      args.yawOffsetDegrees = Number(next);
      index += 1;
    }
  }

  return args;
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

async function writeJson(filePath, value) {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export async function alignRunpodPanoramaAois(args = {}) {
  const inputDir = path.resolve(args.inputDir || DEFAULT_INPUT_DIR);
  const outputDir = path.resolve(args.outputDir || DEFAULT_OUTPUT_DIR);
  const yawOffsetDegrees = Number.isFinite(args.yawOffsetDegrees)
    ? args.yawOffsetDegrees
    : -90;

  await fs.mkdir(outputDir, { recursive: true });

  const inputNames = (await fs.readdir(inputDir))
    .filter((name) => name.endsWith('.json') && name !== 'manifest.json')
    .sort();
  const files = [];

  for (const inputName of inputNames) {
    const inputPath = path.join(inputDir, inputName);
    const outputPath = path.join(outputDir, inputName);
    const project = await readJson(inputPath);
    const repaired = rotatePanoramaProjectYaw(project, yawOffsetDegrees);

    await writeJson(outputPath, repaired);

    files.push({
      inputName,
      outputName: inputName,
      inputPath,
      outputPath,
      projection: repaired.video?.projection || null,
      aoiCount: Array.isArray(repaired.aois) ? repaired.aois.length : 0,
      coordinateRepair: repaired.source?.coordinateRepair || null,
    });
  }

  const manifest = {
    kind: 'eye-tracking-360-aoi-coordinate-repair-manifest',
    generatedAt: new Date().toISOString(),
    inputDir,
    outputDir,
    yawOffsetDegrees,
    files,
  };

  await writeJson(path.join(outputDir, 'manifest.json'), manifest);
  return manifest;
}

const scriptPath = fileURLToPath(import.meta.url);

if (process.argv[1] === scriptPath) {
  const manifest = await alignRunpodPanoramaAois(parseArgs(process.argv.slice(2)));

  for (const file of manifest.files) {
    const repair = file.coordinateRepair
      ? `rotated ${file.coordinateRepair.yawOffsetDegrees} deg`
      : 'unchanged';
    console.log(`${file.outputName}: ${file.aoiCount} AOIs, ${file.projection}, ${repair}`);
  }
}
