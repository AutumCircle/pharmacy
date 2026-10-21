import assert from 'node:assert/strict';
import test from 'node:test';

import {
  courierDaySummaryText, courierDayTitle, courierEmptyText, courierOrdersHref, courierStatusFilters,
  dushanbeDay, parseCourierDay, parseCourierFilter, shiftDay,
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
