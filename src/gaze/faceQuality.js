export function summarizeFaceBox(box) {
  if (
    !Number.isFinite(box?.x) ||
    !Number.isFinite(box?.y) ||
    !Number.isFinite(box?.width) ||
    !Number.isFinite(box?.height) ||
    box.width <= 0 ||
    box.height <= 0
  ) {
    return null;
  }

  return {
    centerX: box.x + box.width / 2,
    centerY: box.y + box.height / 2,
    width: box.width,
    height: box.height,
    area: box.width * box.height,
  };
}

export function compareFacePoseToBaseline(current, baseline, {
  maxCenterShiftRatio = 0.2,
  maxScaleChangeRatio = 0.18,
} = {}) {
  if (!current || !baseline) {
    return { accepted: false, reasons: ['missing-face'] };
  }

  const baselineSize = Math.max(baseline.width, baseline.height);
  const centerShift = Math.hypot(
    current.centerX - baseline.centerX,
    current.centerY - baseline.centerY,
  ) / baselineSize;
  const scaleChange = Math.abs(Math.sqrt(current.area / baseline.area) - 1);
  const reasons = [];

  if (centerShift > maxCenterShiftRatio) {
    reasons.push('center-shift');
  }

  if (scaleChange > maxScaleChangeRatio) {
    reasons.push('scale-change');
  }

  return {
    accepted: reasons.length === 0,
    reasons,
    centerShift,
    scaleChange,
  };
}
