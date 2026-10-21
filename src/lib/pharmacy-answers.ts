import type { PharmacyAnswer, PharmacyAnswersRequest, PharmacyItemAnswer } from './api-v1/staff-types';

// Pharmacist answers per order item (job 010). Pure helpers shared by the pharmacy card, the
// Next.js proxy route and the courier screens. Lambda is the authority: it re-validates every
// request, takes the pharmacy id from the staff session and computes the confirmed amount in SQL.

export const PHARMACY_ANSWERS: readonly PharmacyAnswer[] = ['available', 'unavailable', 'price_differs'];
export const PHARMACY_ANSWER_MAX_ITEMS = 50;
export const PHARMACY_PROBLEM_MIN = 3;
export const PHARMACY_PROBLEM_MAX = 300;

export const PHARMACY_NAMES: Record<1 | 2, string> = { 1: 'Ватан 1', 2: 'Ватан 2' };

/** Button / chip wording on the pharmacy card. */
export const PHARMACY_ANSWER_LABELS: Record<PharmacyAnswer, string> = {
  available: 'В наличии, цена верна',
  unavailable: 'Нет в наличии',
  price_differs: 'Цена отличается',
};

/** Short chip text for this pharmacy's own answer (null = still waiting). */
export function pharmacyAnswerChip(answer: PharmacyAnswer | null | undefined): { text: string; tone: string } {
  if (answer === 'available') return { text: 'В наличии', tone: 'ok' };
  if (answer === 'unavailable') return { text: 'Нет в наличии', tone: 'bad' };
  if (answer === 'price_differs') return { text: 'Цена отличается', tone: 'warn' };
  return { text: 'Ждёт ответа', tone: 'wait' };
}

export function isPharmacyAnswer(value: unknown): value is PharmacyAnswer {
  return typeof value === 'string' && (PHARMACY_ANSWERS as readonly string[]).includes(value);
}

/** Collapses whitespace like Lambda (`" ".join(text.split())`). */
export function normalizeProblem(value: string): string {
  return value.split(/\s+/).filter(Boolean).join(' ');
}

export const PHARMACY_PRICE_ERROR = 'Цена должна быть от 0,01 до 999999,99 с. с точностью до копейки';

/**
 * Mirrors Lambda `validate_unit_price` for the pharmacy's own price at assembly (rework 1; job 013: both pharmacies):
 * 0.01..999999.99 with at most two decimals, comma allowed. Returns a canonical "45.50" string or null.
 * This is an input only: Lambda recomputes the client price and every total itself.
 */
export function normalizePharmacyPrice(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value).trim().replace(',', '.');
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(text)) return null;
  const amount = Number(text);
  if (!Number.isFinite(amount) || amount < 0.01 || amount > 999999.99) return null;
  return amount.toFixed(2);
}

export type AnswersValidation = { ok: true; value: PharmacyAnswersRequest } | { ok: false; error: string };

/**
 * Mirrors Lambda `validate_pharmacy_answers`: body is exactly {answers}; each entry is exactly
 * order_item_id + answer (+ optional problem); no prices, no pharmacy id; 1..50 entries, no
 * duplicates; problem required (3–300) for price_differs, optional for unavailable, forbidden for available.
 */
export function validatePharmacyAnswersRequest(body: unknown): AnswersValidation {
  const fail = (error: string): AnswersValidation => ({ ok: false, error });
  if (!body || typeof body !== 'object' || Array.isArray(body)) return fail('Укажите ответы по позициям');
  const data = body as Record<string, unknown>;
  const keys = Object.keys(data);
  if (keys.length !== 1 || keys[0] !== 'answers' || !Array.isArray(data.answers)) return fail('Укажите ответы по позициям');
  const entries = data.answers as unknown[];
  if (entries.length < 1 || entries.length > PHARMACY_ANSWER_MAX_ITEMS) {
    return fail(`Можно ответить от 1 до ${PHARMACY_ANSWER_MAX_ITEMS} позиций за раз`);
  }
  const seen = new Set<number>();
  const answers: PharmacyAnswersRequest['answers'] = [];
  for (const raw of entries) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail('Проверьте позиции и ответы');
    const entry = raw as Record<string, unknown>;
    const entryKeys = Object.keys(entry);
    if (!('order_item_id' in entry) || !('answer' in entry)
      || entryKeys.some((key) => key !== 'order_item_id' && key !== 'answer' && key !== 'problem'
        && key !== 'base_unit_price')) {
      return fail('Проверьте позиции и ответы');
    }
    const id = entry.order_item_id;
    if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) return fail('Неверная позиция заказа');
    if (seen.has(id)) return fail('Позиция указана дважды');
    seen.add(id);
    if (!isPharmacyAnswer(entry.answer)) return fail('Неверный ответ по позиции');
    const answer = entry.answer;
    const rawProblem = entry.problem;
    if (rawProblem !== undefined && rawProblem !== null && typeof rawProblem !== 'string') {
      return fail('Описание проблемы должно быть текстом');
    }
    if ('base_unit_price' in entry && answer !== 'available') return fail('Цену можно указать только для «В наличии»');
    if (answer === 'available') {
      if (rawProblem !== undefined && rawProblem !== null) return fail('Для «В наличии» проблема не указывается');
      if ('base_unit_price' in entry) {
        const price = normalizePharmacyPrice(entry.base_unit_price);
        if (price === null) return fail(PHARMACY_PRICE_ERROR);
        answers.push({ order_item_id: id, answer, base_unit_price: price });
      } else {
        answers.push({ order_item_id: id, answer });
      }
      continue;
    }
    const problem = typeof rawProblem === 'string' ? normalizeProblem(rawProblem) : '';
    if (problem.includes('\u0000')) return fail('Описание проблемы содержит недопустимые символы');
    if (!problem) {
      if (answer === 'price_differs') return fail('Опишите, чем отличается цена');
      answers.push({ order_item_id: id, answer });
      continue;
    }
    if (problem.length < PHARMACY_PROBLEM_MIN || problem.length > PHARMACY_PROBLEM_MAX) {
      return fail(`Описание проблемы: от ${PHARMACY_PROBLEM_MIN} до ${PHARMACY_PROBLEM_MAX} символов`);
    }
    answers.push({ order_item_id: id, answer, problem });
  }
  return { ok: true, value: { answers } };
}

/**
 * Row controls of the pharmacy medicines table («Цена отличается» is no longer offered). Job 014: the
 * same compact controls for «Ватан 1» and «Ватан 2» next to the line sum; the price itself is tapped to
 * edit it (`price` / `save` / `cancel` are the accessible names of that inline editor). Job 015: no
 * «В наличии» and no per-item «Собрано» — everything not marked «Нет в наличии» counts as available.
 */
export const ROW_ACTION_LABELS = {
  unavailable: 'Нет в наличии',
  price: 'Изменить цену',
  save: 'Сохранить',
  cancel: 'Отмена',
  confirm: 'Да',
} as const;

/**
 * Job 014: the inline confirmation of «Нет в наличии» at both pharmacies. «Ватан 1» passes the item to
 * «Ватан 2»; at «Ватан 2» the item is then missing in both pharmacies.
 */
export function unavailableConfirmText(pharmacyId: number | null | undefined): string {
  return pharmacyId === 2 ? 'Нет в обеих аптеках?' : 'Передать в Ватан 2?';
}

export type RowAction = 'unavailable' | 'price';

/**
 * The `pharmacy-answers` request of one row control. «Изменить цену» → «Сохранить» sends «В наличии»
 * with the pharmacy (base) price; an empty field or the current price sends plain «В наличии» (job 015:
 * the only way the panel still sends «available»). Lambda re-validates everything and recomputes client
 * prices and totals.
 */
export function rowActionRequest(orderItemId: number, action: RowAction, price?: string,
  currentPrice?: number | string | null): AnswersValidation {
  const entry: { order_item_id: number; answer: PharmacyAnswer; base_unit_price?: string } =
    { order_item_id: orderItemId, answer: action === 'unavailable' ? 'unavailable' : 'available' };
  if (action === 'price') {
    const raw = (price ?? '').trim();
    if (raw) {
      const normalized = normalizePharmacyPrice(raw);
      if (normalized === null) return { ok: false, error: PHARMACY_PRICE_ERROR };
      const current = currentPrice != null ? normalizePharmacyPrice(currentPrice) : null;
      if (normalized !== current) entry.base_unit_price = normalized;
    }
  }
  return validatePharmacyAnswersRequest({ answers: [entry] });
}

/**
 * Job 013 (Next.js route only): splits the server-only `_notification` off the Lambda answer. The
 * returned `data` never contains it, so it never reaches the browser.
 */
export function splitChangeNotification<T extends Record<string, unknown>>(data: T):
  { data: Omit<T, '_notification'>; notification: Record<string, unknown> | null } {
  const { _notification: notification, ...rest } = data;
  const valid = !!notification && typeof notification === 'object' && !Array.isArray(notification);
  return { data: rest, notification: valid ? notification as Record<string, unknown> : null };
}

/** Sends the change notification; a notifier failure goes to `onError` and is never thrown. */
export async function sendChangeNotificationSafely(
  notification: Record<string, unknown>, send: (notification: Record<string, unknown>) => Promise<unknown>,
  onError: (error: unknown) => void,
): Promise<void> {
  try {
    await send(notification);
  } catch (error) {
    onError(error);
  }
}

type CourierItemInput = { pharmacy_id?: number | null; answers?: PharmacyItemAnswer[] | null };

function pharmacyName(id: number): string {
  return id === 1 || id === 2 ? PHARMACY_NAMES[id] : `Аптека ${id}`;
}

/** Owner's colours for items that moved between pharmacies (rework 1). */
export const BOTH_PHARMACIES_MISSING = 'Нет в наличии в обеих аптеках';
export const AT_PHARMACY_TWO = 'В аптеке 2';

/**
 * Cross-pharmacy mark of an item routed «Ватан 1» -> «Ватан 2», from «Ватан 2»'s answer:
 * available there = orange «В аптеке 2»; unavailable there = red «Нет в наличии в обеих аптеках».
 * Null when the item was not routed or «Ватан 2» has not answered yet (or answered «Цена отличается»).
 */
export function crossPharmacyMark(routed: boolean, answerAtTwo: PharmacyAnswer | null | undefined):
  { text: string; tone: 'orange' | 'bad' } | null {
  if (!routed) return null;
  if (answerAtTwo === 'available') return { text: AT_PHARMACY_TWO, tone: 'orange' };
  if (answerAtTwo === 'unavailable') return { text: BOTH_PHARMACIES_MISSING, tone: 'bad' };
  return null;
}

/** Job 013: chip of a «Ватан 1» row that went to «Ватан 2»: orange «Ватан 2» while waiting or available
 * there, red «Нет в наличии в обеих аптеках» when «Ватан 2» lacks it too. */
export const ROUTED_TO_TWO = 'Ватан 2';

export function routedAwayMark(answerAtTwo: PharmacyAnswer | null | undefined): { text: string; tone: 'orange' | 'bad' } {
  return answerAtTwo === 'unavailable' ? { text: BOTH_PHARMACIES_MISSING, tone: 'bad' } : { text: ROUTED_TO_TWO, tone: 'orange' };
}

function routedToTwo(item: CourierItemInput): boolean {
  return (item.pharmacy_id ?? 1) === 2 && Array.isArray(item.answers)
    && item.answers.some((answer) => answer.pharmacy_id === 1 && answer.answer === 'unavailable');
}

/** Tone of an item's state on the courier screen: ok / warn / bad / wait / orange (in «Ватан 2»). */
export function courierItemAnswerTone(item: CourierItemInput): string | null {
  if (!Array.isArray(item.answers)) return null;
  const pharmacy = item.pharmacy_id ?? 1;
  const current = item.answers.find((answer) => answer.pharmacy_id === pharmacy);
  const cross = crossPharmacyMark(routedToTwo(item), current?.answer);
  if (cross) return cross.tone;
  if (!current) return 'wait';
  return current.answer === 'available' ? 'ok' : current.answer === 'unavailable' ? 'bad' : 'warn';
}

/**
 * One line per item for the courier: which pharmacy holds it and what it answered.
 * Examples: «Ватан 1: в наличии», «Ватан 1: нет → Ватан 2 · ждём ответ Ватан 2», «В аптеке 2»,
 * «Нет в наличии в обеих аптеках», «Ватан 1: цена отличается: …», «Ждём ответ Ватан 1».
 * Null for an old Lambda response without answers.
 */
export function courierItemAnswerLabel(item: CourierItemInput): string | null {
  if (!Array.isArray(item.answers)) return null;
  const pharmacy = item.pharmacy_id ?? 1;
  const current = item.answers.find((answer) => answer.pharmacy_id === pharmacy);
  const routed = routedToTwo(item);
  const cross = crossPharmacyMark(routed, current?.answer);
  if (cross) return cross.text;
  const prefix = routed ? 'Ватан 1: нет → ' : '';
  const name = pharmacyName(pharmacy);
  if (!current) return routed ? `${prefix}Ватан 2 · ждём ответ Ватан 2` : `Ждём ответ ${name}`;
  if (current.answer === 'available') return `${prefix}${name}: в наличии`;
  if (current.answer === 'price_differs') {
    return `${prefix}${name}: цена отличается${current.problem ? `: ${current.problem}` : ''}`;
  }
  const reason = current.problem ? ` (${current.problem})` : '';
  return `${name}: нет в наличии${reason}`;
}

type AmountOrder = {
  confirmed_total?: string | number | null;
  pharmacy_answers_complete?: boolean;
  unavailable_count?: number;
  item_count?: number;
};

/** Every item is unavailable at its final pharmacy: there is no sum to confirm. */
export function allItemsUnavailable(order: AmountOrder): boolean {
  const total = order.confirmed_total;
  const unavailable = order.unavailable_count ?? 0;
  return total !== null && total !== undefined && total !== '' && Number(total) === 0 && unavailable > 0
    && (order.item_count === undefined || unavailable >= order.item_count);
}

function som(value: string | number): string {
  const amount = Number(value);
  return `${(Number.isFinite(amount) ? amount : 0).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} сом`;
}

/** «Подтверждённая сумма: X сом» when the Lambda computed it, otherwise the warning text. */
export function confirmedAmountText(order: AmountOrder): string {
  const total = order.confirmed_total;
  if (total === null || total === undefined || total === '') return 'Сумма ещё не подтверждена аптекой';
  if (allItemsUnavailable(order)) return 'Все позиции недоступны — свяжитесь с клиентом';
  const missing = order.unavailable_count && order.unavailable_count > 0
    ? ` · без ${order.unavailable_count} поз. (нет в наличии)` : '';
  return `Подтверждённая сумма: ${som(total)}${missing}`;
}

/** True when the courier may tell the client a final sum. */
export function isAmountConfirmed(order: AmountOrder): boolean {
  return order.confirmed_total !== null && order.confirmed_total !== undefined && order.confirmed_total !== ''
    && !allItemsUnavailable(order);
}

/** «Ответ аптек: N из M» for the courier list; null for an old Lambda response. */
export function answersProgressText(order: { answered_count?: number; item_count?: number }): string | null {
  if (typeof order.answered_count !== 'number' || typeof order.item_count !== 'number' || order.item_count <= 0) {
    return null;
  }
  return `Ответ аптек: ${order.answered_count} из ${order.item_count}`;
}
