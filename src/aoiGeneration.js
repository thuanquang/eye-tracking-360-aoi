import { normalizeYaw } from './aoiMath.js';

export const COLAB_AOI_JOB_KIND = 'aoi-colab-job';
export const COLAB_AOI_JOB_VERSION = 1;
export const DEFAULT_AUTO_AOI_PROMPTS = [
  'person',
  'face',
  'hand',
  'screen',
  'sign',
  'product',
  'door',
  'vehicle',
];

const GENERATED_COLORS = [
  '#ffd166',
  '#5dd7c8',
  '#ff8a5c',
  '#8bd66f',
  '#ff4f9a',
  '#9fb7ff',
];

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round(value) {
  return Number(value.toFixed(6));
}

function sanitizeNumber(value, fallback) {
  const numeric = Number(value);

  return Number.isFinite(numeric) ? numeric : fallback;
}

function parsePromptList(prompts) {
  if (Array.isArray(prompts)) {
    return prompts.map((prompt) => String(prompt).trim()).filter(Boolean);
  }

  return String(prompts || '')
    .split(/[\n,]+/)
    .map((prompt) => prompt.trim())
    .filter(Boolean);
}

export function normalizeAoiId(label, fallback = 'aoi') {
  const id = String(label || fallback)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return id || fallback;
}

export function buildColabAoiJob({
  video,
  prompts = DEFAULT_AUTO_AOI_PROMPTS,
  sampleIntervalSec = 1,
  outputShape = 'polygon',
  detectorModel = 'microsoft/Florence-2-base',
  segmenterModel = 'facebook/sam2.1-hiera-small',
  maxPolygonPoints = 80,
  polygonSimplificationEpsilon = 0.003,
  analysisPaddingPx = 18,
}) {
  const promptList = parsePromptList(prompts);
  const safeMaxPolygonPoints = Math.round(clamp(sanitizeNumber(maxPolygonPoints, 80), 12, 240));
  const safePolygonSimplificationEpsilon = round(clamp(
    sanitizeNumber(polygonSimplificationEpsilon, 0.003),
    0.001,
    0.02,
  ));
  const safeAnalysisPaddingPx = Math.round(clamp(sanitizeNumber(analysisPaddingPx, 18), 0, 128));

  return {
    kind: COLAB_AOI_JOB_KIND,
    version: COLAB_AOI_JOB_VERSION,
    createdAt: new Date().toISOString(),
    video: {
      name: video?.name || null,
      durationSec: Number.isFinite(video?.durationSec) ? video.durationSec : null,
      projection: video?.projection || 'equirectangular',
      stereoLayout: video?.stereoLayout || 'mono',
    },
    aoiPolicy: {
      prompts: promptList.length ? promptList : DEFAULT_AUTO_AOI_PROMPTS,
      sampleIntervalSec: Number.isFinite(Number(sampleIntervalSec))
        ? Math.max(0.1, Number(sampleIntervalSec))
        : 1,
      output: 'aoi-json',
      outputShape,
      detectorModel,
      segmenterModel,
      maxPolygonPoints: safeMaxPolygonPoints,
      polygonSimplificationEpsilon: safePolygonSimplificationEpsilon,
      analysisPaddingPx: safeAnalysisPaddingPx,
      recommendedNotebook: 'notebooks/google-colab-auto-aoi.ipynb',
    },
  };
}

export function getStereoFrameRect({
  videoWidth,
  videoHeight,
  stereoLayout = 'mono',
  eye = 'left',
}) {
  if (stereoLayout === 'side-by-side') {
    const width = videoWidth / 2;
    return {
      x: eye === 'right' ? width : 0,
      y: 0,
      width,
      height: videoHeight,
    };
  }

  if (stereoLayout === 'top-bottom') {
    const height = videoHeight / 2;
    return {
      x: 0,
      y: eye === 'right' ? height : 0,
      width: videoWidth,
      height,
    };
  }

  return { x: 0, y: 0, width: videoWidth, height: videoHeight };
}

export function normalizeBoxToFrame(box, frameRect) {
  const xMin = clamp((box.x - frameRect.x) / frameRect.width, 0, 1);
  const xMax = clamp((box.x + box.width - frameRect.x) / frameRect.width, 0, 1);
  const yMin = clamp((box.y - frameRect.y) / frameRect.height, 0, 1);
  const yMax = clamp((box.y + box.height - frameRect.y) / frameRect.height, 0, 1);

  return {
    xMin: round(Math.min(xMin, xMax)),
    xMax: round(Math.max(xMin, xMax)),
    yMin: round(Math.min(yMin, yMax)),
    yMax: round(Math.max(yMin, yMax)),
  };
}

export function pixelBoxToAoiKeyframe({
  t,
  box,
  videoWidth,
  videoHeight,
  projection = 'equirectangular',
  stereoLayout = 'mono',
  eye = 'left',
}) {
  const frameRect = getStereoFrameRect({ videoWidth, videoHeight, stereoLayout, eye });
  const normalized = normalizeBoxToFrame(box, frameRect);

  if (projection === 'flat') {
    return { t, ...normalized };
  }

  return {
    t,
    yawMin: normalizeYaw(round(normalized.xMin * 360 - 180)),
    yawMax: normalizeYaw(round(normalized.xMax * 360 - 180)),
    pitchMin: round(90 - normalized.yMax * 180),
    pitchMax: round(90 - normalized.yMin * 180),
  };
}

function keyForDetection(detection) {
  return normalizeAoiId(detection.label || detection.className || 'generated-aoi');
}

export function detectionsToAois({
  detections,
  video,
  generatedBy = 'google-colab-auto-aoi',
}) {
  const grouped = new Map();
  const projection = video?.projection || 'equirectangular';
  const stereoLayout = video?.stereoLayout || 'mono';
  const videoWidth = video?.width || video?.videoWidth;
  const videoHeight = video?.height || video?.videoHeight;

  if (!Number.isFinite(videoWidth) || !Number.isFinite(videoHeight)) {
    throw new Error('Video width and height are required to convert detections to AOIs.');
  }

  (detections || []).forEach((detection) => {
    if (!detection?.box) {
      return;
    }

    const id = keyForDetection(detection);
    const keyframe = pixelBoxToAoiKeyframe({
      t: Number.isFinite(detection.t) ? detection.t : 0,
      box: detection.box,
      videoWidth,
      videoHeight,
      projection,
      stereoLayout,
      eye: detection.eye || 'left',
    });
    const entry = grouped.get(id) || {
      id,
      label: detection.label || detection.className || id,
      color: GENERATED_COLORS[grouped.size % GENERATED_COLORS.length],
      space: projection === 'flat' ? 'video' : 'panorama',
      generated: {
        method: generatedBy,
        confidence: detection.confidence ?? null,
        projection,
        stereoLayout,
      },
      keyframes: [],
    };

    entry.keyframes.push(keyframe);
    grouped.set(id, entry);
  });

  return [...grouped.values()].map((aoi) => {
    const keyframes = aoi.keyframes.sort((a, b) => a.t - b.t);
    return {
      ...aoi,
      ...keyframes[0],
      keyframes,
    };
  });
}
