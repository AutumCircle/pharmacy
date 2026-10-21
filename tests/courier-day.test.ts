import assert from 'node:assert/strict';
import test from 'node:test';

import {
  courierChartBarText, courierChartLabel, courierDaySummaryText, courierDayTitle, courierEmptyText,
  courierOrdersHref, courierStatusFilters, dushanbeDay, parseCourierDay, parseCourierFilter, parseCourierPeriod, shiftDay,
} from '../src/lib/courier-day.ts';

test('Dushanbe day starts five hours before UTC midnight', () => {
  assert.equal(dushanbeDay(new Date('2026-10-20T18:59:59Z')), '2026-10-20');
  assert.equal(dushanbeDay(new Date('2026-10-20T19:00:00Z')), '2026-10-21');
});

test('only real days within 2020–2100 are accepted', () => {
  assert.equal(parseCourierDay('2026-10-21'), '2026-10-21');
  assert.equal(parseCourierDay('2028-02-29'), '2028-02-29');
  for (const bad of [undefined, '', '2026-02-30', '2026-13-01', '21.10.2026', '2019-12-31', '2026-10-21T00:00', 'x']) {
    assert.equal(parseCourierDay(bad), undefined, String(bad));
  }
});

test('shiftDay crosses month and year boundaries', () => {
  assert.equal(shiftDay('2026-11-01', -1), '2026-10-31');
  assert.equal(shiftDay('2026-01-01', -1), '2025-12-31');
});

test('day title says today, yesterday or the date', () => {
  assert.equal(courierDayTitle('2026-10-21', '2026-10-21'), 'Сегодня');
  assert.equal(courierDayTitle('2026-10-20', '2026-10-21'), 'Вчера');
  assert.equal(courierDayTitle('2026-10-18', '2026-10-21'), '18 октября 2026');
});

test('status filters include «Не доставлены» and «Отменённые»; unknown means all', () => {
  assert.deepEqual(courierStatusFilters.map((filter) => filter.value),
    ['', 'pending', 'confirmed', 'delivering', 'delivered', 'undelivered', 'cancelled']);
  assert.equal(parseCourierFilter('cancelled'), 'cancelled');
  assert.equal(parseCourierFilter('undelivered'), 'undelivered');
  assert.equal(parseCourierFilter('archived'), '');
  assert.equal(parseCourierFilter(undefined), '');
});

test('links keep the day and status together', () => {
  assert.equal(courierOrdersHref({}), '/staff/orders');
  assert.equal(courierOrdersHref({ status: '' , date: '2026-10-21' }), '/staff/orders?date=2026-10-21');
  assert.equal(courierOrdersHref({ status: 'cancelled', date: '2026-10-21', cursor: 'a b' }),
    '/staff/orders?date=2026-10-21&status=cancelled&cursor=a+b');
});

test('summary and empty texts', () => {
  assert.equal(courierDaySummaryText({ total: 5, delivered: 3, undelivered: 2, cancelled: 0 }),
    'Заказов: 5 · доставлено: 3 · не доставлено: 2');
  assert.equal(courierDaySummaryText({ total: 1, delivered: 0, undelivered: 1, cancelled: 2 }),
    'Заказов: 1 · доставлено: 0 · не доставлено: 1 · отменено: 2');
  assert.equal(courierEmptyText('', undefined), 'Новые заказы появятся здесь.');
  assert.equal(courierEmptyText('delivered', '2026-10-21'), 'В этот день таких заказов нет.');
  assert.equal(courierEmptyText('cancelled', undefined), 'Отменённых заказов нет.');
});

test('chart period is 30 unless 70 is asked; links keep the period', () => {
  assert.equal(parseCourierPeriod(undefined), 30);
  assert.equal(parseCourierPeriod('70'), 70);
  assert.equal(parseCourierPeriod('365'), 30);
  assert.equal(courierOrdersHref({ date: '2026-10-21', period: 70 }), '/staff/orders?date=2026-10-21&period=70');
  assert.equal(courierOrdersHref({ period: 30 }), '/staff/orders');
});

test('chart labels count back from today: every 5th day for 30, every 10th for 70', () => {
  const thirty = Array.from({ length: 30 }, (_, index) => courierChartLabel(shiftDay('2026-10-21', index - 29), index, 30));
  assert.equal(thirty[29], '21');
  assert.equal(thirty[24], '16');
  assert.equal(thirty[28], '');
  assert.equal(thirty.filter(Boolean).length, 6);
  const seventy = Array.from({ length: 70 }, (_, index) => courierChartLabel(shiftDay('2026-10-21', index - 69), index, 70));
  assert.equal(seventy[69], '21');
  assert.equal(seventy[59], '11');
  assert.equal(seventy.filter(Boolean).length, 7);
});

test('bar text names the day and its counts', () => {
  assert.equal(courierChartBarText({ date: '2026-10-21', total: 4, delivered: 1, undelivered: 3, cancelled: 0 }, '2026-10-21'),
    'Сегодня: заказов 4, доставлено 1, не доставлено 3');
  assert.equal(courierChartBarText({ date: '2026-10-18', total: 0, delivered: 0, undelivered: 0, cancelled: 2 }, '2026-10-21'),
    '18 октября 2026: заказов 0, доставлено 0, не доставлено 0, отменено 2');
});
