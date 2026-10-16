export type StaffAccount = {
  account_id: 1 | 2 | 3;
  username: string;
  role: 'pharmacy' | 'courier';
  catalog_access: boolean;
  credential_version: number;
  password_set: boolean;
};

export type StaffOrderSource = 'instagram' | 'whatsapp' | 'phone';

export type CreateStaffOrderRequest = {
  customer_name?: string;
  phone: string;
  address: string;
  landmark: string;
  comment?: string;
  source: StaffOrderSource;
  items: Array<{ medicine_id: number; quantity: number; unit_price?: string }>;
  manual_items?: Array<{ medicine_name: string; price: string; quantity: number }>;
  pharmacy_id?: 1 | 2;
};

export type StaffOrderMedicine = {
  medicine_id: number;
  medicine_name: string;
  base_unit_price: number | string;
  selling_unit_price: number | string;
  source_sku: string | null;
  country: string | null;
  vendor: string | null;
  in_stock: boolean;
};

export type StaffOrderCreated = {
  order_id: string;
  order_reference: string;
  status: 'pending';
  created_at: string;
  created_by_staff_account_id: 1 | 2 | 3;
  created_by_staff_username: string;
  fulfillment_pharmacy_id: 1 | 2;
  order_source: StaffOrderSource;
};

export type CourierOrderStatus = 'pending' | 'confirmed' | 'delivering' | 'delivered' | 'cancelled';

/** A pharmacist's answer about one order item (job 010). */
export type PharmacyAnswer = 'available' | 'unavailable' | 'price_differs';

export type PharmacyItemAnswer = {
  pharmacy_id: 1 | 2;
  answer: PharmacyAnswer;
  problem: string | null;
  answered_at: string;
};

export type PharmacyAnswersRequest = {
  /** base_unit_price (rework 1, «Ватан 2» only, with «available»): the pharmacy's own price; Lambda
   * recomputes the client price and totals. */
  answers: Array<{ order_item_id: number; answer: PharmacyAnswer; problem?: string | null; base_unit_price?: string }>;
};

export type PharmacyAnswersResult = {
  order_id: string;
  items: Array<{ order_item_id: number; my_answer: PharmacyAnswer | null; my_problem: string | null }>;
  routed_away_count: number;
  awaiting_response: boolean;
};

/** A pharmacy's assembly mark on its part of a confirmed order (job 011). No mark = «Ждёт сборки». */
export type PharmacyAssemblyState = 'assembling' | 'assembled';

/** Courier view of one pharmacy's assembly: 'waiting' while the pharmacy has no mark. */
export type CourierAssemblyState = 'waiting' | PharmacyAssemblyState;

export type PharmacyAssemblyRequest = { state: PharmacyAssemblyState };

export type PharmacyAssemblyResult = {
  order_id: string;
  pharmacy_id: 1 | 2;
  state: PharmacyAssemblyState | null;
  started_at: string | null;
  assembled_at: string | null;
};

/** Per-item «Собрано» (rework 1). */
export type PharmacyItemCollectRequest = { order_item_id: number };

export type PharmacyItemCollectResult = {
  order_id: string;
  order_item_id: number;
  pharmacy_id: 1 | 2;
  collected: true;
  assembly_state: PharmacyAssemblyState | null;
};

/** An item this pharmacy answered «Нет в наличии» that now sits at another pharmacy (rework 1). */
export type PharmacyRoutedAwayItem = {
  order_item_id: number;
  medicine_name: string;
  quantity?: number | string;
  pharmacy_id: 1 | 2;
  /** That pharmacy's answer; null while it has not answered. */
  answer: PharmacyAnswer | null;
};

export type CourierAssemblyMark = {
  pharmacy_id: 1 | 2;
  state: CourierAssemblyState;
  started_at: string | null;
  assembled_at: string | null;
};

export type CourierOrder = {
  order_id: string;
  order_reference: string | null;
  customer_name: string;
  phone: string;
  address: string;
  landmark: string | null;
  notes: string | null;
  order_source: StaffOrderSource | null;
  status: CourierOrderStatus;
  created_at: string;
  pharmacy_id: 1 | 2 | null;
  delivery_courier_amount: number | string;
  order_total: number | string | null;
  website_order: boolean;
  own_order: boolean;
  /** Completed manual courier checklist steps (1, 2, 6), sorted. Steps 4, 5, 7 derive from status,
   * step 3 from the pharmacy answers. */
  checklist_steps: number[];
  medicines: Array<{ order_item_id: number; medicine_id: number | null; medicine_name: string;
    quantity: number | string; base_unit_price: number | string | null;
    selling_unit_price: number | string | null; line_total: number | string | null;
    /** Effective pharmacy of the item (job 010); absent on older Lambdas. */
    pharmacy_id?: 1 | 2;
    /** Every pharmacy's answer about this item, by pharmacy id; absent on older Lambdas. */
    answers?: PharmacyItemAnswer[] }>;
  /** Every item has an answer from its current pharmacy (job 010; absent on older Lambdas). */
  pharmacy_answers_complete?: boolean;
  /** Server-computed client sum of «available» items; null until complete and no price differs. */
  confirmed_total?: string | null;
  /** Items unavailable at their final pharmacy (excluded from confirmed_total). */
  unavailable_count?: number;
  /** Items answered by their current pharmacy / all items («Ответ аптек: N из M»). */
  answered_count?: number;
  item_count?: number;
  /** Job 011: one entry per pharmacy that has something to assemble, by pharmacy id; [] for
   * courier-created orders; absent on older Lambdas (then no marks and no warning are shown). */
  assembly?: CourierAssemblyMark[];
  /** Confirmed and every listed pharmacy marked «Собран». */
  assembly_complete?: boolean;
};

export type CourierOrderList = {
  data: CourierOrder[];
  page: { next_cursor: string | null; has_more: boolean };
  request_id: string;
};

export type PharmacyPreparationOrder = {
  order_id: string;
  order_reference?: string | null;
  status?: 'pending' | 'confirmed';
  created_at?: string;
  /** ISO start of the waiting timer: created_at, or the routing time for items moved to «Ватан 2».
   * Absent on Lambdas older than job 008. */
  waiting_since?: string;
  /** True while the order is pending and an assigned item has no answer from this pharmacy. */
  awaiting_response?: boolean;
  source?: string;
  customer_name?: string;
  phone?: string;
  address?: string;
  landmark?: string | null;
  notes?: string | null;
  medicines?: Array<{ medicine_name: string; quantity?: number; line_total?: number | string;
    base_unit_price?: number | string; base_line_total?: number | string;
    /** Job 010: absent on older Lambdas (then no answer controls are shown). */
    order_item_id?: number; my_answer?: PharmacyAnswer | null; my_problem?: string | null;
    /** Rework 1: the item was routed here from «Ватан 1»; this pharmacy marked it «Собрано». */
    routed_here?: boolean; collected?: boolean }>;
  /** Items this pharmacy answered «Нет в наличии» that were routed to «Ватан 2». */
  routed_away_count?: number;
  /** Rework 1: those items with the other pharmacy's answer (absent when `items` is hidden). */
  routed_away?: PharmacyRoutedAwayItem[];
  /** Job 011: this pharmacy's assembly mark (null = «Ждёт сборки»); absent on older Lambdas. */
  assembly_state?: PharmacyAssemblyState | null;
  /** Job 011: the order is confirmed and this pharmacy has something to assemble. */
  assembly_available?: boolean;
  order_total?: number | string;
  base_total?: number | string;
  profit?: number | string;
  created_by_staff_account_id?: number | null;
};

export type PharmacyPreparationOrderList = {
  data: PharmacyPreparationOrder[];
  page: { next_cursor: string | null; has_more: boolean };
  request_id: string;
};

export type CourierEarnings = {
  total: number | string;
  today: number | string;
  yesterday: number | string;
  daily: Array<{ date: string; orders_count: number; courier_orders_count: number;
    website_orders_count: number; amount: number | string }>;
  currency: 'TJS';
  page: { next_cursor: string | null; has_more: boolean };
};
