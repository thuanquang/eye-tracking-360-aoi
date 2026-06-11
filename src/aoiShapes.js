const DEFAULT_POINT_KEYS = { x: 'x', y: 'y' };
const EDGE_EPSILON = 1e-12;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function finiteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function roundCoordinate(value) {
  return Number(value.toFixed(6));
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

function hasCoordinate(point, key) {
  return Object.prototype.hasOwnProperty.call(point, key);
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
      const normalized = { ...point };
      normalized[pointKeys.x] = normalizeCoordinate(point?.[pointKeys.x], pointKeys.x);
      normalized[pointKeys.y] = normalizeCoordinate(point?.[pointKeys.y], pointKeys.y);

      ['x', 'y', 'yaw', 'pitch'].forEach((key) => {
        if (
          key !== pointKeys.x &&
          key !== pointKeys.y &&
          hasCoordinate(normalized, key) &&
          isFiniteCoordinateValue(normalized[key])
        ) {
          normalized[key] = normalizeCoordinate(normalized[key], key);
        }
      });

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
  const pointKeys = resolvePointKeys(keys);

  if (!isFinitePoint(point, pointKeys) || !Array.isArray(points) || points.length < 2) {
    return Infinity;
  }

  const target = toFinitePoint(point, pointKeys);
  const polygon = points
    .filter((polygonPoint) => isFinitePoint(polygonPoint, pointKeys))
    .map((polygonPoint) => toFinitePoint(polygonPoint, pointKeys));

  if (polygon.length < 2) {
    return Infinity;
  }

  let minDistance = Infinity;

  for (let index = 0; index < polygon.length; index += 1) {
    const start = polygon[index];
    const end = polygon[(index + 1) % polygon.length];
    minDistance = Math.min(minDistance, distanceToSegment(target, start, end));
  }

  return minDistance;
}

export function isPointInPolygon(point, points, keys = DEFAULT_POINT_KEYS) {
  const pointKeys = resolvePointKeys(keys);

  if (!isFinitePoint(point, pointKeys) || !Array.isArray(points) || points.length < 3) {
    return false;
  }

  const target = toFinitePoint(point, pointKeys);
  const polygon = points
    .filter((polygonPoint) => isFinitePoint(polygonPoint, pointKeys))
    .map((polygonPoint) => toFinitePoint(polygonPoint, pointKeys));

  if (polygon.length < 3) {
    return false;
  }

  if (distanceToPolygonEdges(target, polygon) <= EDGE_EPSILON) {
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

export function pointHitsPolygonAoi(point, aoi) {
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

  const padding = Math.max(0, finiteNumber(aoi?.analysisPadding));
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

    return normalizePolygonPoints([{
      [pointKeys.x]: roundCoordinate(
        startPoint[pointKeys.x] + (endPoint[pointKeys.x] - startPoint[pointKeys.x]) * safeRatio,
      ),
      [pointKeys.y]: roundCoordinate(
        startPoint[pointKeys.y] + (endPoint[pointKeys.y] - startPoint[pointKeys.y]) * safeRatio,
      ),
    }], pointKeys)[0];
  });
}
