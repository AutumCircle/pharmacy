// Job 016: Russian text for the order history («История») of the admin and the courier.
// Events come from the admin Lambda (backend/v1/shared/order_timeline.py) with whitelisted keys only;
// the courier receives a filtered subset. An older Lambda sends no `timeline`: everything here
// tolerates a missing or malformed value and returns an empty list.

import type { OrderTimelineEvent, PharmacyItemAnswer } from './api-v1/staff-types';
import { CHECKLIST_STEPS } from './courier-checklist.ts';

export const TIMELINE_TRUNCATED_TEXT = 'Показаны последние 200 событий';
export const UNKNOWN_EVENT_TEXT = 'Изменение заказа';

export const TIMELINE_ACTOR_LABELS: Record<string, string> = {
  customer: 'Клиент', admin: 'Администратор', courier: 'Курьер', pharmacy: 'Аптека', system: 'Система',
};

const STATUS_LABELS: Record<string, string> = {
  pending: 'Новый', confirmed: 'Подтверждён', delivering: 'В пути', delivered: 'Доставлен', cancelled: 'Отменён',
};

const ANSWER_LABELS: Record<string, string> = {
  available: 'в наличии', unavailable: 'нет в наличии', price_differs: 'цена отличается',
};

const FIELD_LABELS: Record<string, string> = {
  customer_name: 'имя', phone: 'телефон', address: 'адрес', landmark: 'ориентир', comment: 'комментарий',
  quantity: 'количество', client_price: 'цена клиенту', pharmacy_price: 'цена аптеки',
  courier_amount: 'курьеру', owner_amount: 'владельцу',
};

const MONEY_FIELDS = new Set(['client_price', 'pharmacy_price', 'courier_amount', 'owner_amount']);

/** Item-level kinds that may be shown as «последнее изменение» in the admin items table. */
const ITEM_CHANGE_KINDS = new Set(['pharmacy_answer', 'pharmacy_routed', 'pharmacy_price_changed', 'item_collected',
  'item_updated']);

/** The timeline of an API response: a list of well-formed events, or [] (older Lambda, bad data). */
export function timelineEvents(value: unknown): OrderTimelineEvent[] {
  if (!Array.isArray(value)) return [];
  return value.filter((event): event is OrderTimelineEvent => typeof event === 'object' && event !== null
    && typeof (event as { at?: unknown }).at === 'string' && typeof (event as { kind?: unknown }).kind === 'string');
}

export function pharmacyLabel(pharmacyId: number | null | undefined): string {
  return pharmacyId === 1 || pharmacyId === 2 ? `Ватан ${pharmacyId}` : 'Аптека';
}

/** «Клиент», «Администратор», «Курьер», «Ватан 1», «Ватан 2» or «Система». */
export function timelineActorLabel(event: Pick<OrderTimelineEvent, 'actor' | 'pharmacy_id'>): string {
  if (event.actor === 'pharmacy') return pharmacyLabel(event.pharmacy_id);
  return TIMELINE_ACTOR_LABELS[event.actor] ?? TIMELINE_ACTOR_LABELS.system;
}

/** «25,00» — two decimals with a comma (thousands separated by a space). */
export function formatTimelineMoney(value: string | number | null | undefined): string {
  const amount = Number(value);
  if (value === null || value === undefined || value === '' || !Number.isFinite(amount)) return '—';
  return amount.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatQuantity(value: string | null | undefined): string {
  const amount = Number(value);
  if (value === null || value === undefined || value === '' || !Number.isFinite(amount)) return '—';
  return amount.toLocaleString('ru-RU', { maximumFractionDigits: 2 });
}

function statusLabel(status: string | undefined): string {
  return (status && STATUS_LABELS[status]) || 'неизвестно';
}

function itemName(event: OrderTimelineEvent): string {
  if (event.medicine_name) return `«${event.medicine_name}»`;
  return event.order_item_id ? `позиция ${event.order_item_id}` : 'товар';
}

function changeText(change: { field: string; previous: string | null; current: string | null }): string {
  const label = FIELD_LABELS[change.field] ?? change.field;
  if (MONEY_FIELDS.has(change.field)) {
    return `${label} ${formatTimelineMoney(change.previous)} → ${formatTimelineMoney(change.current)} с.`;
  }
  if (change.field === 'quantity') return `${label} ${formatQuantity(change.previous)} → ${formatQuantity(change.current)}`;
  return `${label}: ${change.previous || '—'} → ${change.current || '—'}`;
}

function changesText(event: OrderTimelineEvent): string {
  const fields = Array.isArray(event.fields) ? event.fields.filter((change) => change && typeof change.field === 'string') : [];
  return fields.map(changeText).join('; ');
}

function checklistText(event: OrderTimelineEvent): string {
  const step = CHECKLIST_STEPS.find((entry) => entry.step === event.step);
  const title = step ? ` — ${step.title}` : '';
  return event.done === false ? `Чек-лист: снята отметка шага ${event.step ?? ''}${title}`
    : `Чек-лист: шаг ${event.step ?? ''} выполнен${title}`;
}

/** The Russian sentence of one event (the actor and the time are shown separately). */
export function timelineEventText(event: OrderTimelineEvent): string {
  switch (event.kind) {
    case 'created':
      return event.to_status && event.to_status !== 'pending'
        ? `Заказ создан · ${statusLabel(event.to_status)}` : 'Заказ создан';
    case 'status_changed':
      return event.from_status ? `Статус: ${statusLabel(event.from_status)} → ${statusLabel(event.to_status)}`
        : `Статус: ${statusLabel(event.to_status)}`;
    case 'pharmacy_answer':
      return `${itemName(event)}: ${ANSWER_LABELS[event.answer ?? ''] ?? 'ответ аптеки'}`;
    case 'pharmacy_routed':
      return `${itemName(event)}: нет в наличии, передано в Ватан 2`;
    case 'pharmacy_price_changed': {
      const client = event.client_price ? ` (клиенту ${formatTimelineMoney(event.client_price)} с.)` : '';
      return `Цена аптеки ${itemName(event)}: ${formatTimelineMoney(event.previous_price)} → `
        + `${formatTimelineMoney(event.new_price)} с.${client}`;
    }
    case 'item_collected':
      return `${itemName(event)}: собрано`;
    case 'assembly_marked':
      return event.state === 'assembling' ? 'Начата сборка' : 'Сборка сделана («Собран»)';
    case 'assembly_reopened':
      return 'Сборка «Ватан 2» снова открыта: передан новый товар';
    case 'checklist_updated':
      return checklistText(event);
    case 'customer_updated': {
      const changes = changesText(event);
      return changes ? `Данные клиента изменены: ${changes}` : 'Данные клиента изменены';
    }
    case 'item_updated': {
      const changes = changesText(event);
      return changes ? `${itemName(event)}: ${changes}` : `${itemName(event)} изменён`;
    }
    case 'item_removed':
      return `${itemName(event)} удалён из заказа`;
    case 'items_added':
      return typeof event.count === 'number' && event.count > 0 ? `Добавлено товаров: ${event.count}` : 'Добавлены товары';
    case 'delivery_fee_updated': {
      const changes = changesText(event);
      return changes ? `Доставка: ${changes}` : 'Доставка изменена';
    }
    case 'deleted':
      return 'Заказ удалён';
    default:
      return UNKNOWN_EVENT_TEXT;
  }
}

/** Short text of an item change for the admin items table, with who did it. */
export function itemChangeText(event: OrderTimelineEvent): string {
  const actor = timelineActorLabel(event);
  switch (event.kind) {
    case 'pharmacy_price_changed':
      return `Цена изменена ${actor}: ${formatTimelineMoney(event.previous_price)} → ${formatTimelineMoney(event.new_price)} с.`;
    case 'pharmacy_answer':
      return `${actor}: ${ANSWER_LABELS[event.answer ?? ''] ?? 'ответ'}`;
    case 'pharmacy_routed':
      return `${actor}: нет в наличии → передано в Ватан 2`;
    case 'item_collected':
      return `Собрано · ${actor}`;
    case 'item_updated': {
      const changes = changesText(event);
      return changes ? `Изменено (${actor}): ${changes}` : `Изменено (${actor})`;
    }
    default:
      return timelineEventText(event);
  }
}

/** The latest item-level event per order_item_id (events are oldest first; ties keep the later one). */
export function latestItemChanges(events: OrderTimelineEvent[]): Map<number, OrderTimelineEvent> {
  const latest = new Map<number, OrderTimelineEvent>();
  for (const event of timelineEvents(events)) {
    if (typeof event.order_item_id === 'number' && ITEM_CHANGE_KINDS.has(event.kind)) {
      latest.set(event.order_item_id, event);
    }
  }
  return latest;
}

/** Pharmacy column of an item: «Ватан 1», «Ватан 2» and, for an item «Ватан 1» passed on, a note. */
export function itemPharmacyText(pharmacyId: number | null | undefined, answers: PharmacyItemAnswer[] | undefined):
  { name: string; note: string | null } {
  const routed = pharmacyId === 2 && Array.isArray(answers)
    && answers.some((answer) => answer.pharmacy_id === 1 && answer.answer === 'unavailable');
  return { name: pharmacyLabel(pharmacyId ?? 1), note: routed ? 'передано из Ватан 1' : null };
}

/** Courier pick-up group of an item: where to take it, or «Нет в наличии» when its final pharmacy lacks it. */
export type PickupGroup = 'pharmacy-1' | 'pharmacy-2' | 'unavailable';

export function pickupGroup(item: { pharmacy_id?: number | null; answers?: PharmacyItemAnswer[] }): PickupGroup {
  const pharmacy = item.pharmacy_id === 2 ? 2 : 1;
  const current = Array.isArray(item.answers) ? item.answers.find((answer) => answer.pharmacy_id === pharmacy) : undefined;
  if (current?.answer === 'unavailable') return 'unavailable';
  return pharmacy === 2 ? 'pharmacy-2' : 'pharmacy-1';
}

export const PICKUP_GROUP_TITLES: Record<PickupGroup, string> = {
  'pharmacy-1': 'Забрать в Ватан 1', 'pharmacy-2': 'Забрать в Ватан 2', unavailable: 'Нет в наличии',
};

/** Items split into pick-up groups in a fixed order; empty groups are left out. */
export function groupByPickup<T extends { pharmacy_id?: number | null; answers?: PharmacyItemAnswer[] }>(items: T[]):
  Array<{ group: PickupGroup; title: string; items: T[] }> {
  const order: PickupGroup[] = ['pharmacy-1', 'pharmacy-2', 'unavailable'];
  return order.map((group) => ({ group, title: PICKUP_GROUP_TITLES[group],
    items: items.filter((item) => pickupGroup(item) === group) }))
    .filter((entry) => entry.items.length > 0);
}
