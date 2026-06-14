import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  postprocessAoiProject,
  summarizeAoiProjectCleanup,
} from '../src/aois/aoiPostprocess.js';

const DEFAULT_INPUT_DIR = 'runpod-aoi-results/outputs';
const DEFAULT_OUTPUT_DIR = 'runpod-aoi-results-enhanced/outputs';

function parseArgs(argv) {
  const args = {
    inputDir: DEFAULT_INPUT_DIR,
    outputDir: DEFAULT_OUTPUT_DIR,
    maxAois: null,
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
    } else if (arg === '--max-aois' && next) {
      args.maxAois = Number(next);
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

function outputNameFor(inputName) {
  return inputName.replace(/\.generated-aois\.json$/, '.enhanced-aois.json');
}

export async function postprocessRunpodAois(args = {}) {
  const inputDir = path.resolve(args.inputDir || DEFAULT_INPUT_DIR);
  const outputDir = path.resolve(args.outputDir || DEFAULT_OUTPUT_DIR);
  const maxAois = Number.isFinite(args.maxAois) ? args.maxAois : null;

  await fs.mkdir(outputDir, { recursive: true });

  const inputNames = (await fs.readdir(inputDir))
    .filter((name) => name.endsWith('.generated-aois.json'))
    .sort();

  const results = [];

  for (const inputName of inputNames) {
    const inputPath = path.join(inputDir, inputName);
    const outputName = outputNameFor(inputName);
    const outputPath = path.join(outputDir, outputName);
    const project = await readJson(inputPath);
    const cleaned = postprocessAoiProject(project, { maxAois });

    await writeJson(outputPath, cleaned);

    results.push({
      inputName,
      outputName,
      inputPath,
      outputPath,
      ...summarizeAoiProjectCleanup(cleaned),
    });
  }

  const manifest = {
    kind: 'eye-tracking-360-aoi-postprocess-manifest',
    generatedAt: new Date().toISOString(),
    inputDir,
    outputDir,
    maxAois,
    files: results,
  };

  await writeJson(path.join(outputDir, 'manifest.json'), manifest);

  return manifest;
}

const scriptPath = fileURLToPath(import.meta.url);

if (process.argv[1] === scriptPath) {
  const manifest = await postprocessRunpodAois(parseArgs(process.argv.slice(2)));

  for (const file of manifest.files) {
    console.log(
      `${file.outputName}: ${file.inputAois} -> ${file.outputAois} AOIs `
      + `(filtered ${file.filteredAois}, merged ${file.mergedAois}, small merged ${file.smallMergedAois})`,
    );
  }
}
