#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const defaultInput = 'assets/replacement-videos/nguyen-hue-360-0532-0602.mp4';
const defaultPreviewDir = 'tmp-debug/modern-city-frame-picker';
const defaultOutputDir = 'assets/replacement-videos';
const defaultFfmpeg = '.tools/py/imageio_ffmpeg/binaries/ffmpeg-win-x86_64-v7.1.exe';

export function parseCsvNumbers(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map(Number)
    .filter(Number.isFinite);
}

export function buildPreviewFrames({
  timeSec,
  yaws,
  pitches,
  hFov,
  vFov,
}) {
  const frames = [];
  yaws.forEach((yaw) => {
    pitches.forEach((pitch) => {
      frames.push({ timeSec, yaw, pitch, hFov, vFov });
    });
  });
  return frames;
}

export function buildV360Filter({
  yaw,
  pitch,
  hFov,
  vFov,
  width,
  height,
}) {
  return `v360=input=equirect:output=flat:yaw=${yaw}:pitch=${pitch}:h_fov=${hFov}:v_fov=${vFov}:w=${width}:h=${height}`;
}

function formatTimeSegment(seconds) {
  const totalSeconds = Math.max(0, Math.round(Number(seconds) || 0));
  const minutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}${String(remainingSeconds).padStart(2, '0')}`;
}

export function buildClipFileName({
  startSec,
  durationSec,
  yaw,
  pitch,
  hFov,
}) {
  const endSec = Number(startSec) + Number(durationSec);
  return [
    'nguyen-hue-2d-custom',
    `${formatTimeSegment(startSec)}-${formatTimeSegment(endSec)}`,
    `yaw${yaw}`,
    `pitch${pitch}`,
    `fov${hFov}`,
  ].join('-').replace(/--/g, '-neg') + '.mp4';
}

function parseArgs(argv = process.argv.slice(2)) {
  const [mode = 'help', ...rest] = argv;
  const options = { mode };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (!arg.startsWith('--')) {
      continue;
    }
    const key = arg.slice(2);
    const next = rest[index + 1];
    if (!next || next.startsWith('--')) {
      options[key] = true;
      continue;
    }
    options[key] = next;
    index += 1;
  }
  return options;
}

function numberOption(options, key, fallback) {
  const value = Number(options[key]);
  return Number.isFinite(value) ? value : fallback;
}

function resolveRepoPath(path) {
  return resolve(repoRoot, path);
}

function getFfmpegPath(options) {
  return resolveRepoPath(options.ffmpeg || defaultFfmpeg);
}

function runFfmpeg(args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const ffmpeg = getFfmpegPath(options);
    const child = spawn(ffmpeg, args, {
      cwd: repoRoot,
      stdio: 'inherit',
      windowsHide: true,
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolvePromise();
      } else {
        reject(new Error(`ffmpeg exited with code ${code}`));
      }
    });
  });
}

function frameName(frame, index) {
  return `frame-${String(index + 1).padStart(2, '0')}-t${frame.timeSec}-yaw${frame.yaw}-pitch${frame.pitch}-fov${frame.hFov}.jpg`;
}

function htmlEscape(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

async function writePreviewHtml({ outputDir, frames, imageNames, cutCommand }) {
  const cards = frames.map((frame, index) => `
    <article>
      <img src="${htmlEscape(imageNames[index])}" alt="yaw ${frame.yaw}, pitch ${frame.pitch}, fov ${frame.hFov}" />
      <code>yaw=${frame.yaw} pitch=${frame.pitch} hFov=${frame.hFov} vFov=${frame.vFov}</code>
    </article>
  `).join('\n');
  const html = `<!doctype html>
<html lang="vi">
<meta charset="utf-8" />
<title>Modern city frame picker</title>
<style>
  body { margin: 24px; font-family: Arial, sans-serif; background: #f6f6f6; color: #171717; }
  main { display: grid; gap: 18px; }
  pre { white-space: pre-wrap; padding: 12px; background: #fff; border: 1px solid #ddd; }
  section { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 14px; }
  article { display: grid; gap: 8px; padding: 10px; background: #fff; border: 1px solid #ddd; }
  img { width: 100%; display: block; background: #111; }
  code { font-size: 13px; overflow-wrap: anywhere; }
</style>
<main>
  <h1>Modern city frame picker</h1>
  <p>Chọn frame/góc bạn thích, rồi copy thông số yaw/pitch/FOV vào lệnh cut.</p>
  <pre>${htmlEscape(cutCommand)}</pre>
  <section>${cards}</section>
</main>
</html>
`;
  await writeFile(resolve(outputDir, 'index.html'), html, 'utf8');
}

async function createPreview(options) {
  const input = options.input || defaultInput;
  const outputDir = resolveRepoPath(options.outDir || defaultPreviewDir);
  const timeSec = numberOption(options, 'time', 1);
  const hFov = numberOption(options, 'hFov', 100);
  const vFov = numberOption(options, 'vFov', 58);
  const width = numberOption(options, 'width', 1280);
  const height = numberOption(options, 'height', 720);
  const yaws = parseCsvNumbers(options.yaws || '-180,-165,-150,-135,-120,-105,-90,-75,-60,-45,0,45,90,135,180');
  const pitches = parseCsvNumbers(options.pitches || '-8,0,8');
  const frames = buildPreviewFrames({ timeSec, yaws, pitches, hFov, vFov });

  await mkdir(outputDir, { recursive: true });
  const imageNames = [];
  for (let index = 0; index < frames.length; index += 1) {
    const frame = frames[index];
    const imageName = frameName(frame, index);
    imageNames.push(imageName);
    await runFfmpeg([
      '-hide_banner',
      '-loglevel',
      'error',
      '-ss',
      String(frame.timeSec),
      '-i',
      input,
      '-frames:v',
      '1',
      '-vf',
      buildV360Filter({ ...frame, width, height }),
      '-q:v',
      '2',
      '-y',
      resolve(outputDir, imageName),
    ], options);
  }

  const cutCommand = [
    'node scripts/modern_city_clip_tool.mjs cut',
    `--start ${timeSec}`,
    '--duration 30',
    '--yaw <copy-yaw>',
    '--pitch <copy-pitch>',
    `--hFov ${hFov}`,
    `--vFov ${vFov}`,
  ].join(' ');
  await writePreviewHtml({ outputDir, frames, imageNames, cutCommand });
  console.log(`Preview ready: ${pathToFileURL(resolve(outputDir, 'index.html')).href}`);
}

async function cutClip(options) {
  const input = options.input || defaultInput;
  const startSec = numberOption(options, 'start', 0);
  const durationSec = numberOption(options, 'duration', 30);
  const yaw = numberOption(options, 'yaw', -180);
  const pitch = numberOption(options, 'pitch', 0);
  const hFov = numberOption(options, 'hFov', 100);
  const vFov = numberOption(options, 'vFov', 58);
  const width = numberOption(options, 'width', 1920);
  const height = numberOption(options, 'height', 1080);
  const outputDir = resolveRepoPath(options.outDir || defaultOutputDir);
  const outputName = options.output || buildClipFileName({ startSec, durationSec, yaw, pitch, hFov });
  const outputPath = resolve(outputDir, outputName);

  await mkdir(outputDir, { recursive: true });
  await runFfmpeg([
    '-hide_banner',
    '-loglevel',
    'error',
    '-ss',
    String(startSec),
    '-i',
    input,
    '-t',
    String(durationSec),
    '-vf',
    buildV360Filter({ yaw, pitch, hFov, vFov, width, height }),
    '-c:v',
    'libx264',
    '-preset',
    'slow',
    '-crf',
    String(numberOption(options, 'crf', 18)),
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'copy',
    '-movflags',
    '+faststart',
    '-y',
    outputPath,
  ], options);
  console.log(`Clip ready: ${outputPath}`);
}

function printHelp() {
  console.log(`Modern city clip tool

Preview candidate frames:
  node scripts/modern_city_clip_tool.mjs preview --time 1 --yaws -180,-165,-150 --pitches -8,0,8 --hFov 100 --vFov 58

Cut the chosen view:
  node scripts/modern_city_clip_tool.mjs cut --start 0 --duration 30 --yaw -165 --pitch 0 --hFov 100 --vFov 58
`);
}

async function main() {
  const options = parseArgs();
  if (options.mode === 'preview') {
    await createPreview(options);
  } else if (options.mode === 'cut') {
    await cutClip(options);
  } else {
    printHelp();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
