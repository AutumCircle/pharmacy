import 'server-only';
import { createHmac } from 'node:crypto';
import type { ApiErrorResponse, ApiSuccessResponse } from './types';
import type { CourierEarnings, CourierOrder, CourierOrderList, CourierOrderStatus, CreateStaffOrderRequest, PharmacyAnswersRequest, PharmacyAnswersResult, PharmacyAssemblyRequest, PharmacyAssemblyResult, PharmacyPreparationOrderList, StaffAccount, StaffOrderCreated, StaffOrderMedicine } from './staff-types';
import type { AdminCatalogStats, AdminMedicine, AdminNumberedListResponse } from './admin-types';
import { ApiV1Error } from './server';

type StaffRequestOptions = {
  token?: string;
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  idempotencyKey?: string;
};

async function request<T>(path: string, options: StaffRequestOptions = {}): Promise<T> {
  const base = process.env.API_V1_BASE_URL;
  const apiKey = process.env.API_KEY;
  const sessionSecret = process.env.ADMIN_SESSION_SECRET;
  const bearer = process.env.STAFF_API_BEARER_TOKEN
    || (sessionSecret && sessionSecret.length >= 32
      ? createHmac('sha256', sessionSecret).update('pharmacy-vatan:staff-api:v1').digest('hex')
      : '');
  if (!base || !apiKey || bearer.length < 32) throw new Error('STAFF_API_CONFIGURATION_ERROR');
  const url = new URL(base);
  if (url.protocol !== 'https:' && url.hostname !== 'localhost') throw new Error('STAFF_API_CONFIGURATION_ERROR');
  const response = await fetch(`${url.toString().replace(/\/$/, '')}/v1/staff/${path}`, {
    method: options.method ?? 'GET',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey,
      Authorization: `Bearer ${bearer}`,
      ...(options.token ? { 'x-staff-session': options.token } : {}),
      ...(options.idempotencyKey ? { 'Idempotency-Key': options.idempotencyKey } : {}) },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    cache: 'no-store', signal: AbortSignal.timeout(10_000),
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = payload as Partial<ApiErrorResponse> | null;
    throw new ApiV1Error(response.status, error?.error?.code || 'UPSTREAM_ERROR',
      error?.error?.message || 'Не удалось выполнить запрос', error?.error?.details);
  }
  if (!payload || typeof payload !== 'object' || !('data' in payload) || !('request_id' in payload)) {
    throw new ApiV1Error(502, 'UPSTREAM_INVALID_RESPONSE', 'Staff API response shape is invalid');
  }
  return payload as T;
}

export async function loginStaff(credentials: { username: string; password: string }) {
  const result = await request<ApiSuccessResponse<{ token: string }>>('login', { method: 'POST', body: credentials });
  if (typeof result.data?.token !== 'string') throw new Error('UPSTREAM_INVALID_RESPONSE');
  return result.data.token;
}

export async function getStaffSession(token: string): Promise<StaffAccount> {
  const { data } = await request<ApiSuccessResponse<StaffAccount>>('session', { token });
  if (!data || ![1, 2, 3].includes(data.account_id) || typeof data.catalog_access !== 'boolean'
    || data.role !== (data.account_id === 3 ? 'courier' : 'pharmacy')
    || typeof data.username !== 'string' || !Number.isInteger(data.credential_version)) throw new Error('UPSTREAM_INVALID_RESPONSE');
  return data;
}

export function listStaffMedicines(token: string, values: { q: string; availability: string; page: number; limit: number }) {
  const query = new URLSearchParams(Object.entries(values).map(([key, value]) => [key, String(value)]));
  return request<AdminNumberedListResponse<AdminMedicine>>(`medicines?${query}`, { token });
}

export function getStaffCatalogStats(token: string) {
  return request<ApiSuccessResponse<AdminCatalogStats>>('catalog/stats', { token });
}

export function createStaffOrder(token: string, body: CreateStaffOrderRequest, idempotencyKey: string) {
  return request<ApiSuccessResponse<StaffOrderCreated & { _notification?: Record<string, unknown> }>>('orders', {
    token, method: 'POST', body, idempotencyKey,
  });
}

export function searchStaffOrderMedicines(token: string, query: string) {
  const params = new URLSearchParams({ q: query });
  return request<AdminNumberedListResponse<StaffOrderMedicine>>(`order-medicines?${params}`, { token });
}

export function listCourierOrders(token: string, values: { status?: CourierOrderStatus; cursor?: string; limit?: number }) {
  const params = new URLSearchParams();
  if (values.status) params.set('status', values.status);
  if (values.cursor) params.set('cursor', values.cursor);
  params.set('limit', String(values.limit ?? 20));
  return request<CourierOrderList>(`orders?${params}`, { token });
}

export function addCourierOrderItems(token: string, orderId: string,
  items: Array<{ medicine_id: number; quantity: number; unit_price?: string }>, idempotencyKey: string) {
  return request<ApiSuccessResponse<{ order_id: string; added: number; quantity_increased: number;
    items_subtotal: string; currency: 'TJS' }>>(
    `orders/${encodeURIComponent(orderId)}/items`,
    { token, method: 'POST', body: { items }, idempotencyKey },
  );
}

export function addCourierManualOrderItems(token: string, orderId: string,
  manualItems: Array<{ medicine_name: string; price: string; quantity: number }>, idempotencyKey: string) {
  return request<ApiSuccessResponse<{ order_id: string; added: number; items_subtotal: string; currency: 'TJS' }>>(
    `orders/${encodeURIComponent(orderId)}/manual-items`,
    { token, method: 'POST', body: { manual_items: manualItems }, idempotencyKey },
  );
}

export function listPharmacyPreparationOrders(token: string, values: { cursor?: string; limit?: number } = {}) {
  const params = new URLSearchParams({ limit: String(values.limit ?? 20) });
  if (values.cursor) params.set('cursor', values.cursor);
  return request<PharmacyPreparationOrderList>(`orders?${params}`, { token });
}

export function getCourierEarnings(token: string, values: { cursor?: string; limit?: number } = {}) {
  const params = new URLSearchParams({ limit: String(values.limit ?? 31) });
  if (values.cursor) params.set('cursor', values.cursor);
  return request<ApiSuccessResponse<CourierEarnings>>(`earnings?${params}`, { token });
}

export function updateCourierOrderStatus(token: string, orderId: string, body: {
  status: CourierOrderStatus; expected_current_status: CourierOrderStatus; reason?: string;
}) {
  return request<ApiSuccessResponse<{ order_id: string; status: CourierOrderStatus; changed_at: string }>>(
    `orders/${encodeURIComponent(orderId)}/status`, { token, method: 'PATCH', body },
  );
}

export type CourierCustomerFields = { customer_name: string; phone: string; address: string; landmark: string };

export function updateCourierOrderCustomer(token: string, orderId: string, body: CourierCustomerFields) {
  return request<ApiSuccessResponse<{ order_id: string } & CourierCustomerFields>>(
    `orders/${encodeURIComponent(orderId)}/customer`, { token, method: 'PATCH', body },
  );
}

export function getCourierOrder(token: string, orderId: string) {
  return request<ApiSuccessResponse<CourierOrder>>(`orders/${encodeURIComponent(orderId)}`, { token });
}

export function updateCourierOrderItem(token: string, orderId: string, itemId: number,
  body: { quantity?: number; unit_price?: string } | null) {
  return request<ApiSuccessResponse<{ order_id: string; order_item_id: number; removed: boolean;
    order_total: string; currency: 'TJS' }>>(
    `orders/${encodeURIComponent(orderId)}/items/${itemId}`,
    body === null ? { token, method: 'DELETE' } : { token, method: 'PATCH', body },
  );
}

export function updateCourierDeliveryAmount(token: string, orderId: string, amount: number) {
  return request<ApiSuccessResponse<{ order_id: string; delivery_courier_amount: number | string; currency: 'TJS' }>>(
    `orders/${encodeURIComponent(orderId)}/status`,
    { token, method: 'PATCH', body: { delivery_courier_amount: amount } },
  );
}

export function updateCourierOrderChecklist(token: string, orderId: string, body: { step: number; done: boolean }) {
  return request<ApiSuccessResponse<{ order_id: string; checklist_steps: number[] }>>(
    `orders/${encodeURIComponent(orderId)}/checklist`, { token, method: 'PATCH', body },
  );
}

/** «Начать сборку» / «Собран» (job 011). The pharmacy id comes from the staff session in Lambda. */
export function markPharmacyAssembly(token: string, orderId: string, body: PharmacyAssemblyRequest) {
  return request<ApiSuccessResponse<PharmacyAssemblyResult>>(
    `orders/${encodeURIComponent(orderId)}/assembly`, { token, method: 'POST', body },
  );
}

/** Pharmacist answers per item (job 010). The pharmacy id comes from the staff session in Lambda. */
export function answerPharmacyOrderItems(token: string, orderId: string, body: PharmacyAnswersRequest) {
  return request<ApiSuccessResponse<PharmacyAnswersResult>>(
    `orders/${encodeURIComponent(orderId)}/pharmacy-answers`, { token, method: 'POST', body },
  );
}
