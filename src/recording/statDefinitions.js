export const STAT_RELIABILITY = Object.freeze({
  STABLE: 'stable',
  ESTIMATED: 'estimated',
  EXPERIMENTAL: 'experimental',
});

export const AOI_STAT_DEFINITIONS = Object.freeze([
  {
    id: 'totalDwellSec',
    label: 'Tổng thời gian lưu lại',
    scope: 'perAoi',
    unit: 'giây',
    reliability: STAT_RELIABILITY.STABLE,
    description: 'Tổng thời gian các mẫu ánh nhìn giao với AOI.',
  },
  {
    id: 'likelyDwellSec',
    label: 'Thời gian lưu lại ước tính',
    scope: 'perAoi',
    unit: 'giây',
    reliability: STAT_RELIABILITY.STABLE,
    description: 'Tổng thời gian từ các mẫu được phân loại là có khả năng trúng AOI.',
  },
  {
    id: 'stableDwellSec',
    label: 'Thời gian lưu lại ổn định',
    scope: 'perAoi',
    unit: 'giây',
    reliability: STAT_RELIABILITY.STABLE,
    description: 'Tổng thời gian lưu lại từ bằng chứng AOI ổn định qua các mẫu.',
  },
  {
    id: 'fixationCount',
    label: 'Số lần định thị',
    scope: 'perAoi',
    unit: 'số lượng',
    reliability: STAT_RELIABILITY.ESTIMATED,
    description: 'Số lần định thị được gán cho AOI.',
  },
  {
    id: 'totalFixationDurationMs',
    label: 'Tổng thời lượng định thị',
    scope: 'perAoi',
    unit: 'mili giây',
    reliability: STAT_RELIABILITY.ESTIMATED,
    description: 'Tổng thời lượng các định thị được gán cho AOI.',
  },
  {
    id: 'averageFixationDurationMs',
    label: 'Thời lượng định thị trung bình',
    scope: 'perAoi',
    unit: 'mili giây',
    reliability: STAT_RELIABILITY.ESTIMATED,
    description: 'Thời lượng trung bình của các định thị được gán cho AOI.',
  },
  {
    id: 'firstFixationDurationMs',
    label: 'Thời lượng định thị đầu tiên',
    scope: 'perAoi',
    unit: 'mili giây',
    reliability: STAT_RELIABILITY.ESTIMATED,
    description: 'Thời lượng của định thị đầu tiên được gán cho AOI.',
  },
  {
    id: 'timeToFirstFixationMs',
    label: 'Thời gian đến định thị đầu tiên',
    scope: 'perAoi',
    unit: 'mili giây',
    reliability: STAT_RELIABILITY.ESTIMATED,
    description: 'Thời gian trôi qua trước định thị đầu tiên được gán cho AOI.',
  },
  {
    id: 'revisitCount',
    label: 'Số lần quay lại',
    scope: 'perAoi',
    unit: 'số lượng',
    reliability: STAT_RELIABILITY.ESTIMATED,
    description: 'Số lần định thị quay lại AOI sau khi nhìn sang nơi khác.',
  },
  {
    id: 'percentageOfViewingTime',
    label: 'Tỷ lệ thời gian xem',
    scope: 'perAoi',
    unit: 'phần trăm',
    reliability: STAT_RELIABILITY.STABLE,
    description: 'Tỷ lệ tổng thời gian xem dành để lưu lại trên AOI.',
  },
  {
    id: 'totalSamples',
    label: 'Tổng số mẫu',
    scope: 'session',
    unit: 'số lượng',
    reliability: STAT_RELIABILITY.STABLE,
    description: 'Số mẫu ánh nhìn trong phiên được phân tích.',
  },
  {
    id: 'totalDurationSec',
    label: 'Tổng thời lượng',
    scope: 'session',
    unit: 'giây',
    reliability: STAT_RELIABILITY.STABLE,
    description: 'Thời lượng bản ghi được phân tích ước tính từ thời gian mẫu.',
  },
  {
    id: 'totalFixations',
    label: 'Tổng số định thị',
    scope: 'session',
    unit: 'số lượng',
    reliability: STAT_RELIABILITY.ESTIMATED,
    description: 'Số cửa sổ định thị được ánh xạ tới AOI.',
  },
  {
    id: 'averageFixationDurationMs',
    label: 'Thời lượng định thị trung bình của phiên',
    scope: 'session',
    unit: 'mili giây',
    reliability: STAT_RELIABILITY.ESTIMATED,
    description: 'Thời lượng trung bình của tất cả cửa sổ định thị được ánh xạ AOI trong phiên.',
  },
  {
    id: 'uniqueAoisFixated',
    label: 'AOI duy nhất đã định thị',
    scope: 'session',
    unit: 'mã',
    reliability: STAT_RELIABILITY.ESTIMATED,
    description: 'Mã AOI nhận ít nhất một định thị, theo thứ tự định thị đầu tiên.',
  },
  {
    id: 'saccadeCount',
    label: 'Số lần chuyển tiếp',
    scope: 'session',
    unit: 'số lượng',
    reliability: STAT_RELIABILITY.EXPERIMENTAL,
    description: 'Số khoảng chuyển tiếp thử nghiệm giữa các cửa sổ định thị AOI.',
  },
  {
    id: 'averageNumberOfAoisFixated',
    label: 'Số AOI được định thị trung bình',
    scope: 'session',
    unit: 'số lượng',
    reliability: STAT_RELIABILITY.ESTIMATED,
    description: 'Số AOI riêng biệt nhận ít nhất một định thị.',
  },
  {
    id: 'aoiCoveragePercent',
    label: 'Độ bao phủ AOI',
    scope: 'session',
    unit: 'phần trăm',
    reliability: STAT_RELIABILITY.STABLE,
    description: 'Phần trăm AOI hiện có nhận ít nhất một định thị.',
  },
  {
    id: 'overallProcessingEfficiency',
    label: 'Hiệu quả xử lý tổng thể',
    scope: 'session',
    unit: 'phần trăm',
    reliability: STAT_RELIABILITY.ESTIMATED,
    description: 'Chỉ số MVP minh bạch kết hợp độ bao phủ AOI, thời gian lưu lại AOI tin cậy và hiệu quả định thị; báo cáo nên kèm công thức và thành phần.',
  },
  {
    id: 'averageSaccadeDurationMs',
    label: 'Thời lượng saccade trung bình',
    scope: 'session',
    unit: 'mili giây',
    reliability: STAT_RELIABILITY.EXPERIMENTAL,
    description: 'Ước tính thử nghiệm về thời lượng chuyển tiếp trung bình giữa các định thị.',
  },
  {
    id: 'screenHeatmap',
    label: 'Bản đồ nhiệt màn hình',
    scope: 'heatmap',
    unit: 'mật độ',
    reliability: STAT_RELIABILITY.STABLE,
    description: 'Bản đồ mật độ ánh nhìn trong không gian màn hình cho tọa độ trình xem phẳng.',
  },
  {
    id: 'panoramaHeatmap',
    label: 'Bản đồ nhiệt toàn cảnh',
    scope: 'heatmap',
    unit: 'mật độ',
    reliability: STAT_RELIABILITY.STABLE,
    description: 'Bản đồ mật độ ánh nhìn trong không gian toàn cảnh cho tọa độ yaw và pitch.',
  },
].map(Object.freeze));

const STAT_DEFINITIONS_BY_ID = AOI_STAT_DEFINITIONS.reduce((definitions, definition) => {
  if (!definitions.has(definition.id)) {
    definitions.set(definition.id, definition);
  }

  return definitions;
}, new Map());

export function getStatDefinition(id, scope = null) {
  if (scope) {
    return AOI_STAT_DEFINITIONS.find((definition) => definition.id === id && definition.scope === scope);
  }

  return STAT_DEFINITIONS_BY_ID.get(id);
}

export function listStatsByScope(scope) {
  return AOI_STAT_DEFINITIONS.filter((definition) => definition.scope === scope);
}
