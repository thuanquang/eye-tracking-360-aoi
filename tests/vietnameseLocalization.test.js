import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { buildAoiStatsViewModel } from '../src/recording/aoiStatsViewModel.js';

test('static entry screen is localized to Vietnamese', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

  assert.match(html, /<html lang="vi">/);
  assert.match(html, /Chọn quy trình/);
  assert.match(html, /Thiết lập nghiên cứu/);
  assert.match(html, /Dành cho người tham gia/);
  assert.match(html, /Quay lại điều khiển/);
  assert.match(html, /Xuất CSV thống kê/);
});

test('camera calibration labels avoid tracker wording for participants and validation', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const controller = readFileSync(new URL('../src/app/appController.js', import.meta.url), 'utf8');

  assert.match(html, /Hiệu chỉnh camera/);
  assert.doesNotMatch(html, /Hiệu chuẩn bộ theo dõi/i);
  assert.match(controller, /Hiệu chỉnh camera/);
  assert.match(controller, /Hiệu chỉnh lại camera/);
  assert.doesNotMatch(controller, /hiệu chuẩn bộ theo dõi/i);
});

test('AOI stats view model uses Vietnamese result labels', () => {
  const viewModel = buildAoiStatsViewModel({
    sampleCount: 2,
    namedAoiMetrics: {
      session: {
        totalSamples: 2,
        totalDurationSec: 1,
        averageFixationDurationMs: 250,
        uniqueAoisFixated: ['logo'],
      },
      perAoi: {
        logo: {
          id: 'logo',
          label: 'Logo',
          likelyDwellSec: 0.5,
          totalDwellSec: 0.5,
          totalFixationDurationMs: 400,
          fixationCount: 1,
          averageFixationDurationMs: 400,
          timeToFirstFixationMs: 100,
          percentageOfViewingTime: 50,
        },
      },
    },
  });

  assert.deepEqual(
    viewModel.summaryItems.map((item) => item.label),
    ['Thời lượng', 'Mẫu', 'AOI đã nhìn', 'TB định thị'],
  );
  assert.equal(viewModel.cards[0].primaryLabel, 'Thời gian định thị');
  assert.deepEqual(
    viewModel.cards[0].stats.map((stat) => stat.label),
    ['Lưu lại', 'Định thị', 'TB định thị', 'Định thị đầu', 'Tỷ lệ xem'],
  );
});
