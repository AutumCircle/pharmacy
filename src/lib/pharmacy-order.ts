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

/** Only the keys the pharmacy card may read. Extra keys in the API response are ignored. */
export type PharmacyOrderInput = {
  order_id: string;
  order_reference?: string | null;
  status?: string;
  created_at?: string;
  waiting_since?: string;
  awaiting_response?: boolean;
  source?: string;
  notes?: string | null;
  medicines?: Array<{ medicine_name: string; quantity?: number | string; base_unit_price?: Money; base_line_total?: Money }>;
  base_total?: Money;
};

export type PharmacyOrderView = {
  reference: string;
  createdAt: string | null;
  status: 'pending' | 'confirmed' | null;
  waitingSince: string | null;
  source: string | null;
  notes: string | null;
  medicines: Array<{ name: string; quantity: Money | null; unitPrice: Money | null; lineTotal: Money | null }> | null;
  showPrices: boolean;
  total: Money | null;
};

/**
 * Builds the pharmacy card model from an allowlist. Client identity, address, client
 * totals, profit and creator are never copied, even if the Lambda policy returns them.
 */
export function pharmacyOrderView(order: PharmacyOrderInput): PharmacyOrderView {
  const medicines = Array.isArray(order.medicines) ? order.medicines : null;
  const showPrices = !!medicines && medicines.length > 0
    && medicines.every((item) => item.base_unit_price != null && item.base_line_total != null);
  const waitingSince = order.awaiting_response === true && typeof order.waiting_since === 'string'
    ? order.waiting_since : null;
  return {
    reference: order.order_reference || order.order_id,
    createdAt: order.created_at || null,
    status: order.status === 'pending' || order.status === 'confirmed' ? order.status : null,
    waitingSince,
    source: order.source || null,
    notes: order.notes || null,
    medicines: medicines && medicines.map((item) => ({
      name: item.medicine_name,
      quantity: item.quantity ?? null,
      unitPrice: showPrices ? item.base_unit_price ?? null : null,
      lineTotal: showPrices ? item.base_line_total ?? null : null,
    })),
    showPrices,
    total: order.base_total ?? null,
  };
}
