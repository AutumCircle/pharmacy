import 'server-only';

import type {
  ApiErrorResponse,
  ApiListResponse,
  ApiSuccessResponse,
  CategoriesResponse,
  CategoryMedicinesResponse,
  CreateOrderRequest,
  CreateOrderResponse,
  MedicineResponse,
  MedicineSearchResponse,
  ResolveMedicinesResponse,
  FeaturedProductsResponse,
  HomepageBannersResponse,
  ProductCarouselsResponse,
  TrackOrdersResponse,
} from './types';

// CloudWatch shows that this Lambda normally completes warm requests in a few
// milliseconds and cold requests in well under one second. Do not leave the UI
// waiting for 25 seconds when the upstream connection itself is unhealthy.
const READ_TIMEOUT_MS = 10_000;
const MUTATION_TIMEOUT_MS = 8_000;

export class ApiV1Error extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: ApiErrorResponse['error']['details'],
  ) {
    super(message);
    this.name = 'ApiV1Error';
  }
}

function configuration(): { baseUrl: string; apiKey: string } {
  const rawBaseUrl = process.env.API_V1_BASE_URL || process.env.NEXT_PUBLIC_API_URL;
  const apiKey = process.env.API_KEY;
  if (!rawBaseUrl || !apiKey) {
    throw new ApiV1Error(500, 'API_CONFIGURATION_ERROR', 'API v1 server configuration is incomplete');
  }
  let url: URL;
  try {
    url = new URL(rawBaseUrl);
  } catch {
    throw new ApiV1Error(500, 'API_CONFIGURATION_ERROR', 'API v1 base URL is invalid');
  }
  if (url.protocol !== 'https:' && url.hostname !== 'localhost') {
    throw new ApiV1Error(500, 'API_CONFIGURATION_ERROR', 'API v1 base URL must use HTTPS');
  }
  return { baseUrl: url.toString().replace(/\/$/, ''), apiKey };
}

async function parseResponse<T>(response: Response): Promise<T> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ApiV1Error(502, 'UPSTREAM_INVALID_RESPONSE', 'API v1 returned invalid JSON');
  }
  if (!response.ok) {
    const errorPayload = payload as Partial<ApiErrorResponse>;
    throw new ApiV1Error(
      response.status,
      errorPayload.error?.code || 'UPSTREAM_ERROR',
      errorPayload.error?.message || 'API v1 request failed',
      errorPayload.error?.details,
    );
  }
  if (!payload || typeof payload !== 'object' || !('data' in payload) || !('request_id' in payload)) {
    throw new ApiV1Error(502, 'UPSTREAM_INVALID_RESPONSE', 'API v1 response shape is invalid');
  }
  return payload as T;
}

interface RequestOptions {
  method?: 'GET' | 'POST';
  body?: unknown;
  idempotencyKey?: string;
  cacheSeconds?: number;
  retryable?: boolean;
  readOnly?: boolean;
  timeoutMs?: number;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { baseUrl, apiKey } = configuration();
  const method = options.method || 'GET';
  const isGet = method === 'GET';
  const isRead = isGet || options.readOnly === true;
  const attempts = isRead || options.retryable ? 2 : 1;
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      options.timeoutMs ?? (isRead ? READ_TIMEOUT_MS : MUTATION_TIMEOUT_MS),
    );
    try {
      const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          ...(options.idempotencyKey ? { 'Idempotency-Key': options.idempotencyKey } : {}),
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: controller.signal,
        ...(isGet && options.cacheSeconds
          ? { next: { revalidate: options.cacheSeconds } }
          : { cache: 'no-store' as const }),
      });
      return await parseResponse<T>(response);
    } catch (error) {
      const requestError = controller.signal.aborted
        ? new ApiV1Error(504, 'UPSTREAM_TIMEOUT', 'API v1 did not answer in time')
        : error instanceof ApiV1Error
          ? error
          : new ApiV1Error(502, 'UPSTREAM_UNREACHABLE', 'API v1 is temporarily unreachable');
      lastError = requestError;
      if (requestError.code === 'UPSTREAM_TIMEOUT' || requestError.status < 500 || attempt === attempts - 1) {
        throw requestError;
      }
      await new Promise((resolve) => setTimeout(resolve, 150 + Math.floor(Math.random() * 150)));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError;
}

function queryString(values: Record<string, string | number | null | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  }
  const encoded = params.toString();
  return encoded ? `?${encoded}` : '';
}

export function searchPublicMedicines(q: string, limit = 20, cursor?: string): Promise<MedicineSearchResponse> {
  return request(`/v1/public/medicines/search${queryString({ q, limit, cursor })}`, { cacheSeconds: 30 });
}

export function getPublicMedicine(medicineId: number): Promise<MedicineResponse> {
  return request(`/v1/public/medicines/${medicineId}`, { cacheSeconds: 30 });
}

export function resolvePublicMedicines(medicineIds: number[]): Promise<ResolveMedicinesResponse> {
  return request('/v1/public/medicines/resolve', {
    method: 'POST',
    body: { medicine_ids: medicineIds },
    readOnly: true,
  });
}

export function getPublicHomepageBanners(): Promise<HomepageBannersResponse> {
  return request('/v1/public/homepage-banners', { cacheSeconds: 60 });
}

export function getPublicFeaturedProducts(): Promise<FeaturedProductsResponse> {
  return request('/v1/public/featured-products', { cacheSeconds: 60 });
}

export function getPublicProductCarousels(): Promise<ProductCarouselsResponse> {
  return request('/v1/public/product-carousels', { cacheSeconds: 60 });
}

export function getPublicCategories(limit = 20, cursor?: string): Promise<CategoriesResponse> {
  return request(`/v1/public/categories${queryString({ limit, cursor })}`, { cacheSeconds: 60 });
}

export function getPublicCategoryMedicines(
  slug: string,
  limit = 20,
  cursor?: string,
): Promise<CategoryMedicinesResponse> {
  return request(`/v1/public/categories/${encodeURIComponent(slug)}/medicines${queryString({ limit, cursor })}`, {
    cacheSeconds: 30,
  });
}

export function createPublicOrder(
  body: CreateOrderRequest,
  idempotencyKey: string,
): Promise<CreateOrderResponse> {
  // Retrying is safe here because Lambda stores this UUID and returns the
  // original order instead of inserting a duplicate.
  return request('/v1/public/orders', {
    method: 'POST',
    body,
    idempotencyKey,
    retryable: true,
  });
}

export function trackPublicOrders(phone: string): Promise<TrackOrdersResponse> {
  return request('/v1/public/orders/track', { method: 'POST', body: { phone }, readOnly: true });
}

export type AnyApiSuccess<T> = ApiSuccessResponse<T> | ApiListResponse<T>;
