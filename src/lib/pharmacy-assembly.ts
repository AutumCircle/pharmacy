import type {
  CourierAssemblyMark, CourierAssemblyState, PharmacyAssemblyRequest, PharmacyAssemblyState, PharmacyItemCollectRequest,
} from './api-v1/staff-types';

// Pharmacy assembly marks per (order, pharmacy), while the order is «Новый» (or already confirmed).
// Job 015: one «Собран» button for both pharmacies (none -> assembled); «Собирается» remains only for old
// clients and the job 014 reopen of «Ватан 2». After «Собран» the pharmacy's part is read-only. The courier's
// «Согласовано» waits until every pharmacy holding items is «Собран». Customer statuses and /tracking never
// change. Lambda is the authority.

export const ASSEMBLY_STATES: readonly PharmacyAssemblyState[] = ['assembling', 'assembled'];

/** Chip / line wording. No mark = «Ждёт сборки». */
export const ASSEMBLY_LABELS: Record<CourierAssemblyState, string> = {
  waiting: 'Ждёт сборки',
  assembling: 'Собирается',
  assembled: 'Собран',
};

export const ASSEMBLY_WARNING = 'Не все аптеки отметили «Собран»';

/** Same text as Lambda's 409 ASSEMBLY_NOT_COMPLETE on «Согласовано». */
export const ASSEMBLY_NOT_COMPLETE = 'Сначала все аптеки должны отметить «Сборка сделана»';

const PHARMACY_NAMES: Record<1 | 2, string> = { 1: 'Ватан 1', 2: 'Ватан 2' };

export function isAssemblyState(value: unknown): value is PharmacyAssemblyState {
  return typeof value === 'string' && (ASSEMBLY_STATES as readonly string[]).includes(value);
}

export type AssemblyValidation = { ok: true; value: PharmacyAssemblyRequest } | { ok: false; error: string };

/** Mirrors Lambda `validate_assembly_request`: body is exactly {"state": "assembling" | "assembled"}. */
export function validateAssemblyRequest(body: unknown): AssemblyValidation {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'Укажите отметку сборки' };
  const keys = Object.keys(body);
  const state = (body as Record<string, unknown>).state;
  if (keys.length !== 1 || keys[0] !== 'state' || !isAssemblyState(state)) {
    return { ok: false, error: 'Укажите отметку сборки' };
  }
  return { ok: true, value: { state } };
}

export type CollectValidation = { ok: true; value: PharmacyItemCollectRequest } | { ok: false; error: string };

/** Mirrors Lambda `validate_item_collect_request`: body is exactly {"order_item_id": <positive int>}. */
export function validateItemCollectRequest(body: unknown): CollectValidation {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'Укажите позицию заказа' };
  const keys = Object.keys(body);
  const id = (body as Record<string, unknown>).order_item_id;
  if (keys.length !== 1 || keys[0] !== 'order_item_id' || typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) {
    return { ok: false, error: 'Укажите позицию заказа' };
  }
  return { ok: true, value: { order_item_id: id } };
}

/** Chip for this pharmacy's own mark; tone matches the existing pa-tone-* classes. */
export function assemblyChip(state: PharmacyAssemblyState | null | undefined): { text: string; tone: string } {
  if (state === 'assembled') return { text: ASSEMBLY_LABELS.assembled, tone: 'ok' };
  if (state === 'assembling') return { text: ASSEMBLY_LABELS.assembling, tone: 'warn' };
  return { text: ASSEMBLY_LABELS.waiting, tone: 'wait' };
}

type PharmacyAssemblyInput = { assembly_available?: boolean; assembly_state?: string | null };

export type AssemblyAction = { state: PharmacyAssemblyState; label: string };

/** Job 015: the one button under the pharmacy table. */
export const ASSEMBLED_ACTION: AssemblyAction = { state: 'assembled', label: 'Собран' };

/**
 * Job 015: the button on the pharmacy card is always «Собран» until the part is «Собран» (then only the
 * chip). Null when the Lambda did not offer assembly (nothing to assemble, a closed order, or an old Lambda
 * without the field).
 */
export function nextAssemblyAction(order: PharmacyAssemblyInput): AssemblyAction | null {
  if (order.assembly_available !== true) return null;
  if (order.assembly_state === 'assembled') return null;
  return { ...ASSEMBLED_ACTION };
}

type CourierAssemblyInput = {
  status?: string;
  assembly?: CourierAssemblyMark[] | null;
  assembly_complete?: boolean;
};

function pharmacyName(id: number): string {
  return id === 1 || id === 2 ? PHARMACY_NAMES[id] : `Аптека ${id}`;
}

function courierState(value: unknown): CourierAssemblyState {
  return value === 'assembling' || value === 'assembled' ? value : 'waiting';
}

export type CourierAssemblyLine = { pharmacyId: number; state: CourierAssemblyState; text: string };

/** One line per assembly pharmacy: «Ватан 1: собран», «Ватан 2: собирается», «Ватан 2: ждёт сборки». */
export function courierAssemblyLines(order: CourierAssemblyInput): CourierAssemblyLine[] {
  if (!Array.isArray(order.assembly)) return [];
  return order.assembly
    .filter((mark) => mark && typeof mark.pharmacy_id === 'number')
    .slice()
    .sort((a, b) => a.pharmacy_id - b.pharmacy_id)
    .map((mark) => {
      const state = courierState(mark.state);
      return { pharmacyId: mark.pharmacy_id, state,
        text: `${pharmacyName(mark.pharmacy_id)}: ${ASSEMBLY_LABELS[state].toLowerCase()}` };
    });
}

/** Short one-line summary for the courier list; null when there is nothing to show. */
export function courierAssemblySummary(order: CourierAssemblyInput): string | null {
  const lines = courierAssemblyLines(order);
  return lines.length ? lines.map((line) => line.text).join(' · ') : null;
}

/**
 * Rework 1: «Согласовано» (pending -> confirmed) is blocked while a pharmacy holding items has not marked
 * «Сборка сделана». Returns the reason, or null when the courier may confirm (also for an old Lambda
 * payload, courier-created orders and orders with nothing to assemble). Lambda enforces the same rule.
 */
export function confirmBlockedReason(order: CourierAssemblyInput & { website_order?: boolean }): string | null {
  if (order.status !== 'pending' || order.website_order === false || !Array.isArray(order.assembly)
    || typeof order.assembly_complete !== 'boolean') return null;
  return order.assembly_complete ? null : ASSEMBLY_NOT_COMPLETE;
}

/**
 * Warning next to step 5 and «Выехал»: shown only while the order is confirmed and the Lambda says
 * not every pharmacy marked «Собран» (orders confirmed before rework 1 or by the admin). Absent for an
 * old Lambda payload. Never blocks the courier.
 */
export function assemblyWarning(order: CourierAssemblyInput): string | null {
  if (order.status !== 'confirmed' || !Array.isArray(order.assembly) || typeof order.assembly_complete !== 'boolean') {
    return null;
  }
  return order.assembly_complete ? null : ASSEMBLY_WARNING;
}
