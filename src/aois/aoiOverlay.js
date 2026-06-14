import {
  normalizeYaw,
  panoramaPointToScreen,
  screenPointToYawPitch,
} from './aoiMath.js';
import { interpolatePolygonPoints } from '../aoiShapes.js';

const DEFAULT_AOI_OVERLAY_COLOR = '#ffd166';
const DEFAULT_AOI_OVERLAY_FILL_OPACITY = 0.16;
const GENERATED_AOI_OVERLAY_FILL_OPACITY = 0.06;
const MAX_PANORAMA_POLYGON_OVERLAY_POINTS = 96;
const MAX_DRAG_PANORAMA_POLYGON_OVERLAY_POINTS = 24;

export function createAoiOverlayRedrawGate({ minIntervalMs = 50 } = {}) {
  let lastSignature = null;
  let lastDrawAt = -Infinity;

  return {
    shouldRedraw({ signature, nowMs = 0, force = false, minIntervalMs: intervalOverride = minIntervalMs } = {}) {
      if (force || lastSignature === null) {
        lastSignature = signature;
        lastDrawAt = nowMs;
        return true;
      }

      if (signature === lastSignature) {
        return false;
      }

      if (nowMs - lastDrawAt < intervalOverride) {
        return false;
      }

      lastSignature = signature;
      lastDrawAt = nowMs;
      return true;
    },
  };
}

export function splitAoiYawRanges(aoi) {
  const yawMin = normalizeYaw(aoi.yawMin);
  const yawMax = normalizeYaw(aoi.yawMax);

  if (yawMin <= yawMax) {
    return [{ yawMin, yawMax }];
  }

  return [
    { yawMin, yawMax: 180 },
    { yawMin: -180, yawMax },
  ];
}

export function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function interpolateScreenPoint(start, end, ratio) {
  return {
    x: start.x + (end.x - start.x) * ratio,
    y: start.y + (end.y - start.y) * ratio,
  };
}

export function clipPolygonAgainstBoundary(points, isInside, intersection) {
  if (!points.length) {
    return [];
  }

  const clipped = [];
  let previous = points[points.length - 1];
  let previousInside = isInside(previous);

  points.forEach((current) => {
    const currentInside = isInside(current);

    if (currentInside) {
      if (!previousInside) {
        clipped.push(intersection(previous, current));
      }

      clipped.push(current);
    } else if (previousInside) {
      clipped.push(intersection(previous, current));
    }

    previous = current;
    previousInside = currentInside;
  });

  return clipped;
}

export function clipPolygonToRect(points, width, height) {
  const safeIntersection = (start, end, ratio) => interpolateScreenPoint(
    start,
    end,
    Number.isFinite(ratio) ? ratio : 0,
  );

  const clipped = [
    {
      isInside: (point) => point.x >= 0,
      intersection: (start, end) => safeIntersection(start, end, (0 - start.x) / (end.x - start.x)),
    },
    {
      isInside: (point) => point.x <= width,
      intersection: (start, end) => safeIntersection(start, end, (width - start.x) / (end.x - start.x)),
    },
    {
      isInside: (point) => point.y >= 0,
      intersection: (start, end) => safeIntersection(start, end, (0 - start.y) / (end.y - start.y)),
    },
    {
      isInside: (point) => point.y <= height,
      intersection: (start, end) => safeIntersection(start, end, (height - start.y) / (end.y - start.y)),
    },
  ].reduce(
    (currentPoints, boundary) => clipPolygonAgainstBoundary(
      currentPoints,
      boundary.isInside,
      boundary.intersection,
    ),
    points,
  );

  return clipped.map((point) => ({
    x: clampNumber(point.x, 0, width),
    y: clampNumber(point.y, 0, height),
  }));
}

function dedupeScreenPoints(points) {
  const seen = new Set();

  return points.filter((point) => {
    const key = `${Math.round(point.x * 1000)}:${Math.round(point.y * 1000)}`;

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function crossScreenPoints(origin, a, b) {
  return (a.x - origin.x) * (b.y - origin.y) - (a.y - origin.y) * (b.x - origin.x);
}

function buildConvexHull(points) {
  const sorted = dedupeScreenPoints(points)
    .sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));

  if (sorted.length <= 3) {
    return sorted;
  }

  const lower = [];
  sorted.forEach((point) => {
    while (
      lower.length >= 2 &&
      crossScreenPoints(lower[lower.length - 2], lower[lower.length - 1], point) <= 0
    ) {
      lower.pop();
    }
    lower.push(point);
  });

  const upper = [];
  [...sorted].reverse().forEach((point) => {
    while (
      upper.length >= 2 &&
      crossScreenPoints(upper[upper.length - 2], upper[upper.length - 1], point) <= 0
    ) {
      upper.pop();
    }
    upper.push(point);
  });

  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

function sampleClosedPolygonPoints(points, maxPoints = MAX_PANORAMA_POLYGON_OVERLAY_POINTS) {
  if (!Array.isArray(points) || points.length <= maxPoints) {
    return points || [];
  }

  const sampled = [];
  const step = points.length / maxPoints;

  for (let index = 0; index < maxPoints; index += 1) {
    sampled.push(points[Math.floor(index * step)]);
  }

  return sampled;
}

function getAoiSpace(aoi) {
  return aoi?.space === 'video' ? 'video' : 'panorama';
}

function getPolygonPointKeys(aoi) {
  return getAoiSpace(aoi) === 'video'
    ? { x: 'x', y: 'y' }
    : { x: 'yaw', y: 'pitch' };
}

function interpolateLinear(start, end, ratio) {
  return start + (end - start) * ratio;
}

function interpolateOverlayYaw(start, end, ratio) {
  return normalizeYaw(start + normalizeYaw(end - start) * ratio);
}

function roundOverlayCoordinate(value) {
  return Number(value.toFixed(6));
}

const overlayKeyframeCache = new WeakMap();

function getSortedOverlayKeyframes(keyframes) {
  if (!Array.isArray(keyframes)) {
    return [];
  }

  const cached = overlayKeyframeCache.get(keyframes);
  if (cached && cached.sourceLength === keyframes.length) {
    return cached.sorted;
  }

  const sorted = keyframes
    .filter((keyframe) => Number.isFinite(keyframe?.t))
    .sort((a, b) => a.t - b.t);

  overlayKeyframeCache.set(keyframes, {
    sourceLength: keyframes.length,
    sorted,
  });

  return sorted;
}

function findOverlayKeyframePair(keyframes, timeSec) {
  const sorted = getSortedOverlayKeyframes(keyframes);

  if (!sorted.length) {
    return null;
  }

  if (timeSec <= sorted[0].t) {
    return [sorted[0], sorted[0]];
  }

  const last = sorted[sorted.length - 1];
  if (timeSec >= last.t) {
    return [last, last];
  }

  for (let index = 0; index < sorted.length - 1; index += 1) {
    const current = sorted[index];
    const next = sorted[index + 1];

    if (timeSec >= current.t && timeSec <= next.t) {
      return [current, next];
    }
  }

  return [last, last];
}

function isGeneratedOverlayTrack(aoi) {
  return typeof aoi?.metadata?.generatedBy === 'string' && aoi.metadata.generatedBy.trim().length > 0;
}

function isTimeInsideOverlayTrack(aoi, timeSec) {
  if (!isGeneratedOverlayTrack(aoi) || !Array.isArray(aoi.keyframes) || !aoi.keyframes.length) {
    return true;
  }

  const sorted = getSortedOverlayKeyframes(aoi.keyframes);
  if (!sorted.length) {
    return true;
  }

  return timeSec >= sorted[0].t && timeSec <= sorted[sorted.length - 1].t;
}

export function resolveOverlayAoisAtTime(aois, timeSec = 0) {
  const safeTime = Number.isFinite(timeSec) ? timeSec : 0;

  return (aois || [])
    .map((aoi) => {
      if (!Array.isArray(aoi.keyframes) || !aoi.keyframes.length) {
        return aoi?.shape === 'polygon'
          ? { ...aoi, points: sampleClosedPolygonPoints(aoi.points) }
          : { ...aoi };
      }

      if (!isTimeInsideOverlayTrack(aoi, safeTime)) {
        return null;
      }

      const pair = findOverlayKeyframePair(aoi.keyframes, safeTime);
      if (!pair) {
        return aoi?.shape === 'polygon'
          ? { ...aoi, points: sampleClosedPolygonPoints(aoi.points) }
          : { ...aoi };
      }

      const [start, end] = pair;
      const duration = end.t - start.t;
      const ratio = duration > 0 ? (safeTime - start.t) / duration : 0;

      if (aoi.shape === 'polygon') {
        const pointKeys = getPolygonPointKeys(aoi);
        return {
          ...aoi,
          points: interpolatePolygonPoints(
            sampleClosedPolygonPoints(start.points || []),
            sampleClosedPolygonPoints(end.points || []),
            ratio,
            pointKeys,
          ),
        };
      }

      if (getAoiSpace(aoi) === 'video') {
        return {
          ...aoi,
          xMin: roundOverlayCoordinate(interpolateLinear(start.xMin, end.xMin, ratio)),
          xMax: roundOverlayCoordinate(interpolateLinear(start.xMax, end.xMax, ratio)),
          yMin: roundOverlayCoordinate(interpolateLinear(start.yMin, end.yMin, ratio)),
          yMax: roundOverlayCoordinate(interpolateLinear(start.yMax, end.yMax, ratio)),
        };
      }

      return {
        ...aoi,
        yawMin: interpolateOverlayYaw(start.yawMin, end.yawMin, ratio),
        yawMax: interpolateOverlayYaw(start.yawMax, end.yawMax, ratio),
        pitchMin: interpolateLinear(start.pitchMin, end.pitchMin, ratio),
        pitchMax: interpolateLinear(start.pitchMax, end.pitchMax, ratio),
      };
    })
    .filter(Boolean);
}

function createPanoramaPolygonPointChecker(points) {
  const polygon = (points || [])
    .filter((point) => Number.isFinite(point?.yaw) && Number.isFinite(point?.pitch))
    .map((point) => ({
      yaw: normalizeYaw(point.yaw),
      pitch: point.pitch,
    }));

  if (polygon.length < 3) {
    return () => false;
  }

  const yaws = polygon.map((point) => point.yaw);
  const pitches = polygon.map((point) => point.pitch);
  const minYaw = Math.min(...yaws);
  const maxYaw = Math.max(...yaws);
  const minPitch = Math.min(...pitches);
  const maxPitch = Math.max(...pitches);

  return (point) => {
    const yaw = normalizeYaw(point.yaw);
    const pitch = point.pitch;

    if (yaw < minYaw || yaw > maxYaw || pitch < minPitch || pitch > maxPitch) {
      return false;
    }

    let inside = false;

    for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
      const currentPoint = polygon[index];
      const previousPoint = polygon[previous];
      const crossesRay = (
        (currentPoint.pitch > pitch) !== (previousPoint.pitch > pitch) &&
        yaw < (
          ((previousPoint.yaw - currentPoint.yaw) * (pitch - currentPoint.pitch)) /
          (previousPoint.pitch - currentPoint.pitch) +
          currentPoint.yaw
        )
      );

      if (crossesRay) {
        inside = !inside;
      }
    }

    return inside;
  };
}

function pointInsideAoiRange(point, yawMin, yawMax, pitchMin, pitchMax) {
  const yaw = normalizeYaw(point.yaw);
  const minYaw = normalizeYaw(yawMin);
  const maxYaw = normalizeYaw(yawMax);

  return (
    yaw >= minYaw &&
    yaw <= maxYaw &&
    point.pitch >= pitchMin &&
    point.pitch <= pitchMax
  );
}

function projectVisibleAoiSamples(aoi, yawMin, yawMax, rect, camera, {
  screenEdgeSteps = 32,
  rangeYawStepDegrees = 4,
  rangePitchStepDegrees = 4,
} = {}) {
  const pitchMin = Math.min(aoi.pitchMin, aoi.pitchMax);
  const pitchMax = Math.max(aoi.pitchMin, aoi.pitchMax);
  const yawSteps = Math.max(4, Math.ceil(Math.abs(yawMax - yawMin) / rangeYawStepDegrees));
  const pitchSteps = Math.max(3, Math.ceil(Math.abs(pitchMax - pitchMin) / rangePitchStepDegrees));
  const points = [];

  for (let yawIndex = 0; yawIndex <= yawSteps; yawIndex += 1) {
    const yaw = yawMin + ((yawMax - yawMin) * yawIndex) / yawSteps;

    for (let pitchIndex = 0; pitchIndex <= pitchSteps; pitchIndex += 1) {
      const pitch = pitchMin + ((pitchMax - pitchMin) * pitchIndex) / pitchSteps;
      const projected = panoramaPointToScreen({
        yaw,
        pitch,
        width: rect.width,
        height: rect.height,
        cameraYaw: camera.yaw,
        cameraPitch: camera.pitch,
        fov: camera.fov,
      });

      if (projected.visible) {
        points.push({ x: projected.x, y: projected.y });
      }
    }
  }

  const screenEdgePoints = [
    ...Array.from({ length: screenEdgeSteps + 1 }, (_, index) => ({
      x: (rect.width * index) / screenEdgeSteps,
      y: 0,
    })),
    ...Array.from({ length: screenEdgeSteps + 1 }, (_, index) => ({
      x: rect.width,
      y: (rect.height * index) / screenEdgeSteps,
    })),
    ...Array.from({ length: screenEdgeSteps + 1 }, (_, index) => ({
      x: rect.width - (rect.width * index) / screenEdgeSteps,
      y: rect.height,
    })),
    ...Array.from({ length: screenEdgeSteps + 1 }, (_, index) => ({
      x: 0,
      y: rect.height - (rect.height * index) / screenEdgeSteps,
    })),
  ];

  screenEdgePoints.forEach((screenPoint) => {
    const panoramaPoint = screenPointToYawPitch({
      ...screenPoint,
      width: rect.width,
      height: rect.height,
      cameraYaw: camera.yaw,
      cameraPitch: camera.pitch,
      fov: camera.fov,
    });

    if (pointInsideAoiRange(panoramaPoint, yawMin, yawMax, pitchMin, pitchMax)) {
      points.push(screenPoint);
    }
  });

  const hull = buildConvexHull(points);

  return hull.length >= 3 ? clipPolygonToRect(hull, rect.width, rect.height) : null;
}

function projectVisiblePanoramaPolygonSamples(aoi, rect, camera, {
  maxPolygonPoints = MAX_PANORAMA_POLYGON_OVERLAY_POINTS,
  screenEdgeSteps = 32,
  edgeStepDegrees = 4,
} = {}) {
  const sourcePoints = sampleClosedPolygonPoints(aoi.points, maxPolygonPoints);
  const pointIsInsideSampledAoi = createPanoramaPolygonPointChecker(sourcePoints);

  if (sourcePoints.length < 3) {
    return null;
  }

  const points = [];

  sourcePoints.forEach((start, index) => {
    const end = sourcePoints[(index + 1) % sourcePoints.length];
    const steps = Math.max(
      4,
      Math.ceil(Math.hypot(
        normalizeYaw(end.yaw - start.yaw),
        end.pitch - start.pitch,
        ) / edgeStepDegrees),
    );

    for (let step = 0; step <= steps; step += 1) {
      const ratio = step / steps;
      const yaw = normalizeYaw(start.yaw + normalizeYaw(end.yaw - start.yaw) * ratio);
      const pitch = start.pitch + (end.pitch - start.pitch) * ratio;
      const projected = panoramaPointToScreen({
        yaw,
        pitch,
        width: rect.width,
        height: rect.height,
        cameraYaw: camera.yaw,
        cameraPitch: camera.pitch,
        fov: camera.fov,
      });

      if (projected.visible) {
        points.push({ x: projected.x, y: projected.y });
      }
    }
  });

  const screenEdgePoints = [
    ...Array.from({ length: screenEdgeSteps + 1 }, (_, index) => ({
      x: (rect.width * index) / screenEdgeSteps,
      y: 0,
    })),
    ...Array.from({ length: screenEdgeSteps + 1 }, (_, index) => ({
      x: rect.width,
      y: (rect.height * index) / screenEdgeSteps,
    })),
    ...Array.from({ length: screenEdgeSteps + 1 }, (_, index) => ({
      x: rect.width - (rect.width * index) / screenEdgeSteps,
      y: rect.height,
    })),
    ...Array.from({ length: screenEdgeSteps + 1 }, (_, index) => ({
      x: 0,
      y: rect.height - (rect.height * index) / screenEdgeSteps,
    })),
  ];

  screenEdgePoints.forEach((screenPoint) => {
    const panoramaPoint = screenPointToYawPitch({
      ...screenPoint,
      width: rect.width,
      height: rect.height,
      cameraYaw: camera.yaw,
      cameraPitch: camera.pitch,
      fov: camera.fov,
    });

    if (pointIsInsideSampledAoi(panoramaPoint)) {
      points.push(screenPoint);
    }
  });

  const hull = buildConvexHull(points);

  return hull.length >= 3 ? clipPolygonToRect(hull, rect.width, rect.height) : null;
}

export function projectAoiRange(aoi, yawMin, yawMax, rect, camera, options = {}) {
  const pitchMin = Math.min(aoi.pitchMin, aoi.pitchMax);
  const pitchMax = Math.max(aoi.pitchMin, aoi.pitchMax);
  const corners = [
    { yaw: yawMin, pitch: pitchMax },
    { yaw: yawMax, pitch: pitchMax },
    { yaw: yawMax, pitch: pitchMin },
    { yaw: yawMin, pitch: pitchMin },
  ].map((corner) => panoramaPointToScreen({
    ...corner,
    width: rect.width,
    height: rect.height,
    cameraYaw: camera.yaw,
    cameraPitch: camera.pitch,
    fov: camera.fov,
  }));

  if (!corners.every((corner) => corner.inFront && Number.isFinite(corner.x) && Number.isFinite(corner.y))) {
    return projectVisibleAoiSamples(aoi, yawMin, yawMax, rect, camera, options);
  }

  const clipped = clipPolygonToRect(corners, rect.width, rect.height);

  if (clipped.length < 3) {
    return projectVisibleAoiSamples(aoi, yawMin, yawMax, rect, camera, options);
  }

  return clipped;
}

function offsetPoint(point, rect) {
  return {
    x: point.x + (rect.x || 0),
    y: point.y + (rect.y || 0),
  };
}

export function projectVideoAoiRange(aoi, rect) {
  const xMin = Math.min(aoi.xMin, aoi.xMax) * rect.width;
  const xMax = Math.max(aoi.xMin, aoi.xMax) * rect.width;
  const yMin = Math.min(aoi.yMin, aoi.yMax) * rect.height;
  const yMax = Math.max(aoi.yMin, aoi.yMax) * rect.height;

  return [
    { x: xMin, y: yMin },
    { x: xMax, y: yMin },
    { x: xMax, y: yMax },
    { x: xMin, y: yMax },
  ].map((point) => offsetPoint(point, rect));
}

export function projectVideoPolygon(aoi, rect) {
  return (aoi.points || []).map((point) => ({
    x: point.x * rect.width + (rect.x || 0),
    y: point.y * rect.height + (rect.y || 0),
  }));
}

export function projectPanoramaPolygon(aoi, rect, camera, {
  maxPolygonPoints = MAX_PANORAMA_POLYGON_OVERLAY_POINTS,
  screenEdgeSteps = 32,
  edgeStepDegrees = 4,
} = {}) {
  const sourcePoints = sampleClosedPolygonPoints(aoi.points, maxPolygonPoints);
  const points = sourcePoints.map((point) => panoramaPointToScreen({
    yaw: point.yaw,
    pitch: point.pitch,
    width: rect.width,
    height: rect.height,
    cameraYaw: camera.yaw,
    cameraPitch: camera.pitch,
    fov: camera.fov,
  }));

  if (!points.every((point) => point.inFront && Number.isFinite(point.x) && Number.isFinite(point.y))) {
    return projectVisiblePanoramaPolygonSamples(aoi, rect, camera, {
      maxPolygonPoints,
      screenEdgeSteps,
      edgeStepDegrees,
    });
  }

  const clipped = clipPolygonToRect(points, rect.width, rect.height);

  return clipped.length >= 3
    ? clipped
    : projectVisiblePanoramaPolygonSamples(aoi, rect, camera, {
      maxPolygonPoints,
      screenEdgeSteps,
      edgeStepDegrees,
    });
}

export function getAoiOverlayColor(aoi, supportsColor = null) {
  if (typeof aoi.color !== 'string' || !aoi.color.trim()) {
    return DEFAULT_AOI_OVERLAY_COLOR;
  }

  if (!supportsColor) {
    return aoi.color;
  }

  try {
    return supportsColor(aoi.color) ? aoi.color : DEFAULT_AOI_OVERLAY_COLOR;
  } catch {
    return DEFAULT_AOI_OVERLAY_COLOR;
  }
}

function getAoiOverlayFillOpacity(aoi) {
  return isGeneratedOverlayTrack(aoi)
    ? GENERATED_AOI_OVERLAY_FILL_OPACITY
    : DEFAULT_AOI_OVERLAY_FILL_OPACITY;
}

export function isScreenSpanningOverlayArtifact(model, rect) {
  if (!model?.generated || !Array.isArray(model.points) || model.points.length < 3) {
    return false;
  }

  const width = Number(rect?.width);
  const height = Number(rect?.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return false;
  }

  const bounds = model.points.reduce((current, point) => ({
    minX: Math.min(current.minX, point.x),
    maxX: Math.max(current.maxX, point.x),
    minY: Math.min(current.minY, point.y),
    maxY: Math.max(current.maxY, point.y),
  }), {
    minX: Infinity,
    maxX: -Infinity,
    minY: Infinity,
    maxY: -Infinity,
  });
  const touchesBothHorizontalEdges = bounds.minX <= 1 && bounds.maxX >= width - 1;
  const touchesBothVerticalEdges = bounds.minY <= 1 && bounds.maxY >= height - 1;

  return model.points.some((point, index) => {
    const next = model.points[(index + 1) % model.points.length];
    const horizontalEdgeSpan = Math.abs(point.x - next.x);
    const verticalEdgeSpan = Math.abs(point.y - next.y);
    const nearSameY = Math.abs(point.y - next.y) <= Math.max(1, height * 0.05);
    const nearSameX = Math.abs(point.x - next.x) <= Math.max(1, width * 0.05);
    const onHorizontalScreenEdge = (
      Math.abs(point.y) <= 1 && Math.abs(next.y) <= 1
    ) || (
      Math.abs(point.y - height) <= 1 && Math.abs(next.y - height) <= 1
    );
    const onVerticalScreenEdge = (
      Math.abs(point.x) <= 1 && Math.abs(next.x) <= 1
    ) || (
      Math.abs(point.x - width) <= 1 && Math.abs(next.x - width) <= 1
    );

    return (
      (nearSameY && onHorizontalScreenEdge && horizontalEdgeSpan >= width * 0.9) ||
      (nearSameX && onVerticalScreenEdge && verticalEdgeSpan >= height * 0.9) ||
      (nearSameY && touchesBothHorizontalEdges && horizontalEdgeSpan >= width * 0.9) ||
      (nearSameX && touchesBothVerticalEdges && verticalEdgeSpan >= height * 0.9)
    );
  });
}

function getVideoAoiLabelPoint(aoi, rect) {
  return {
    x: Math.round((rect.x || 0) + Math.min(aoi.xMax, 0.96) * rect.width + 8),
    y: Math.round((rect.y || 0) + Math.max(aoi.yMin, 0.04) * rect.height - 8),
  };
}

function getPanoramaAoiLabelPoint(aoi, range, rect, camera) {
  const pitchMin = Math.min(aoi.pitchMin, aoi.pitchMax);
  const pitchMax = Math.max(aoi.pitchMin, aoi.pitchMax);
  const center = panoramaPointToScreen({
    yaw: normalizeYaw((range.yawMin + range.yawMax) / 2),
    pitch: (pitchMin + pitchMax) / 2,
    width: rect.width,
    height: rect.height,
    cameraYaw: camera.yaw,
    cameraPitch: camera.pitch,
    fov: camera.fov,
  });

  if (!center.visible) {
    return null;
  }

  return {
    x: Math.round(center.x + 8),
    y: Math.round(center.y - 8),
  };
}

export function buildAoiOverlayModels({
  aois,
  rect,
  videoRect = null,
  camera,
  supportsColor = null,
  dragMode = false,
}) {
  const videoProjectionRect = videoRect || rect;
  const projectionOptions = dragMode
    ? {
      maxPolygonPoints: MAX_DRAG_PANORAMA_POLYGON_OVERLAY_POINTS,
      screenEdgeSteps: 8,
      edgeStepDegrees: 10,
      rangeYawStepDegrees: 12,
      rangePitchStepDegrees: 8,
    }
    : {};

  const models = (aois ?? []).flatMap((aoi) => {
    const color = getAoiOverlayColor(aoi, supportsColor);
    const fillOpacity = getAoiOverlayFillOpacity(aoi);
    const generated = isGeneratedOverlayTrack(aoi);

    if (aoi.shape === 'polygon') {
      const points = aoi.space === 'video'
        ? projectVideoPolygon(aoi, videoProjectionRect)
        : projectPanoramaPolygon(aoi, rect, camera, projectionOptions);

      return points && points.length >= 3 ? [{
        id: aoi.id,
        label: aoi.label,
        color,
        fillOpacity,
        generated,
        points,
        labelPoint: dragMode ? null : points[0],
      }] : [];
    }

    if (aoi.space === 'video') {
      const points = projectVideoAoiRange(aoi, videoProjectionRect);
      return [{
        id: aoi.id,
        label: aoi.label,
        color,
        fillOpacity,
        generated,
        points,
        labelPoint: dragMode ? null : getVideoAoiLabelPoint(aoi, videoProjectionRect),
      }];
    }

    return splitAoiYawRanges(aoi)
      .map((range) => {
        const points = projectAoiRange(aoi, range.yawMin, range.yawMax, rect, camera, projectionOptions);
        const labelPoint = dragMode ? null : getPanoramaAoiLabelPoint(aoi, range, rect, camera);
        return points ? {
          id: aoi.id,
          label: aoi.label,
          color,
          fillOpacity,
          generated,
          points,
          labelPoint,
        } : null;
      })
      .filter(Boolean);
  });

  return models.filter((model) => !isScreenSpanningOverlayArtifact(model, rect));
}
