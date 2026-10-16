import { parseOrderTime } from './order-time.ts';

export type WaitingLevel = 'normal' | 'warning' | 'urgent';

/** Whole minutes since `since` (floored, never negative). Offset-less timestamps are UTC. */
export function waitingMinutes(since: string, now: Date | number = Date.now()): number {
  const start = parseOrderTime(since).getTime();
  const end = typeof now === 'number' ? now : now.getTime();
  return Math.max(0, Math.floor((end - start) / 60_000));
}

/** Neutral below 10 min, amber 10–19 min, red from 20 min. */
export function waitingLevel(minutes: number): WaitingLevel {
  if (minutes >= 20) return 'urgent';
  if (minutes >= 10) return 'warning';
  return 'normal';
}

type Money = number | string;

export type ItemAnswer = 'available' | 'unavailable' | 'price_differs';

function itemAnswer(value: unknown): ItemAnswer | null {
  return value === 'available' || value === 'unavailable' || value === 'price_differs' ? value : null;
}

/**
 * Keys the pharmacy card reads. Every optional field is gated by the owner's `pharmacy_web`
 * policy in the Lambda: absent key = field turned OFF. Unknown keys are ignored.
 */
export type PharmacyOrderInput = {
  order_id: string;
  order_reference?: string | null;
  status?: string;
  created_at?: string;
  waiting_since?: string;
  awaiting_response?: boolean;
  source?: string;
  customer_name?: string | null;
  phone?: string | null;
  address?: string | null;
  landmark?: string | null;
  notes?: string | null;
  medicines?: Array<{
    medicine_name: string; quantity?: number | string; line_total?: Money;
    base_unit_price?: Money; base_line_total?: Money;
    order_item_id?: number; my_answer?: string | null; my_problem?: string | null;
  }>;
  routed_away_count?: number;
  order_total?: Money | null;
  base_total?: Money;
  profit?: Money | null;
  created_by_staff_account_id?: number | string | null;
};

export type PharmacyOrderView = {
  reference: string;
  createdAt: string | null;
  status: 'pending' | 'confirmed' | null;
  waitingSince: string | null;
  source: string | null;
  customerName: string | null;
  phone: string | null;
  address: string | null;
  landmark: string | null;
  notes: string | null;
  medicines: Array<{
    name: string; quantity: Money | null; unitPrice: Money | null; lineTotal: Money | null; clientLineTotal: Money | null;
    /** Job 010 answer fields; null on an old Lambda response. */
    orderItemId: number | null; myAnswer: ItemAnswer | null; myProblem: string | null;
  }> | null;
  /** The Lambda returned answer fields for every item (job 010), so answers can be shown. */
  hasAnswers: boolean;
  /** Answer controls are shown: answer fields present and the order is still «Новый». */
  canAnswer: boolean;
  /** Items this pharmacy routed to «Ватан 2» («Передано в Ватан 2: N поз.»). */
  routedAwayCount: number;
  showPrices: boolean;
  showClientPrices: boolean;
  total: Money | null;
  clientTotal: Money | null;
  profit: Money | null;
  /** «Сайт» / «Сотрудник N» when the `creator` field is ON, otherwise null. */
  creator: string | null;
};

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function amount(value: unknown): Money | null {
  return typeof value === 'number' || (typeof value === 'string' && value.trim() !== '') ? value : null;
}

/**
 * Builds the pharmacy card model. Follows the `pharmacy_web` policy the Lambda already applied:
 * a field is shown when the API returns it (owner turned it ON) and hidden when it is absent.
 * Defaults (Lambda side) keep client identity, client totals, profit and creator OFF.
 */
export function pharmacyOrderView(order: PharmacyOrderInput): PharmacyOrderView {
  const medicines = Array.isArray(order.medicines) ? order.medicines : null;
  const hasItems = !!medicines && medicines.length > 0;
  const showPrices = hasItems
    && medicines.every((item) => amount(item.base_unit_price) != null && amount(item.base_line_total) != null);
  const showClientPrices = hasItems && medicines.every((item) => amount(item.line_total) != null);
  const hasAnswers = hasItems && medicines.every((item) => typeof item.order_item_id === 'number'
    && Number.isSafeInteger(item.order_item_id) && item.order_item_id > 0 && 'my_answer' in item);
  const status = order.status === 'pending' || order.status === 'confirmed' ? order.status : null;
  const waitingSince = order.awaiting_response === true && typeof order.waiting_since === 'string'
    ? order.waiting_since : null;
  let creator: string | null = null;
  if ('created_by_staff_account_id' in order) {
    const id = order.created_by_staff_account_id;
    creator = id == null || id === '' ? 'Сайт' : `Сотрудник ${id}`;
  }
  return {
    reference: order.order_reference || order.order_id,
    createdAt: order.created_at || null,
    status,
    waitingSince,
    source: text(order.source),
    customerName: text(order.customer_name),
    phone: text(order.phone),
    address: text(order.address),
    landmark: text(order.landmark),
    notes: text(order.notes),
    medicines: medicines && medicines.map((item) => ({
      name: item.medicine_name,
      quantity: item.quantity ?? null,
      unitPrice: showPrices ? amount(item.base_unit_price) : null,
      lineTotal: showPrices ? amount(item.base_line_total) : null,
      clientLineTotal: showClientPrices ? amount(item.line_total) : null,
      orderItemId: hasAnswers ? item.order_item_id ?? null : null,
      myAnswer: hasAnswers ? itemAnswer(item.my_answer) : null,
      myProblem: hasAnswers ? text(item.my_problem) : null,
    })),
    hasAnswers,
    canAnswer: hasAnswers && status === 'pending',
    routedAwayCount: typeof order.routed_away_count === 'number' && order.routed_away_count > 0 ? order.routed_away_count : 0,
    showPrices,
    showClientPrices,
    total: amount(order.base_total),
    clientTotal: amount(order.order_total),
    profit: amount(order.profit),
    creator,
  };
}
