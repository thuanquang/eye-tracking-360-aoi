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

function isValidFaceSummary(summary) {
  return (
    Number.isFinite(summary?.centerX) &&
    Number.isFinite(summary?.centerY) &&
    Number.isFinite(summary?.width) &&
    Number.isFinite(summary?.height) &&
    Number.isFinite(summary?.area) &&
    summary.width > 0 &&
    summary.height > 0 &&
    summary.area > 0
  );
}

export function normalizeFaceQualitySummary(value) {
  if (isValidFaceSummary(value)) {
    return {
      centerX: value.centerX,
      centerY: value.centerY,
      width: value.width,
      height: value.height,
      area: value.area,
    };
  }

  return summarizeFaceBox(value);
}

export function compareFacePoseToBaseline(current, baseline, {
  maxCenterShiftRatio = 0.2,
  maxScaleChangeRatio = 0.18,
} = {}) {
  const currentSummary = normalizeFaceQualitySummary(current);
  const baselineSummary = normalizeFaceQualitySummary(baseline);

  if (!currentSummary || !baselineSummary) {
    return { accepted: false, reasons: ['missing-face'] };
  }

  const baselineSize = Math.max(baselineSummary.width, baselineSummary.height);
  const centerShift = Math.hypot(
    currentSummary.centerX - baselineSummary.centerX,
    currentSummary.centerY - baselineSummary.centerY,
  ) / baselineSize;
  const scaleChange = Math.abs(Math.sqrt(currentSummary.area / baselineSummary.area) - 1);
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
