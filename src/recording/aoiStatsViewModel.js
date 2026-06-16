const TOP_AOI_CARD_LIMIT = 10;

function isFiniteNumber(value) {
  return Number.isFinite(value);
}

function formatCount(value) {
  return isFiniteNumber(value) ? String(value) : '0';
}

function formatSeconds(value) {
  return isFiniteNumber(value) && value > 0 ? `${value.toFixed(2)}s` : '--';
}

function formatMilliseconds(value) {
  return isFiniteNumber(value) && value > 0 ? `${Math.round(value)}ms` : '--';
}

function formatElapsedMilliseconds(value) {
  return isFiniteNumber(value) && value >= 0 ? `${Math.round(value)}ms` : '--';
}

function formatPercent(value) {
  return isFiniteNumber(value) ? `${Number(value.toFixed(1))}%` : '--';
}

function listAoiMetricEntries(perAoi) {
  if (Array.isArray(perAoi)) {
    return perAoi.map((metrics, index) => [metrics?.id ?? String(index), metrics]);
  }

  return perAoi && typeof perAoi === 'object' ? Object.entries(perAoi) : [];
}

function getPrimaryAttentionMetric(metrics) {
  const fixationSec = isFiniteNumber(metrics.totalFixationDurationMs)
    ? metrics.totalFixationDurationMs / 1000
    : 0;

  if (fixationSec > 0) {
    return {
      label: 'Thời gian định thị',
      valueSec: fixationSec,
      displayValue: formatSeconds(fixationSec),
    };
  }

  const likelyDwellSec = isFiniteNumber(metrics.likelyDwellSec) ? metrics.likelyDwellSec : 0;
  if (likelyDwellSec > 0) {
    return {
      label: 'Lưu lại ước tính',
      valueSec: likelyDwellSec,
      displayValue: formatSeconds(likelyDwellSec),
    };
  }

  const dwellSec = isFiniteNumber(metrics.totalDwellSec) ? metrics.totalDwellSec : 0;
  return {
    label: 'Lưu lại',
    valueSec: dwellSec,
    displayValue: formatSeconds(dwellSec),
  };
}

function buildAoiCard([key, metrics], index) {
  const primary = getPrimaryAttentionMetric(metrics);

  return {
    id: metrics.id ?? key,
    label: metrics.label ?? metrics.name ?? metrics.id ?? key,
    rank: index + 1,
    primaryLabel: primary.label,
    primaryValue: primary.displayValue,
    primaryValueSec: primary.valueSec,
    barPercent: 0,
    stats: [
      { label: 'Lưu lại', value: formatSeconds(metrics.likelyDwellSec) },
      { label: 'Định thị', value: formatCount(metrics.fixationCount) },
      { label: 'TB định thị', value: formatMilliseconds(metrics.averageFixationDurationMs) },
      { label: 'Định thị đầu', value: formatElapsedMilliseconds(metrics.timeToFirstFixationMs) },
      { label: 'Tỷ lệ xem', value: formatPercent(metrics.percentageOfViewingTime) },
    ],
  };
}

export function buildAoiStatsViewModel({ namedAoiMetrics = {}, sampleCount = 0 } = {}) {
  const session = namedAoiMetrics?.session || {};
  const effectiveSampleCount = isFiniteNumber(session.totalSamples) ? session.totalSamples : sampleCount;
  const entries = listAoiMetricEntries(namedAoiMetrics?.perAoi)
    .filter(([, metrics]) => metrics && typeof metrics === 'object');
  const cards = entries
    .map(buildAoiCard)
    .sort((first, second) => second.primaryValueSec - first.primaryValueSec
      || first.label.localeCompare(second.label))
    .map((card, index) => ({ ...card, rank: index + 1 }));
  const maxAttentionSec = Math.max(...cards.map((card) => card.primaryValueSec), 0);
  const visibleCards = cards.slice(0, TOP_AOI_CARD_LIMIT);
  const hiddenCardCount = effectiveSampleCount > 0
    ? Math.max(0, cards.length - visibleCards.length)
    : 0;

  const normalizedCards = effectiveSampleCount > 0
    ? visibleCards.map((card) => ({
      ...card,
      barPercent: maxAttentionSec > 0
        ? Math.max(4, Math.round((card.primaryValueSec / maxAttentionSec) * 100))
        : 0,
    }))
    : [];

  const uniqueAoisFixated = Array.isArray(session.uniqueAoisFixated)
    ? session.uniqueAoisFixated.length
    : session.averageNumberOfAoisFixated;

  return {
    summaryItems: [
      { label: 'Thời lượng', value: formatSeconds(session.totalDurationSec) },
      { label: 'Mẫu', value: formatCount(effectiveSampleCount) },
      { label: 'AOI đã nhìn', value: effectiveSampleCount > 0 ? `${formatCount(uniqueAoisFixated)}/${entries.length}` : '--' },
      { label: 'TB định thị', value: formatMilliseconds(session.averageFixationDurationMs) },
    ],
    cards: normalizedCards,
    cardLimit: TOP_AOI_CARD_LIMIT,
    totalAoiCount: entries.length,
    hiddenCardCount,
    resultNote: hiddenCardCount
      ? `Đang hiển thị ${TOP_AOI_CARD_LIMIT} AOI đứng đầu trong ${entries.length} AOI theo mức chú ý. Mở bảng chi tiết hoặc xuất CSV để xem đầy đủ.`
      : '',
    emptyMessage: effectiveSampleCount
      ? 'Không có kết quả AOI cho các vùng hiện tại.'
      : 'Ghi hoặc tải một phiên để tạo kết quả AOI.',
  };
}
