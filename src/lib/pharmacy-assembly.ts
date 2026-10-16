import type {
  CourierAssemblyMark, CourierAssemblyState, PharmacyAssemblyRequest, PharmacyAssemblyState,
} from './api-v1/staff-types';

// Pharmacy assembly marks (job 011): «Начать сборку» -> «Собирается», «Собран» -> «Собран», per
// (order, pharmacy). Internal to staff: the customer status and /tracking never change. Lambda is the
// authority: it takes the pharmacy id from the staff session and enforces status, ownership and order.

export const ASSEMBLY_STATES: readonly PharmacyAssemblyState[] = ['assembling', 'assembled'];

/** Chip / line wording. No mark = «Ждёт сборки». */
export const ASSEMBLY_LABELS: Record<CourierAssemblyState, string> = {
  waiting: 'Ждёт сборки',
  assembling: 'Собирается',
  assembled: 'Собран',
};

export const ASSEMBLY_WARNING = 'Не все аптеки отметили «Собран»';

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

/** Chip for this pharmacy's own mark; tone matches the existing pa-tone-* classes. */
export function assemblyChip(state: PharmacyAssemblyState | null | undefined): { text: string; tone: string } {
  if (state === 'assembled') return { text: ASSEMBLY_LABELS.assembled, tone: 'ok' };
  if (state === 'assembling') return { text: ASSEMBLY_LABELS.assembling, tone: 'warn' };
  return { text: ASSEMBLY_LABELS.waiting, tone: 'wait' };
}

type PharmacyAssemblyInput = { assembly_available?: boolean; assembly_state?: string | null };

export type AssemblyAction = { state: PharmacyAssemblyState; label: string };

/**
 * The next button on the pharmacy card: «Начать сборку», then «Собран», then nothing (the chip says
 * «Собран»). Null when the Lambda did not offer assembly (not confirmed, nothing to assemble, or an
 * old Lambda without the field).
 */
export function nextAssemblyAction(order: PharmacyAssemblyInput): AssemblyAction | null {
  if (order.assembly_available !== true) return null;
  const state = order.assembly_state ?? null;
  if (state === null) return { state: 'assembling', label: 'Начать сборку' };
  if (state === 'assembling') return { state: 'assembled', label: 'Собран' };
  return null;
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
 * Warning next to step 5 and «Выехал»: shown only while the order is confirmed and the Lambda says
 * not every pharmacy marked «Собран». Absent for an old Lambda payload. Never blocks the courier.
 */
export function assemblyWarning(order: CourierAssemblyInput): string | null {
  if (order.status !== 'confirmed' || !Array.isArray(order.assembly) || typeof order.assembly_complete !== 'boolean') {
    return null;
  }
  return order.assembly_complete ? null : ASSEMBLY_WARNING;
}
