import {
  normalizeYaw,
  panoramaPointToScreen,
} from './aoiMath.js';

const DEFAULT_AOI_OVERLAY_COLOR = '#ffd166';

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

export function projectAoiRange(aoi, yawMin, yawMax, rect, camera) {
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
    return null;
  }

  const clipped = clipPolygonToRect(corners, rect.width, rect.height);

  if (clipped.length < 3) {
    return null;
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

export function projectPanoramaPolygon(aoi, rect, camera) {
  const points = (aoi.points || []).map((point) => panoramaPointToScreen({
    yaw: point.yaw,
    pitch: point.pitch,
    width: rect.width,
    height: rect.height,
    cameraYaw: camera.yaw,
    cameraPitch: camera.pitch,
    fov: camera.fov,
  }));

  if (!points.every((point) => point.inFront && Number.isFinite(point.x) && Number.isFinite(point.y))) {
    return null;
  }

  return clipPolygonToRect(points, rect.width, rect.height);
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
}) {
  const videoProjectionRect = videoRect || rect;

  return (aois ?? []).flatMap((aoi) => {
    const color = getAoiOverlayColor(aoi, supportsColor);

    if (aoi.shape === 'polygon') {
      const points = aoi.space === 'video'
        ? projectVideoPolygon(aoi, videoProjectionRect)
        : projectPanoramaPolygon(aoi, rect, camera);

      return points && points.length >= 3 ? [{
        id: aoi.id,
        label: aoi.label,
        color,
        points,
        labelPoint: points[0],
      }] : [];
    }

    if (aoi.space === 'video') {
      const points = projectVideoAoiRange(aoi, videoProjectionRect);
      return [{
        id: aoi.id,
        label: aoi.label,
        color,
        points,
        labelPoint: getVideoAoiLabelPoint(aoi, videoProjectionRect),
      }];
    }

    return splitAoiYawRanges(aoi)
      .map((range) => {
        const points = projectAoiRange(aoi, range.yawMin, range.yawMax, rect, camera);
        const labelPoint = getPanoramaAoiLabelPoint(aoi, range, rect, camera);
        return points ? {
          id: aoi.id,
          label: aoi.label,
          color,
          points,
          labelPoint,
        } : null;
      })
      .filter(Boolean);
  });
}
