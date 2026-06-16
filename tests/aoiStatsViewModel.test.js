import test from 'node:test';
import assert from 'node:assert/strict';

import { buildAoiStatsViewModel } from '../src/recording/aoiStatsViewModel.js';

test('builds readable summary and ranked AOI cards for the results panel', () => {
  const viewModel = buildAoiStatsViewModel({
    sampleCount: 12,
    namedAoiMetrics: {
      session: {
        totalSamples: 12,
        totalDurationSec: 3.2,
        totalFixations: 4,
        averageFixationDurationMs: 250,
        uniqueAoisFixated: ['cta'],
      },
      perAoi: {
        logo: {
          id: 'logo',
          label: 'Logo',
          likelyDwellSec: 0.4,
          totalDwellSec: 0.4,
          totalFixationDurationMs: 300,
          fixationCount: 1,
          averageFixationDurationMs: 300,
          timeToFirstFixationMs: 900,
          percentageOfViewingTime: 12.5,
        },
        cta: {
          id: 'cta',
          label: 'CTA button',
          likelyDwellSec: 1.2,
          totalDwellSec: 1.2,
          totalFixationDurationMs: 800,
          fixationCount: 2,
          averageFixationDurationMs: 400,
          timeToFirstFixationMs: 0,
          percentageOfViewingTime: 37.5,
        },
      },
    },
  });

  assert.deepEqual(
    viewModel.summaryItems.map((item) => [item.label, item.value]),
    [
      ['Thời lượng', '3.20s'],
      ['Mẫu', '12'],
      ['AOI đã nhìn', '1/2'],
      ['TB định thị', '250ms'],
    ],
  );
  assert.equal(viewModel.cards.length, 2);
  assert.equal(viewModel.cards[0].id, 'cta');
  assert.equal(viewModel.cards[0].label, 'CTA button');
  assert.equal(viewModel.cards[0].rank, 1);
  assert.equal(viewModel.cards[0].primaryLabel, 'Thời gian định thị');
  assert.equal(viewModel.cards[0].primaryValue, '0.80s');
  assert.equal(viewModel.cards[0].barPercent, 100);
  assert.deepEqual(
    viewModel.cards[0].stats.map((stat) => [stat.label, stat.value]),
    [
      ['Lưu lại', '1.20s'],
      ['Định thị', '2'],
      ['TB định thị', '400ms'],
      ['Định thị đầu', '0ms'],
      ['Tỷ lệ xem', '37.5%'],
    ],
  );
});

test('falls back to likely dwell when fixation timing is unavailable', () => {
  const viewModel = buildAoiStatsViewModel({
    sampleCount: 2,
    namedAoiMetrics: {
      session: {
        totalSamples: 2,
        totalDurationSec: 1,
        totalFixations: 0,
        averageFixationDurationMs: 0,
        uniqueAoisFixated: [],
      },
      perAoi: {
        label: {
          id: 'label',
          label: 'Product label',
          likelyDwellSec: 1,
          totalDwellSec: 0,
          totalFixationDurationMs: 0,
          fixationCount: 0,
          averageFixationDurationMs: 0,
          timeToFirstFixationMs: null,
          percentageOfViewingTime: 0,
        },
      },
    },
  });

  assert.equal(viewModel.cards[0].primaryLabel, 'Lưu lại ước tính');
  assert.equal(viewModel.cards[0].primaryValue, '1.00s');
  assert.equal(viewModel.cards[0].barPercent, 100);
});

test('highlights only the top 10 AOIs for large AOI files', () => {
  const perAoi = Object.fromEntries(
    Array.from({ length: 12 }, (_, index) => {
      const rank = index + 1;
      return [`aoi-${rank}`, {
        id: `aoi-${rank}`,
        label: `AOI ${rank}`,
        likelyDwellSec: rank,
        totalDwellSec: rank,
        totalFixationDurationMs: rank * 1000,
        fixationCount: rank,
        averageFixationDurationMs: 1000,
        timeToFirstFixationMs: rank * 50,
        percentageOfViewingTime: rank,
      }];
    }),
  );

  const viewModel = buildAoiStatsViewModel({
    sampleCount: 30,
    namedAoiMetrics: {
      session: {
        totalSamples: 30,
        totalDurationSec: 12,
        averageFixationDurationMs: 1000,
        uniqueAoisFixated: Object.keys(perAoi),
      },
      perAoi,
    },
  });

  assert.equal(viewModel.cards.length, 10);
  assert.equal(viewModel.totalAoiCount, 12);
  assert.equal(viewModel.hiddenCardCount, 2);
  assert.equal(viewModel.cardLimit, 10);
  assert.deepEqual(
    viewModel.cards.map((card) => card.id),
    ['aoi-12', 'aoi-11', 'aoi-10', 'aoi-9', 'aoi-8', 'aoi-7', 'aoi-6', 'aoi-5', 'aoi-4', 'aoi-3'],
  );
  assert.equal(
    viewModel.resultNote,
    'Đang hiển thị 10 AOI đứng đầu trong 12 AOI theo mức chú ý. Mở bảng chi tiết hoặc xuất CSV để xem đầy đủ.',
  );
});

test('returns a clear empty state before samples are available', () => {
  const viewModel = buildAoiStatsViewModel({
    sampleCount: 0,
    namedAoiMetrics: {
      session: {},
      perAoi: {
        existingAoi: {
          id: 'existingAoi',
          label: 'Existing AOI',
          likelyDwellSec: 0,
          totalFixationDurationMs: 0,
        },
      },
    },
  });

  assert.deepEqual(viewModel.cards, []);
  assert.deepEqual(
    viewModel.summaryItems.map((item) => [item.label, item.value]),
    [
      ['Thời lượng', '--'],
      ['Mẫu', '0'],
      ['AOI đã nhìn', '--'],
      ['TB định thị', '--'],
    ],
  );
  assert.equal(viewModel.emptyMessage, 'Ghi hoặc tải một phiên để tạo kết quả AOI.');
});
