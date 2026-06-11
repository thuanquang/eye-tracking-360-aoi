import {
  interpolatePolygonPoints,
  pointHitsPolygonAoi,
} from './aoiShapes.js';

const HALF_TURN = 180;
const FULL_TURN = 360;

function degreesToRadians(degrees) {
  return (degrees * Math.PI) / 180;
}

function radiansToDegrees(radians) {
  return (radians * 180) / Math.PI;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function dot(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function cross(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function normalizeVector(vector) {
  const length = Math.hypot(vector.x, vector.y, vector.z);

  if (length <= 0) {
    return { x: 0, y: 0, z: -1 };
  }

  return {
    x: vector.x / length,
    y: vector.y / length,
    z: vector.z / length,
  };
}

function quaternionFromThreeYXZ(cameraYaw, cameraPitch) {
  const x = degreesToRadians(cameraPitch);
  const y = degreesToRadians(cameraYaw);
  const c1 = Math.cos(x / 2);
  const c2 = Math.cos(y / 2);
  const s1 = Math.sin(x / 2);
  const s2 = Math.sin(y / 2);

  return {
    x: s1 * c2,
    y: c1 * s2,
    z: -s1 * s2,
    w: c1 * c2,
  };
}

function rotateVectorByQuaternion(vector, quaternion) {
  const { x, y, z, w } = quaternion;
  const ix = w * vector.x + y * vector.z - z * vector.y;
  const iy = w * vector.y + z * vector.x - x * vector.z;
  const iz = w * vector.z + x * vector.y - y * vector.x;
  const iw = -x * vector.x - y * vector.y - z * vector.z;

  return {
    x: ix * w + iw * -x + iy * -z - iz * -y,
    y: iy * w + iw * -y + iz * -x - ix * -z,
    z: iz * w + iw * -z + ix * -y - iy * -x,
  };
}

function vectorFromYawPitch(yaw, pitch) {
  const yawRad = degreesToRadians(yaw);
  const pitchRad = degreesToRadians(pitch);
  const pitchCos = Math.cos(pitchRad);

  return {
    x: Math.sin(yawRad) * pitchCos,
    y: Math.sin(pitchRad),
    z: -Math.cos(yawRad) * pitchCos,
  };
}

function yawPitchFromVector(vector) {
  const normalized = normalizeVector(vector);

  return {
    yaw: normalizeYaw(radiansToDegrees(Math.atan2(normalized.x, -normalized.z))),
    pitch: clamp(radiansToDegrees(Math.atan2(
      normalized.y,
      Math.hypot(normalized.x, normalized.z),
    )), -90, 90),
  };
}

function cameraBasisFromYawPitch(cameraYaw, cameraPitch) {
  const quaternion = quaternionFromThreeYXZ(cameraYaw, cameraPitch);
  const forward = normalizeVector(rotateVectorByQuaternion({ x: 0, y: 0, z: -1 }, quaternion));
  const right = normalizeVector(rotateVectorByQuaternion({ x: 1, y: 0, z: 0 }, quaternion));
  const up = normalizeVector(cross(right, forward));

  return { forward, right, up };
}

export function normalizeYaw(degrees) {
  const normalized = ((((degrees + HALF_TURN) % FULL_TURN) + FULL_TURN) % FULL_TURN) - HALF_TURN;
  return normalized === -HALF_TURN && degrees > 0 ? HALF_TURN : normalized;
}

export function screenPointToYawPitch({
  x,
  y,
  width,
  height,
  cameraYaw = 0,
  cameraPitch = 0,
  fov = 75,
}) {
  if (width <= 0 || height <= 0) {
    throw new Error('Viewport width and height must be positive.');
  }

  const ndcX = (x / width) * 2 - 1;
  const ndcY = 1 - (y / height) * 2;
  const aspect = width / height;
  const tanHalfFov = Math.tan(degreesToRadians(fov) / 2);
  const rayX = ndcX * aspect * tanHalfFov;
  const rayY = ndcY * tanHalfFov;
  const { forward, right, up } = cameraBasisFromYawPitch(cameraYaw, cameraPitch);
  const worldRay = normalizeVector({
    x: forward.x + right.x * rayX + up.x * rayY,
    y: forward.y + right.y * rayX + up.y * rayY,
    z: forward.z + right.z * rayX + up.z * rayY,
  });

  return yawPitchFromVector(worldRay);
}

export function panoramaPointToScreen({
  yaw,
  pitch,
  width,
  height,
  cameraYaw = 0,
  cameraPitch = 0,
  fov = 75,
}) {
  if (width <= 0 || height <= 0) {
    throw new Error('Viewport width and height must be positive.');
  }

  const aspect = width / height;
  const tanHalfFov = Math.tan(degreesToRadians(fov) / 2);
  const point = vectorFromYawPitch(yaw, pitch);
  const { forward, right, up } = cameraBasisFromYawPitch(cameraYaw, cameraPitch);
  const depth = dot(point, forward);

  if (depth <= 0) {
    return { x: 0, y: 0, visible: false, inFront: false };
  }

  const rayX = dot(point, right) / depth;
  const rayY = dot(point, up) / depth;
  const ndcX = rayX / (aspect * tanHalfFov);
  const ndcY = rayY / tanHalfFov;
  const x = ((ndcX + 1) / 2) * width;
  const y = ((1 - ndcY) / 2) * height;
  const visible = (
    Number.isFinite(x) &&
    Number.isFinite(y) &&
    x >= 0 &&
    x <= width &&
    y >= 0 &&
    y <= height
  );

  return { x, y, visible, inFront: true };
}

function yawInRange(yaw, yawMin, yawMax) {
  const normalizedYaw = normalizeYaw(yaw);
  const min = normalizeYaw(yawMin);
  const max = normalizeYaw(yawMax);

  if (min <= max) {
    return normalizedYaw >= min && normalizedYaw <= max;
  }

  return normalizedYaw >= min || normalizedYaw <= max;
}

export function screenPointToVideoPoint({ x, y, width, height }) {
  if (width <= 0 || height <= 0) {
    throw new Error('Viewport width and height must be positive.');
  }

  return {
    x: clamp(x / width, 0, 1),
    y: clamp(y / height, 0, 1),
  };
}

function getAoiSpace(aoi) {
  return aoi?.space === 'video' ? 'video' : 'panorama';
}

function getPolygonPointKeys(aoi) {
  return getAoiSpace(aoi) === 'video'
    ? { x: 'x', y: 'y' }
    : { x: 'yaw', y: 'pitch' };
}

function hitTestPanoramaAoi(point, aoi) {
  const pitchMin = Math.min(aoi.pitchMin, aoi.pitchMax);
  const pitchMax = Math.max(aoi.pitchMin, aoi.pitchMax);

  return (
    Number.isFinite(point?.yaw) &&
    Number.isFinite(point?.pitch) &&
    yawInRange(point.yaw, aoi.yawMin, aoi.yawMax) &&
    point.pitch >= pitchMin &&
    point.pitch <= pitchMax
  );
}

function hitTestVideoAoi(point, aoi) {
  const xMin = Math.min(aoi.xMin, aoi.xMax);
  const xMax = Math.max(aoi.xMin, aoi.xMax);
  const yMin = Math.min(aoi.yMin, aoi.yMax);
  const yMax = Math.max(aoi.yMin, aoi.yMax);

  return (
    Number.isFinite(point?.x) &&
    Number.isFinite(point?.y) &&
    point.x >= xMin &&
    point.x <= xMax &&
    point.y >= yMin &&
    point.y <= yMax
  );
}

export function hitTestAois(point, aois) {
  return aois.filter((aoi) => {
    if (aoi.shape === 'polygon') {
      return pointHitsPolygonAoi(point, aoi);
    }

    return getAoiSpace(aoi) === 'video'
      ? hitTestVideoAoi(point, aoi)
      : hitTestPanoramaAoi(point, aoi);
  });
}

function interpolateLinear(start, end, ratio) {
  return start + (end - start) * ratio;
}

function roundCoordinate(value) {
  return Number(value.toFixed(6));
}

function interpolateYaw(start, end, ratio) {
  return normalizeYaw(start + normalizeYaw(end - start) * ratio);
}

function findAoiKeyframePair(keyframes, timeSec) {
  const sorted = [...keyframes]
    .filter((keyframe) => Number.isFinite(keyframe?.t))
    .sort((a, b) => a.t - b.t);

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

function resolveDynamicAoiAtTime(aoi, timeSec) {
  const pair = findAoiKeyframePair(aoi.keyframes, timeSec);

  if (!pair) {
    return { ...aoi };
  }

  const [start, end] = pair;
  const duration = end.t - start.t;
  const ratio = duration > 0 ? (timeSec - start.t) / duration : 0;

  if (aoi.shape === 'polygon') {
    const pointKeys = getPolygonPointKeys(aoi);

    return {
      ...aoi,
      points: interpolatePolygonPoints(start.points || [], end.points || [], ratio, pointKeys),
    };
  }

  if (getAoiSpace(aoi) === 'video') {
    return {
      ...aoi,
      xMin: roundCoordinate(interpolateLinear(start.xMin, end.xMin, ratio)),
      xMax: roundCoordinate(interpolateLinear(start.xMax, end.xMax, ratio)),
      yMin: roundCoordinate(interpolateLinear(start.yMin, end.yMin, ratio)),
      yMax: roundCoordinate(interpolateLinear(start.yMax, end.yMax, ratio)),
    };
  }

  return {
    ...aoi,
    yawMin: interpolateYaw(start.yawMin, end.yawMin, ratio),
    yawMax: interpolateYaw(start.yawMax, end.yawMax, ratio),
    pitchMin: interpolateLinear(start.pitchMin, end.pitchMin, ratio),
    pitchMax: interpolateLinear(start.pitchMax, end.pitchMax, ratio),
  };
}

export function resolveAoisAtTime(aois, timeSec = 0) {
  const safeTime = Number.isFinite(timeSec) ? timeSec : 0;

  return aois.map((aoi) => (
    Array.isArray(aoi.keyframes) && aoi.keyframes.length
      ? resolveDynamicAoiAtTime(aoi, safeTime)
      : { ...aoi }
  ));
}

function angularDistance(a, b) {
  return Math.abs(normalizeYaw(a - b));
}

function distanceToYawRange(yaw, yawMin, yawMax) {
  if (yawInRange(yaw, yawMin, yawMax)) {
    return 0;
  }

  return Math.min(
    angularDistance(yaw, yawMin),
    angularDistance(yaw, yawMax),
  );
}

function distanceToPitchRange(pitch, pitchMin, pitchMax) {
  const min = Math.min(pitchMin, pitchMax);
  const max = Math.max(pitchMin, pitchMax);

  if (pitch >= min && pitch <= max) {
    return 0;
  }

  return pitch < min ? min - pitch : pitch - max;
}

function yawMarginInsideRange(yaw, yawMin, yawMax) {
  if (!yawInRange(yaw, yawMin, yawMax)) {
    return -Infinity;
  }

  return Math.min(
    angularDistance(yaw, yawMin),
    angularDistance(yaw, yawMax),
  );
}

function pitchMarginInsideRange(pitch, pitchMin, pitchMax) {
  const min = Math.min(pitchMin, pitchMax);
  const max = Math.max(pitchMin, pitchMax);

  if (pitch < min || pitch > max) {
    return -Infinity;
  }

  return Math.min(pitch - min, max - pitch);
}

export function classifyAoisWithUncertainty(
  point,
  aois,
  {
    yawRadius = 0,
    pitchRadius = 0,
  } = {},
) {
  const safeYawRadius = Math.max(0, yawRadius);
  const safePitchRadius = Math.max(0, pitchRadius);
  const exactHits = hitTestAois(point, aois);
  const possibleHits = aois.filter((aoi) => (
    distanceToYawRange(point.yaw, aoi.yawMin, aoi.yawMax) <= safeYawRadius &&
    distanceToPitchRange(point.pitch, aoi.pitchMin, aoi.pitchMax) <= safePitchRadius
  ));
  const likelyHits = exactHits.filter((aoi) => (
    yawMarginInsideRange(point.yaw, aoi.yawMin, aoi.yawMax) >= safeYawRadius &&
    pitchMarginInsideRange(point.pitch, aoi.pitchMin, aoi.pitchMax) >= safePitchRadius
  ));
  const likelyHitIds = new Set(likelyHits.map((aoi) => aoi.id));
  const ambiguousHits = possibleHits.filter((aoi) => !likelyHitIds.has(aoi.id));

  return {
    exactHits,
    likelyHits,
    possibleHits,
    ambiguousHits,
    uncertainty: {
      yawRadius: safeYawRadius,
      pitchRadius: safePitchRadius,
    },
  };
}

export function screenUncertaintyToYawPitch({
  x,
  y,
  width,
  height,
  cameraYaw = 0,
  cameraPitch = 0,
  fov = 75,
  radiusPx = 0,
}) {
  const radius = Math.max(0, radiusPx);
  const center = screenPointToYawPitch({
    x,
    y,
    width,
    height,
    cameraYaw,
    cameraPitch,
    fov,
  });
  const horizontalSamples = [
    screenPointToYawPitch({
      x: clamp(x - radius, 0, width),
      y,
      width,
      height,
      cameraYaw,
      cameraPitch,
      fov,
    }),
    screenPointToYawPitch({
      x: clamp(x + radius, 0, width),
      y,
      width,
      height,
      cameraYaw,
      cameraPitch,
      fov,
    }),
  ];
  const verticalSamples = [
    screenPointToYawPitch({
      x,
      y: clamp(y - radius, 0, height),
      width,
      height,
      cameraYaw,
      cameraPitch,
      fov,
    }),
    screenPointToYawPitch({
      x,
      y: clamp(y + radius, 0, height),
      width,
      height,
      cameraYaw,
      cameraPitch,
      fov,
    }),
  ];

  return {
    yawRadius: Math.max(...horizontalSamples.map((sample) => angularDistance(sample.yaw, center.yaw))),
    pitchRadius: Math.max(...verticalSamples.map((sample) => Math.abs(sample.pitch - center.pitch))),
  };
}
