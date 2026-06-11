const DEFAULT_POINT_KEYS = { x: 'x', y: 'y' };
const EDGE_EPSILON = 1e-12;
const HALF_TURN = 180;
const FULL_TURN = 360;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function finiteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function positiveFiniteNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
}

function normalizePaddingDimensions(dimensions) {
  const source = dimensions?.viewport || dimensions || {};
  const width = positiveFiniteNumber(source.width);
  const height = positiveFiniteNumber(source.height);

  return width > 0 && height > 0 ? { width, height } : null;
}

function analysisPaddingPxToAoiUnits(aoi, dimensions) {
  const paddingPx = positiveFiniteNumber(aoi?.analysisPaddingPx);
  const viewport = normalizePaddingDimensions(dimensions);

  if (paddingPx <= 0 || !viewport) {
    return 0;
  }

  if (aoi?.space === 'video') {
    return paddingPx / Math.min(viewport.width, viewport.height);
  }

  return Math.max(
    (paddingPx / viewport.width) * FULL_TURN,
    (paddingPx / viewport.height) * HALF_TURN,
  );
}

export function getEffectiveAnalysisPadding(aoi, dimensions) {
  const explicitPadding = Number(aoi?.analysisPadding);

  if (Number.isFinite(explicitPadding)) {
    return Math.max(0, explicitPadding);
  }

  return analysisPaddingPxToAoiUnits(aoi, dimensions);
}

function roundCoordinate(value) {
  return Number(value.toFixed(6));
}

function normalizeYaw(degrees) {
  const normalized = ((((degrees + HALF_TURN) % FULL_TURN) + FULL_TURN) % FULL_TURN) - HALF_TURN;
  return normalized === -HALF_TURN && degrees > 0 ? HALF_TURN : normalized;
}

function shortestYawDelta(start, end) {
  return normalizeYaw(end - start);
}

function normalizeCoordinate(value, key) {
  if (key === 'yaw') {
    return roundCoordinate(clamp(finiteNumber(value), -180, 180));
  }

  if (key === 'pitch') {
    return roundCoordinate(clamp(finiteNumber(value), -90, 90));
  }

  return roundCoordinate(clamp(finiteNumber(value), 0, 1));
}

function resolvePointKeys(keys = DEFAULT_POINT_KEYS) {
  return {
    x: keys.x || DEFAULT_POINT_KEYS.x,
    y: keys.y || DEFAULT_POINT_KEYS.y,
  };
}

function isFiniteCoordinateValue(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function hasFiniteCoordinate(point, key) {
  return (
    point != null &&
    isFiniteCoordinateValue(point[key])
  );
}

function isFinitePoint(point, keys = DEFAULT_POINT_KEYS) {
  const pointKeys = resolvePointKeys(keys);

  return (
    hasFiniteCoordinate(point, pointKeys.x) &&
    hasFiniteCoordinate(point, pointKeys.y)
  );
}

function toFinitePoint(point, keys = DEFAULT_POINT_KEYS) {
  const pointKeys = resolvePointKeys(keys);

  return {
    x: point[pointKeys.x],
    y: point[pointKeys.y],
  };
}

function isYawKeySet(keys) {
  return keys.x === 'yaw';
}

function unwrapYawPolygon(polygon) {
  if (!polygon.length) {
    return [];
  }

  const unwrapped = [{ ...polygon[0] }];
  let previousRawYaw = polygon[0].x;

  for (let index = 1; index < polygon.length; index += 1) {
    const current = polygon[index];
    const previous = unwrapped[unwrapped.length - 1];
    const delta = shortestYawDelta(previousRawYaw, current.x);

    unwrapped.push({
      ...current,
      x: roundCoordinate(previous.x + delta),
    });
    previousRawYaw = current.x;
  }

  return unwrapped;
}

function shiftPointXNearPolygon(point, polygon) {
  if (!polygon.length) {
    return point;
  }

  const centerX = polygon.reduce((sum, polygonPoint) => sum + polygonPoint.x, 0) / polygon.length;
  let x = point.x;

  while (x - centerX > HALF_TURN) {
    x -= FULL_TURN;
  }

  while (x - centerX < -HALF_TURN) {
    x += FULL_TURN;
  }

  return {
    ...point,
    x,
  };
}

function preparePolygonGeometry(point, points, keys = DEFAULT_POINT_KEYS) {
  const pointKeys = resolvePointKeys(keys);

  if (!isFinitePoint(point, pointKeys) || !Array.isArray(points)) {
    return null;
  }

  let target = toFinitePoint(point, pointKeys);
  let polygon = points
    .filter((polygonPoint) => isFinitePoint(polygonPoint, pointKeys))
    .map((polygonPoint) => toFinitePoint(polygonPoint, pointKeys));

  if (isYawKeySet(pointKeys)) {
    polygon = unwrapYawPolygon(polygon);
    target = shiftPointXNearPolygon(target, polygon);
  }

  return { target, polygon };
}

function distanceToSegment(point, start, end) {
  const segmentX = end.x - start.x;
  const segmentY = end.y - start.y;
  const lengthSquared = segmentX * segmentX + segmentY * segmentY;

  if (lengthSquared <= 0) {
    return Math.hypot(point.x - start.x, point.y - start.y);
  }

  const ratio = clamp(
    ((point.x - start.x) * segmentX + (point.y - start.y) * segmentY) / lengthSquared,
    0,
    1,
  );
  const closest = {
    x: start.x + segmentX * ratio,
    y: start.y + segmentY * ratio,
  };

  return Math.hypot(point.x - closest.x, point.y - closest.y);
}

function distanceToPreparedPolygonEdges(point, polygon) {
  let minDistance = Infinity;

  for (let index = 0; index < polygon.length; index += 1) {
    const start = polygon[index];
    const end = polygon[(index + 1) % polygon.length];
    minDistance = Math.min(minDistance, distanceToSegment(point, start, end));
  }

  return minDistance;
}

export function normalizePolygonPoints(points, keys = DEFAULT_POINT_KEYS) {
  if (!Array.isArray(points)) {
    return [];
  }

  const pointKeys = resolvePointKeys(keys);

  return points
    .filter((point) => (
      hasFiniteCoordinate(point, pointKeys.x) &&
      hasFiniteCoordinate(point, pointKeys.y)
    ))
    .map((point) => {
      const normalized = {};
      normalized[pointKeys.x] = normalizeCoordinate(point?.[pointKeys.x], pointKeys.x);
      normalized[pointKeys.y] = normalizeCoordinate(point?.[pointKeys.y], pointKeys.y);

      return normalized;
    });
}

export function boundsFromPoints(points, keys = DEFAULT_POINT_KEYS) {
  const pointKeys = resolvePointKeys(keys);
  const finitePoints = Array.isArray(points)
    ? points.filter((point) => (
      hasFiniteCoordinate(point, pointKeys.x) &&
      hasFiniteCoordinate(point, pointKeys.y)
    ))
    : [];
  const minXKey = `${pointKeys.x}Min`;
  const maxXKey = `${pointKeys.x}Max`;
  const minYKey = `${pointKeys.y}Min`;
  const maxYKey = `${pointKeys.y}Max`;

  if (!finitePoints.length) {
    return {
      [minXKey]: 0,
      [maxXKey]: 0,
      [minYKey]: 0,
      [maxYKey]: 0,
    };
  }

  const xs = finitePoints.map((point) => point[pointKeys.x]);
  const ys = finitePoints.map((point) => point[pointKeys.y]);

  return {
    [minXKey]: roundCoordinate(Math.min(...xs)),
    [maxXKey]: roundCoordinate(Math.max(...xs)),
    [minYKey]: roundCoordinate(Math.min(...ys)),
    [maxYKey]: roundCoordinate(Math.max(...ys)),
  };
}

export function distanceToPolygonEdges(point, points, keys = DEFAULT_POINT_KEYS) {
  const geometry = preparePolygonGeometry(point, points, keys);

  if (!geometry || geometry.polygon.length < 2) {
    return Infinity;
  }

  return distanceToPreparedPolygonEdges(geometry.target, geometry.polygon);
}

export function isPointInPolygon(point, points, keys = DEFAULT_POINT_KEYS) {
  const geometry = preparePolygonGeometry(point, points, keys);

  if (!geometry || geometry.polygon.length < 3) {
    return false;
  }

  const { target, polygon } = geometry;

  if (distanceToPreparedPolygonEdges(target, polygon) <= EDGE_EPSILON) {
    return true;
  }

  let inside = false;

  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const currentPoint = polygon[index];
    const previousPoint = polygon[previous];
    const crossesRay = (
      (currentPoint.y > target.y) !== (previousPoint.y > target.y) &&
      target.x < (
        ((previousPoint.x - currentPoint.x) * (target.y - currentPoint.y)) /
        (previousPoint.y - currentPoint.y) +
        currentPoint.x
      )
    );

    if (crossesRay) {
      inside = !inside;
    }
  }

  return inside;
}

function pointKeysForAoi(aoi) {
  return aoi?.space === 'video'
    ? DEFAULT_POINT_KEYS
    : { x: 'yaw', y: 'pitch' };
}

export function pointHitsPolygonAoi(point, aoi, dimensions) {
  const pointKeys = pointKeysForAoi(aoi);

  if (!isFinitePoint(point, pointKeys)) {
    return false;
  }

  const points = normalizePolygonPoints(aoi?.points || [], pointKeys);

  if (points.length < 3) {
    return false;
  }

  if (isPointInPolygon(point, points, pointKeys)) {
    return true;
  }

  const padding = getEffectiveAnalysisPadding(aoi, dimensions);
  return padding > 0 && distanceToPolygonEdges(point, points, pointKeys) <= padding;
}

export function interpolatePolygonPoints(startPoints, endPoints, ratio, keys = DEFAULT_POINT_KEYS) {
  const pointKeys = resolvePointKeys(keys);
  const start = normalizePolygonPoints(startPoints, pointKeys);
  const end = normalizePolygonPoints(endPoints, pointKeys);
  const safeRatio = clamp(finiteNumber(ratio), 0, 1);

  if (start.length !== end.length) {
    return safeRatio < 0.5 ? start : end;
  }

  return start.map((startPoint, index) => {
    const endPoint = end[index];
    const startX = startPoint[pointKeys.x];
    const endX = endPoint[pointKeys.x];
    const interpolatedX = isYawKeySet(pointKeys)
      ? normalizeYaw(startX + shortestYawDelta(startX, endX) * safeRatio)
      : startX + (endX - startX) * safeRatio;

    return normalizePolygonPoints([{
      [pointKeys.x]: roundCoordinate(interpolatedX),
      [pointKeys.y]: roundCoordinate(
        startPoint[pointKeys.y] + (endPoint[pointKeys.y] - startPoint[pointKeys.y]) * safeRatio,
      ),
    }], pointKeys)[0];
  });
}
