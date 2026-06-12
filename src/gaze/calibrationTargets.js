export const CALIBRATION_POINTS = [
  { x: 50, y: 50 },
  { x: 12, y: 14 },
  { x: 88, y: 86 },
  { x: 88, y: 14 },
  { x: 12, y: 86 },
  { x: 50, y: 14 },
  { x: 50, y: 86 },
  { x: 12, y: 50 },
  { x: 88, y: 50 },
  { x: 28, y: 28 },
  { x: 72, y: 72 },
  { x: 72, y: 28 },
  { x: 28, y: 72 },
  { x: 50, y: 50 },
];

export const ACCURACY_REFINEMENT_POINTS = [
  { x: 50, y: 50 },
  { x: 20, y: 22 },
  { x: 80, y: 22 },
  { x: 20, y: 78 },
  { x: 80, y: 78 },
  { x: 50, y: 24 },
  { x: 50, y: 76 },
  { x: 24, y: 50 },
  { x: 76, y: 50 },
];

export const ACCURACY_VALIDATION_POINTS = [
  { x: 35, y: 35 },
  { x: 65, y: 35 },
  { x: 35, y: 65 },
  { x: 65, y: 65 },
  { x: 50, y: 38 },
  { x: 50, y: 62 },
  { x: 38, y: 50 },
  { x: 62, y: 50 },
];

export const VALIDATION_POINTS = [
  ...ACCURACY_REFINEMENT_POINTS,
  ...ACCURACY_VALIDATION_POINTS,
];

const CENTER_POINT = { x: 50, y: 50 };

function getEvenlySpacedPercent(index, count, minPercent, maxPercent) {
  if (count === 1) {
    return CENTER_POINT.x;
  }

  const step = (maxPercent - minPercent) / (count - 1);
  return Number((minPercent + step * index).toFixed(3));
}

export function buildGridCalibrationPoints({
  columns,
  rows,
  minPercent = 10,
  maxPercent = 90,
  includeCenterRepeat = false,
} = {}) {
  if (!Number.isInteger(columns) || columns < 1) {
    throw new Error('Grid calibration columns must be a positive integer.');
  }

  if (!Number.isInteger(rows) || rows < 1) {
    throw new Error('Grid calibration rows must be a positive integer.');
  }

  const points = [];

  for (let row = 0; row < rows; row += 1) {
    const y = getEvenlySpacedPercent(row, rows, minPercent, maxPercent);

    for (let column = 0; column < columns; column += 1) {
      const x = getEvenlySpacedPercent(column, columns, minPercent, maxPercent);
      points.push({ x, y });
    }
  }

  if (includeCenterRepeat) {
    points.push({ ...CENTER_POINT });
  }

  return points;
}

const CALIBRATION_PROFILES = {
  standard: {
    id: 'standard',
    label: 'Standard',
    calibrationPoints: CALIBRATION_POINTS,
  },
  'research-39': {
    id: 'research-39',
    label: 'Research 39',
    calibrationPoints: [
      ...buildGridCalibrationPoints({
        columns: 7,
        rows: 5,
        minPercent: 10,
        maxPercent: 90,
        includeCenterRepeat: true,
      }),
      { x: 20, y: 50 },
      { x: 80, y: 50 },
      { x: 50, y: 20 },
    ],
  },
  'research-78': {
    id: 'research-78',
    label: 'Research 78',
    calibrationPoints: buildGridCalibrationPoints({
      columns: 13,
      rows: 6,
      minPercent: 8,
      maxPercent: 92,
    }),
  },
};

export function getCalibrationProfile(profileId = 'standard') {
  const profile = CALIBRATION_PROFILES[profileId] ?? CALIBRATION_PROFILES.standard;

  return {
    ...profile,
    pointCount: profile.calibrationPoints.length,
  };
}

export function getCalibrationProfileMetadata(profileId = 'standard') {
  const profile = getCalibrationProfile(profileId);

  return {
    id: profile.id,
    label: profile.label,
    pointCount: profile.pointCount,
  };
}

export function getTargetPointsForMode(mode) {
  return mode === 'accuracy' ? VALIDATION_POINTS : CALIBRATION_POINTS;
}
