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

function isFinitePoint(point) {
  return (
    Number.isFinite(Number(point?.x)) &&
    Number.isFinite(Number(point?.y))
  );
}

function toFinitePoint(point) {
  return {
    x: finiteNumber(point.x),
    y: finiteNumber(point.y),
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

  return points.map((point) => {
    const normalized = { ...point };
    normalized[pointKeys.x] = normalizeCoordinate(point?.[pointKeys.x], pointKeys.x);
    normalized[pointKeys.y] = normalizeCoordinate(point?.[pointKeys.y], pointKeys.y);

    ['x', 'y', 'yaw', 'pitch'].forEach((key) => {
      if (key !== pointKeys.x && key !== pointKeys.y && hasCoordinate(normalized, key)) {
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
      Number.isFinite(Number(point?.[pointKeys.x])) &&
      Number.isFinite(Number(point?.[pointKeys.y]))
    ))
    : [];

  if (!finitePoints.length) {
    return {
      xMin: 0,
      xMax: 0,
      yMin: 0,
      yMax: 0,
    };
  }

  const xs = finitePoints.map((point) => finiteNumber(point[pointKeys.x]));
  const ys = finitePoints.map((point) => finiteNumber(point[pointKeys.y]));

  return {
    xMin: roundCoordinate(Math.min(...xs)),
    xMax: roundCoordinate(Math.max(...xs)),
    yMin: roundCoordinate(Math.min(...ys)),
    yMax: roundCoordinate(Math.max(...ys)),
  };
}

export function distanceToPolygonEdges(point, points) {
  if (!isFinitePoint(point) || !Array.isArray(points) || points.length < 2) {
    return Infinity;
  }

  const target = toFinitePoint(point);
  const polygon = points.filter(isFinitePoint).map(toFinitePoint);

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

export function isPointInPolygon(point, points) {
  if (!isFinitePoint(point) || !Array.isArray(points) || points.length < 3) {
    return false;
  }

  const target = toFinitePoint(point);
  const polygon = points.filter(isFinitePoint).map(toFinitePoint);

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

export function pointHitsPolygonAoi(point, aoi) {
  if (!isFinitePoint(point)) {
    return false;
  }

  const points = normalizePolygonPoints(aoi?.points || []);

  if (points.length < 3) {
    return false;
  }

  if (isPointInPolygon(point, points)) {
    return true;
  }

  const padding = Math.max(0, finiteNumber(aoi?.analysisPadding));
  return padding > 0 && distanceToPolygonEdges(point, points) <= padding;
}

export function interpolatePolygonPoints(startPoints, endPoints, ratio) {
  const start = normalizePolygonPoints(startPoints);
  const end = normalizePolygonPoints(endPoints);
  const safeRatio = clamp(finiteNumber(ratio), 0, 1);

  if (start.length !== end.length) {
    return safeRatio < 0.5 ? start : end;
  }

  return start.map((startPoint, index) => {
    const endPoint = end[index];

    return normalizePolygonPoints([{
      x: roundCoordinate(startPoint.x + (endPoint.x - startPoint.x) * safeRatio),
      y: roundCoordinate(startPoint.y + (endPoint.y - startPoint.y) * safeRatio),
    }])[0];
  });
}
