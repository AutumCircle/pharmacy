import { parseOrderTime } from './order-time.ts';
import { orderStageLabel } from './order-stage.ts';
import { crossPharmacyMark, pharmacyAnswerChip, routedAwayMark } from './pharmacy-answers.ts';
import { nextAssemblyAction } from './pharmacy-assembly.ts';

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

export type AssemblyMark = 'assembling' | 'assembled';

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
  stage?: string;
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
    routed_here?: boolean; collected?: boolean;
  }>;
  routed_away_count?: number;
  routed_away?: Array<{ order_item_id?: number; medicine_name: string; quantity?: number | string;
    pharmacy_id?: number; answer?: string | null }>;
  /** Job 011, not policy-gated: this pharmacy's assembly mark and whether it may mark now. */
  assembly_state?: string | null;
  assembly_available?: boolean;
  order_total?: Money | null;
  base_total?: Money;
  profit?: Money | null;
  created_by_staff_account_id?: number | string | null;
};

type Chip = { text: string; tone: string };

/**
 * Job 013: one row of the pharmacy medicines table. `own` rows are this pharmacy's items (with the row
 * controls while the order is pending); `routed` rows are items «Ватан 1» answered «Нет в наличии» that
 * now sit at «Ватан 2» — read-only, with an orange «Ватан 2» or red «Нет в наличии в обеих аптеках» chip.
 */
export type PharmacyTableRow = {
  key: string;
  kind: 'own' | 'routed';
  orderItemId: number | null;
  name: string;
  quantity: Money | null;
  unitPrice: Money | null;
  lineTotal: Money | null;
  clientLineTotal: Money | null;
  myAnswer: ItemAnswer | null;
  myProblem: string | null;
  routedHere: boolean;
  collected: boolean;
  /** Answer-column chip; null on an old Lambda response without answers. */
  chip: Chip | null;
  /** «В наличии» / «Нет в наличии» / «Изменить цену» are shown on this row. */
  canAct: boolean;
  /** Small hint under the name of a routed row («Ждёт ответа Ватан 2» while «Ватан 2» has not answered). */
  hint: string | null;
};

export type PharmacyOrderView = {
  reference: string;
  createdAt: string | null;
  status: 'pending' | 'confirmed' | null;
  /** Job 013: chip text of the order («Собирается» / «Собран» / «Подтверждён»); null when status is hidden. */
  stageLabel: string | null;
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
    /** Rework 1: routed here from «Ватан 1» (per-item controls), and marked «Собрано» by this pharmacy. */
    routedHere: boolean; collected: boolean;
    /** Owner's colour for routed items: orange «В аптеке 2» / red «Нет в наличии в обеих аптеках». */
    crossMark: { text: string; tone: 'orange' | 'bad' } | null;
  }> | null;
  /** The Lambda returned answer fields for every item (job 010), so answers can be shown. */
  hasAnswers: boolean;
  /** Answer controls are shown: answer fields present and the order is still «Новый». */
  canAnswer: boolean;
  /** Items this pharmacy routed to «Ватан 2». */
  routedAwayCount: number;
  /** Job 013: own items and items routed to «Ватан 2» in one table, in order_item_id order; null when the
   * items are hidden by the policy. */
  rows: PharmacyTableRow[] | null;
  /** The table has an answer column (answers present or routed rows to mark). */
  answerColumn: boolean;
  /** Show «Начать сборку» / «Сборка сделана» (hidden when every own item came routed: those are per item). */
  partControls: boolean;
  /** Job 011: this pharmacy's mark (null = «Ждёт сборки» or an old Lambda). */
  assemblyState: AssemblyMark | null;
  /** Job 011: «Начать сборку» / «Собран» controls are shown; false when the field is absent. */
  assemblyAvailable: boolean;
  /** Next assembly action, null when there is none (see nextAssemblyAction). */
  assemblyAction: { state: AssemblyMark; label: string } | null;
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
  const assemblyState: AssemblyMark | null = order.assembly_state === 'assembling' || order.assembly_state === 'assembled'
    ? order.assembly_state : null;
  const assemblyAvailable = order.assembly_available === true;
  const canAnswer = hasAnswers && status === 'pending';
  const ownRows: PharmacyTableRow[] = (medicines ?? []).map((item, index) => {
    const myAnswer = hasAnswers ? itemAnswer(item.my_answer) : null;
    const routedHere = hasAnswers && item.routed_here === true;
    const crossMark = hasAnswers ? crossPharmacyMark(routedHere, myAnswer) : null;
    return {
      key: `own-${hasAnswers ? item.order_item_id : `i${index}`}`,
      kind: 'own',
      orderItemId: hasAnswers ? item.order_item_id ?? null : null,
      name: item.medicine_name,
      quantity: item.quantity ?? null,
      unitPrice: showPrices ? amount(item.base_unit_price) : null,
      lineTotal: showPrices ? amount(item.base_line_total) : null,
      clientLineTotal: showClientPrices ? amount(item.line_total) : null,
      myAnswer,
      myProblem: hasAnswers ? text(item.my_problem) : null,
      routedHere,
      collected: hasAnswers && item.collected === true,
      chip: hasAnswers ? crossMark ?? pharmacyAnswerChip(myAnswer) : null,
      // «Ватан 2» keeps its per-item controls for items routed here (PharmacyRoutedItems).
      canAct: canAnswer && !routedHere,
      hint: null,
    };
  });
  const routedRows: PharmacyTableRow[] = medicines && Array.isArray(order.routed_away)
    ? order.routed_away.filter((entry) => entry && typeof entry.medicine_name === 'string').map((entry, index) => {
      const id = typeof entry.order_item_id === 'number' && Number.isSafeInteger(entry.order_item_id)
        && entry.order_item_id > 0 ? entry.order_item_id : null;
      return {
        key: `routed-${id ?? `i${index}`}`, kind: 'routed', orderItemId: id, name: entry.medicine_name,
        quantity: entry.quantity ?? null, unitPrice: null, lineTotal: null, clientLineTotal: null,
        myAnswer: 'unavailable', myProblem: null, routedHere: false, collected: false,
        chip: routedAwayMark(itemAnswer(entry.answer)), canAct: false,
        hint: itemAnswer(entry.answer) === null ? 'Ждёт ответа Ватан 2' : null,
      };
    }) : [];
  const rows = medicines ? [...ownRows, ...routedRows]
    .map((row, position) => ({ row, position }))
    .sort((a, b) => (a.row.orderItemId ?? Number.MAX_SAFE_INTEGER) - (b.row.orderItemId ?? Number.MAX_SAFE_INTEGER)
      || a.position - b.position)
    .map(({ row }) => row) : null;
  let creator: string | null = null;
  if ('created_by_staff_account_id' in order) {
    const id = order.created_by_staff_account_id;
    creator = id == null || id === '' ? 'Сайт' : `Сотрудник ${id}`;
  }
  return {
    reference: order.order_reference || order.order_id,
    createdAt: order.created_at || null,
    status,
    stageLabel: status ? orderStageLabel({ status, stage: order.stage }) : null,
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
      routedHere: hasAnswers && item.routed_here === true,
      collected: hasAnswers && item.collected === true,
      crossMark: hasAnswers ? crossPharmacyMark(item.routed_here === true, itemAnswer(item.my_answer)) : null,
    })),
    hasAnswers,
    canAnswer,
    routedAwayCount: typeof order.routed_away_count === 'number' && order.routed_away_count > 0 ? order.routed_away_count : 0,
    rows,
    answerColumn: hasAnswers || routedRows.length > 0,
    partControls: assemblyAvailable
      && !(hasAnswers && !!medicines && medicines.length > 0 && medicines.every((item) => item.routed_here === true)),
    assemblyState,
    assemblyAvailable,
    assemblyAction: nextAssemblyAction({ assembly_available: assemblyAvailable, assembly_state: assemblyState }),
    showPrices,
    showClientPrices,
    total: amount(order.base_total),
    clientTotal: amount(order.order_total),
    profit: amount(order.profit),
    creator,
  };
}
