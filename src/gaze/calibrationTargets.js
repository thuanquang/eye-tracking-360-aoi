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

export function getTargetPointsForMode(mode) {
  return mode === 'accuracy' ? VALIDATION_POINTS : CALIBRATION_POINTS;
}
