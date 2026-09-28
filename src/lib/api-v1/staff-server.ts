import 'server-only';
import type { ApiErrorResponse, ApiSuccessResponse } from './types';
import type { StaffAccount } from './staff-types';
import type { AdminCatalogStats, AdminMedicine, AdminNumberedListResponse } from './admin-types';
import { ApiV1Error } from './server';

async function request<T>(path: string, token?: string, credentials?: { username: string; password: string }): Promise<T> {
  const base = process.env.API_V1_BASE_URL;
  const apiKey = process.env.API_KEY;
  const bearer = process.env.STAFF_API_BEARER_TOKEN;
  if (!base || !apiKey || !bearer || bearer.length < 32) throw new Error('STAFF_API_CONFIGURATION_ERROR');
  const url = new URL(base);
  if (url.protocol !== 'https:' && url.hostname !== 'localhost') throw new Error('STAFF_API_CONFIGURATION_ERROR');
  const response = await fetch(`${url.toString().replace(/\/$/, '')}/v1/staff/${path}`, {
    method: credentials ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey,
      Authorization: `Bearer ${bearer}`, ...(token ? { 'x-staff-session': token } : {}) },
    body: credentials ? JSON.stringify(credentials) : undefined,
    cache: 'no-store', signal: AbortSignal.timeout(10_000),
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = payload as Partial<ApiErrorResponse> | null;
    throw new ApiV1Error(response.status, error?.error?.code || 'UPSTREAM_ERROR', 'Staff API request failed');
  }
  if (!payload || typeof payload !== 'object' || !('data' in payload) || !('request_id' in payload)) {
    throw new ApiV1Error(502, 'UPSTREAM_INVALID_RESPONSE', 'Staff API response shape is invalid');
  }
  return payload as T;
}

export async function loginStaff(credentials: { username: string; password: string }) {
  const result = await request<ApiSuccessResponse<{ token: string }>>('login', undefined, credentials);
  if (typeof result.data?.token !== 'string') throw new Error('UPSTREAM_INVALID_RESPONSE');
  return result.data.token;
}

export async function getStaffSession(token: string): Promise<StaffAccount> {
  const { data } = await request<ApiSuccessResponse<StaffAccount>>('session', token);
  if (!data || ![1, 2].includes(data.account_id) || typeof data.catalog_access !== 'boolean'
    || typeof data.username !== 'string' || !Number.isInteger(data.credential_version)) throw new Error('UPSTREAM_INVALID_RESPONSE');
  return data;
}

export function listStaffMedicines(token: string, values: { q: string; availability: string; page: number; limit: number }) {
  const query = new URLSearchParams(Object.entries(values).map(([key, value]) => [key, String(value)]));
  return request<AdminNumberedListResponse<AdminMedicine>>(`medicines?${query}`, token);
}

export function getStaffCatalogStats(token: string) {
  return request<ApiSuccessResponse<AdminCatalogStats>>('catalog/stats', token);
}
