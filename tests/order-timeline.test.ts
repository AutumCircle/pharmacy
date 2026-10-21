import assert from 'node:assert/strict';
import test from 'node:test';

import type { OrderTimelineEvent } from '../src/lib/api-v1/staff-types.ts';
import {
  TIMELINE_TRUNCATED_TEXT,
  UNKNOWN_EVENT_TEXT,
  formatTimelineMoney,
  groupByPickup,
  itemChangeText,
  itemPharmacyText,
  latestItemChanges,
  timelineActorLabel,
  timelineEventText,
  timelineEvents,
} from '../src/lib/order-timeline.ts';

const at = '2026-10-20T06:00:00+00:00';
const ev = (event: Partial<OrderTimelineEvent> & { kind: string }): OrderTimelineEvent =>
  ({ at, actor: 'admin', ...event }) as OrderTimelineEvent;

test('missing or malformed timeline gives an empty list', () => {
  assert.deepEqual(timelineEvents(undefined), []);
  assert.deepEqual(timelineEvents(null), []);
  assert.deepEqual(timelineEvents('x'), []);
  assert.deepEqual(timelineEvents([null, 1, { kind: 'created' }, { at, kind: 'created', actor: 'customer' }]),
    [{ at, kind: 'created', actor: 'customer' }]);
  assert.equal(latestItemChanges(undefined as unknown as OrderTimelineEvent[]).size, 0);
});

test('actor labels', () => {
  assert.equal(timelineActorLabel({ actor: 'customer' }), 'Клиент');
  assert.equal(timelineActorLabel({ actor: 'admin' }), 'Администратор');
  assert.equal(timelineActorLabel({ actor: 'courier' }), 'Курьер');
  assert.equal(timelineActorLabel({ actor: 'pharmacy', pharmacy_id: 1 }), 'Ватан 1');
  assert.equal(timelineActorLabel({ actor: 'pharmacy', pharmacy_id: 2 }), 'Ватан 2');
  assert.equal(timelineActorLabel({ actor: 'system' }), 'Система');
  assert.equal(timelineActorLabel({ actor: 'robot' as OrderTimelineEvent['actor'] }), 'Система');
});

test('money uses a comma and two decimals', () => {
  assert.equal(formatTimelineMoney('25'), '25,00');
  assert.equal(formatTimelineMoney('28.5'), '28,50');
  assert.equal(formatTimelineMoney(null), '—');
  assert.equal(formatTimelineMoney('abc'), '—');
});

test('Russian text for every known kind', () => {
  const cases: Array<[Partial<OrderTimelineEvent> & { kind: string }, string]> = [
    [{ kind: 'created' }, 'Заказ создан'],
    [{ kind: 'created', to_status: 'delivered' }, 'Заказ создан · Доставлен'],
    [{ kind: 'status_changed', from_status: 'pending', to_status: 'confirmed' }, 'Статус: Новый → Подтверждён'],
    [{ kind: 'pharmacy_answer', medicine_name: 'Парацетамол', answer: 'available' }, '«Парацетамол»: в наличии'],
    [{ kind: 'pharmacy_answer', order_item_id: 7, answer: 'price_differs' }, 'позиция 7: цена отличается'],
    [{ kind: 'pharmacy_routed', medicine_name: 'Ибупрофен' }, '«Ибупрофен»: нет в наличии, передано в Ватан 2'],
    [{ kind: 'pharmacy_price_changed', medicine_name: 'Ибупрофен', previous_price: '25.00', new_price: '28.00',
      client_price: '32.2' }, 'Цена аптеки «Ибупрофен»: 25,00 → 28,00 с. (клиенту 32,20 с.)'],
    [{ kind: 'item_collected', medicine_name: 'A' }, '«A»: собрано'],
    [{ kind: 'assembly_marked', state: 'assembled' }, 'Сборка сделана («Собран»)'],
    [{ kind: 'assembly_marked', state: 'assembling' }, 'Начата сборка'],
    [{ kind: 'assembly_reopened' }, 'Сборка «Ватан 2» снова открыта: передан новый товар'],
    [{ kind: 'checklist_updated', step: 1, done: true },
      'Чек-лист: шаг 1 выполнен — Рассчитать доставку через Заза или Яндекс Карты'],
    [{ kind: 'checklist_updated', step: 6, done: false },
      'Чек-лист: снята отметка шага 6 — Позвонить клиенту за 5–10 минут до прибытия'],
    [{ kind: 'customer_updated', fields: [{ field: 'phone', previous: '+992900000001', current: '+992900000002' }] },
      'Данные клиента изменены: телефон: +992900000001 → +992900000002'],
    [{ kind: 'customer_updated' }, 'Данные клиента изменены'],
    [{ kind: 'item_updated', medicine_name: 'A', fields: [{ field: 'quantity', previous: '1', current: '2.5' },
      { field: 'client_price', previous: '10', current: '12' }] }, '«A»: количество 1 → 2,5; цена клиенту 10,00 → 12,00 с.'],
    [{ kind: 'item_removed', medicine_name: 'A' }, '«A» удалён из заказа'],
    [{ kind: 'items_added', count: 2 }, 'Добавлено товаров: 2'],
    [{ kind: 'items_added' }, 'Добавлены товары'],
    [{ kind: 'delivery_fee_updated', fields: [{ field: 'courier_amount', previous: '0', current: '10' }] },
      'Доставка: курьеру 0,00 → 10,00 с.'],
    [{ kind: 'deleted' }, 'Заказ удалён'],
  ];
  for (const [event, text] of cases) assert.equal(timelineEventText(ev(event)), text, event.kind);
});

test('unknown kind falls back to «Изменение заказа»', () => {
  assert.equal(timelineEventText(ev({ kind: 'other' })), UNKNOWN_EVENT_TEXT);
  assert.equal(timelineEventText(ev({ kind: 'pharmacy.collected_v2' })), 'Изменение заказа');
  assert.equal(TIMELINE_TRUNCATED_TEXT, 'Показаны последние 200 событий');
});

test('latest change per item for the admin table', () => {
  const events = [
    ev({ kind: 'pharmacy_answer', actor: 'pharmacy', pharmacy_id: 1, order_item_id: 81, answer: 'available' }),
    ev({ kind: 'pharmacy_routed', actor: 'pharmacy', pharmacy_id: 1, order_item_id: 82, answer: 'unavailable' }),
    ev({ kind: 'pharmacy_price_changed', actor: 'pharmacy', pharmacy_id: 2, order_item_id: 82,
      previous_price: '25.00', new_price: '28.00' }),
    ev({ kind: 'checklist_updated', actor: 'courier', step: 1, done: true }),
    ev({ kind: 'item_removed', order_item_id: 81 }),
  ];
  const latest = latestItemChanges(events);
  assert.deepEqual([...latest.keys()].sort(), [81, 82]);
  assert.equal(itemChangeText(latest.get(82)!), 'Цена изменена Ватан 2: 25,00 → 28,00 с.');
  assert.equal(itemChangeText(latest.get(81)!), 'Ватан 1: в наличии');
  assert.equal(itemChangeText(ev({ kind: 'item_updated', order_item_id: 3,
    fields: [{ field: 'pharmacy_price', previous: '8', current: '9' }] })),
  'Изменено (Администратор): цена аптеки 8,00 → 9,00 с.');
});

test('pharmacy column and courier pick-up groups', () => {
  assert.deepEqual(itemPharmacyText(1, []), { name: 'Ватан 1', note: null });
  assert.deepEqual(itemPharmacyText(null, undefined), { name: 'Ватан 1', note: null });
  assert.deepEqual(itemPharmacyText(2, [{ pharmacy_id: 1, answer: 'unavailable', problem: null, answered_at: at }]),
    { name: 'Ватан 2', note: 'передано из Ватан 1' });
  const items = [
    { id: 'a', pharmacy_id: 1 as const, answers: [] },
    { id: 'b', pharmacy_id: 2 as const, answers: [{ pharmacy_id: 1 as const, answer: 'unavailable' as const, problem: null, answered_at: at }] },
    { id: 'c', pharmacy_id: 2 as const, answers: [{ pharmacy_id: 2 as const, answer: 'unavailable' as const, problem: null, answered_at: at }] },
    { id: 'd' },
  ];
  assert.deepEqual(groupByPickup(items).map((group) => [group.title, group.items.map((item) => item.id)]), [
    ['Забрать в Ватан 1', ['a', 'd']], ['Забрать в Ватан 2', ['b']], ['Нет в наличии', ['c']]]);
  assert.deepEqual(groupByPickup([]), []);
});
