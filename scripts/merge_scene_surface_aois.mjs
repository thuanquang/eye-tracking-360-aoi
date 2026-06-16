import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_BASE_DIR = 'runpod-aoi-results-absolute-quality-enhanced/outputs';
const DEFAULT_SCENE_DIR = 'runpod-aoi-results-scene-surfaces/outputs';
const DEFAULT_OUTPUT_DIR = 'runpod-aoi-results-absolute-quality-with-surfaces/outputs';

function parseArgs(argv) {
  const args = {
    baseDir: DEFAULT_BASE_DIR,
    sceneDir: DEFAULT_SCENE_DIR,
    outputDir: DEFAULT_OUTPUT_DIR,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === '--base-dir' && next) {
      args.baseDir = next;
      index += 1;
    } else if (arg === '--scene-dir' && next) {
      args.sceneDir = next;
      index += 1;
    } else if (arg === '--output-dir' && next) {
      args.outputDir = next;
      index += 1;
    }
  }

  return args;
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function normalizeSource(source) {
  if (source && typeof source === 'object' && !Array.isArray(source)) {
    return { ...source };
  }

  if (typeof source === 'string' && source.trim()) {
    return { method: source };
  }

  return {};
}

function fileStemKey(name) {
  return path.basename(name, '.json')
    .replace(/\.generated-aois$/, '')
    .replace(/\.enhanced-aois$/, '')
    .replace(/\.scene-surface-aois$/, '');
}

function projectKeys(fileName, project) {
  const keys = new Set([fileStemKey(fileName)]);
  const videoName = project?.video?.name;
  if (typeof videoName === 'string' && videoName.trim()) {
    keys.add(path.basename(videoName, path.extname(videoName)));
  }
  return [...keys];
}

async function readProjectsByKey(inputDir) {
  const names = (await fs.readdir(inputDir))
    .filter((name) => name.endsWith('.json') && name !== 'manifest.json')
    .sort();
  const entries = [];
  const byKey = new Map();

  for (const name of names) {
    const filePath = path.join(inputDir, name);
    const project = await readJson(filePath);
    const entry = { name, filePath, project };
    entries.push(entry);

    for (const key of projectKeys(name, project)) {
      byKey.set(key, entry);
    }
  }

  return { entries, byKey };
}

function mergeAoisById(baseAois, sceneAois) {
  const merged = [];
  const seenIds = new Set();

  for (const aoi of [...baseAois, ...sceneAois]) {
    const id = String(aoi?.id || '');
    if (id && seenIds.has(id)) {
      const existingIndex = merged.findIndex((item) => item.id === id);
      merged[existingIndex] = aoi;
      continue;
    }
    if (id) {
      seenIds.add(id);
    }
    merged.push(aoi);
  }

  return merged;
}

export async function mergeSceneSurfaceAois(args = {}) {
  const baseDir = path.resolve(args.baseDir || DEFAULT_BASE_DIR);
  const sceneDir = path.resolve(args.sceneDir || DEFAULT_SCENE_DIR);
  const outputDir = path.resolve(args.outputDir || DEFAULT_OUTPUT_DIR);

  await fs.mkdir(outputDir, { recursive: true });

  const baseProjects = await readProjectsByKey(baseDir);
  const sceneProjects = await readProjectsByKey(sceneDir);
  const files = [];

  for (const baseEntry of baseProjects.entries) {
    const match = projectKeys(baseEntry.name, baseEntry.project)
      .map((key) => sceneProjects.byKey.get(key))
      .find(Boolean);
    const baseAois = Array.isArray(baseEntry.project.aois) ? baseEntry.project.aois : [];
    const sceneAois = Array.isArray(match?.project?.aois) ? match.project.aois : [];
    const mergedAois = mergeAoisById(baseAois, sceneAois);
    const merged = {
      ...baseEntry.project,
      generatedAt: new Date().toISOString(),
      source: {
        ...normalizeSource(baseEntry.project.source),
        sceneSurfaceMerge: 'merge_scene_surface_aois',
      },
      aois: mergedAois,
      stats: {
        ...(baseEntry.project.stats || {}),
        sceneSurfaceMerge: {
          baseAois: baseAois.length,
          sceneSurfaceAois: sceneAois.length,
          outputAois: mergedAois.length,
          sceneSurfaceSource: match?.name || null,
        },
      },
    };
    const outputPath = path.join(outputDir, baseEntry.name);
    await writeJson(outputPath, merged);
    files.push({
      inputName: baseEntry.name,
      outputName: baseEntry.name,
      sceneSurfaceName: match?.name || null,
      baseAois: baseAois.length,
      sceneSurfaceAois: sceneAois.length,
      outputAois: merged.aois.length,
      outputPath,
    });
  }

  const manifest = {
    kind: 'eye-tracking-360-aoi-scene-surface-merge-manifest',
    generatedAt: new Date().toISOString(),
    baseDir,
    sceneDir,
    outputDir,
    files,
  };

  await writeJson(path.join(outputDir, 'manifest.json'), manifest);
  return manifest;
}

const scriptPath = fileURLToPath(import.meta.url);

if (process.argv[1] === scriptPath) {
  const manifest = await mergeSceneSurfaceAois(parseArgs(process.argv.slice(2)));
  for (const file of manifest.files) {
    console.log(
      `${file.outputName}: ${file.baseAois} base + ${file.sceneSurfaceAois} scene surface `
      + `-> ${file.outputAois} AOIs`,
    );
  }
}
