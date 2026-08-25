import 'server-only';

import type { ApiErrorResponse, ApiSuccessResponse, OrderStatus } from './types';
import type {
  AdminApiListResponse,
  AdminCatalogStats,
  AdminCategory,
  AdminCategoryMedicineBulkAddResult,
  AdminCategoryMedicineBulkPreviewResponse,
  AdminCategoryMedicine,
  AdminDuplicateDetailResponse,
  AdminDuplicateGroup,
  AdminDashboardSummary,
  AdminMedicine,
  AdminMedicineCandidate,
  AdminMedicineExport,
  AdminBatchAddResult,
  AdminBatchRemoveResult,
  AdminCarouselProduct,
  AdminFeaturedProduct,
  AdminHomepageBanner,
  AdminNumberedListResponse,
  AdminOrderDetail,
  AdminOrderSummary,
  AdminPricingSettings,
  AdminProductCarousel,
  CatalogSyncSummary,
} from './admin-types';
import { ApiV1Error } from './server';

// The deployed admin Lambda has the same sub-second cold-start profile as the
// public Lambda, so a 25-second wait only hides an unhealthy connection.
const READ_TIMEOUT_MS = 10_000;
const MUTATION_TIMEOUT_MS = 8_000;

type AdminRequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  timeoutMs?: number;
};

function configuration() {
  const rawBaseUrl = process.env.API_V1_BASE_URL || process.env.NEXT_PUBLIC_API_URL;
  const apiKey = process.env.API_KEY;
  const bearerToken = process.env.ADMIN_API_BEARER_TOKEN;
  if (!rawBaseUrl || !apiKey || !bearerToken) {
    throw new ApiV1Error(500, 'ADMIN_API_CONFIGURATION_ERROR', 'Admin API server configuration is incomplete');
  }
  let url: URL;
  try {
    url = new URL(rawBaseUrl);
  } catch {
    throw new ApiV1Error(500, 'ADMIN_API_CONFIGURATION_ERROR', 'Admin API base URL is invalid');
  }
  if (url.protocol !== 'https:' && url.hostname !== 'localhost') {
    throw new ApiV1Error(500, 'ADMIN_API_CONFIGURATION_ERROR', 'Admin API base URL must use HTTPS');
  }
  return { baseUrl: url.toString().replace(/\/$/, ''), apiKey, bearerToken };
}

async function parse<T>(response: Response): Promise<T> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ApiV1Error(502, 'UPSTREAM_INVALID_RESPONSE', 'Admin API returned invalid JSON');
  }
  if (!response.ok) {
    const error = payload as Partial<ApiErrorResponse>;
    const gatewayLimited = response.status === 429;
    throw new ApiV1Error(
      response.status,
      error.error?.code || (gatewayLimited ? 'RATE_LIMITED' : 'UPSTREAM_ERROR'),
      error.error?.message || (gatewayLimited
        ? 'Admin API rate limit exceeded. Check the pharmacy sync agent.'
        : 'Admin API request failed'),
      error.error?.details,
    );
  }
  if (!payload || typeof payload !== 'object' || !('data' in payload) || !('request_id' in payload)) {
    throw new ApiV1Error(502, 'UPSTREAM_INVALID_RESPONSE', 'Admin API response shape is invalid');
  }
  return payload as T;
}

async function request<T>(path: string, options: AdminRequestOptions = {}): Promise<T> {
  const { baseUrl, apiKey, bearerToken } = configuration();
  const method = options.method ?? 'GET';
  const isRead = method === 'GET';
  const attempts = isRead ? 2 : 1;
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
          Authorization: `Bearer ${bearerToken}`,
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        cache: 'no-store',
        signal: controller.signal,
      });
      return await parse<T>(response);
    } catch (error) {
      const requestError = controller.signal.aborted
        ? new ApiV1Error(504, 'UPSTREAM_TIMEOUT', 'Admin API did not answer in time')
        : error instanceof ApiV1Error
          ? error
          : new ApiV1Error(502, 'UPSTREAM_UNREACHABLE', 'Admin API is temporarily unreachable');
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

function queryString(values: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => {
    if (value !== undefined && value !== '') params.set(key, String(value));
  });
  const value = params.toString();
  return value ? `?${value}` : '';
}

export function listAdminOrders(values: {
  status?: OrderStatus;
  limit?: number;
  cursor?: string;
  createdFrom?: string;
  createdTo?: string;
  q?: string;
} = {}): Promise<AdminApiListResponse<AdminOrderSummary>> {
  return request(`/v1/admin/orders${queryString({
    status: values.status, limit: values.limit ?? 20, cursor: values.cursor,
    created_from: values.createdFrom, created_to: values.createdTo,
    q: values.q,
  })}`);
}

export function getAdminOrder(orderId: string): Promise<ApiSuccessResponse<AdminOrderDetail>> {
  return request(`/v1/admin/orders/${encodeURIComponent(orderId)}`);
}

export function updateAdminOrderStatus(
  orderId: string,
  status: OrderStatus,
  expectedCurrentStatus: OrderStatus,
  reason?: string,
): Promise<ApiSuccessResponse<{ order_id: string; status: OrderStatus; changed_at: string }>> {
  return request(`/v1/admin/orders/${encodeURIComponent(orderId)}/status`, {
    method: 'PATCH', body: { status, expected_current_status: expectedCurrentStatus, reason: reason || null },
  });
}

export function deleteAdminOrder(orderId: string): Promise<ApiSuccessResponse<{
  order_id: string;
  deleted: boolean;
  deleted_at: string;
}>> {
  return request(`/v1/admin/orders/${encodeURIComponent(orderId)}`, { method: 'DELETE' });
}

export function listAdminCategories(limit = 100): Promise<AdminApiListResponse<AdminCategory>> {
  return request(`/v1/admin/categories${queryString({ limit })}`);
}

export function createAdminCategory(body: {
  slug: string; name: string; icon?: string; color?: string; sort_order?: number;
}): Promise<ApiSuccessResponse<AdminCategory>> {
  return request('/v1/admin/categories', { method: 'POST', body });
}

export function updateAdminCategory(
  categoryId: number,
  body: Partial<Pick<AdminCategory, 'name' | 'icon' | 'color' | 'sort_order' | 'is_active'>>,
): Promise<ApiSuccessResponse<AdminCategory>> {
  return request(`/v1/admin/categories/${categoryId}`, { method: 'PATCH', body });
}

export function deleteAdminCategory(categoryId: number): Promise<ApiSuccessResponse<{
  category_id: number;
  deleted: boolean;
}>> {
  return request(`/v1/admin/categories/${categoryId}`, { method: 'DELETE' });
}

export function listAdminCategoryMedicines(
  categoryId: number,
  values: { page?: number; limit?: number; q?: string; availability?: 'all' | 'in_stock' | 'out_of_stock' } = {},
): Promise<AdminNumberedListResponse<AdminCategoryMedicine>> {
  return request(`/v1/admin/categories/${categoryId}/medicines${queryString({
    page: values.page ?? 1,
    limit: values.limit ?? 25,
    q: values.q,
    availability: values.availability ?? 'all',
  })}`);
}

export function searchAdminCategoryMedicineCandidates(
  categoryId: number,
  q: string,
  page = 1,
  limit = 25,
): Promise<AdminNumberedListResponse<AdminMedicineCandidate>> {
  return request(`/v1/admin/categories/${categoryId}/medicines/candidates${queryString({ q, page, limit })}`);
}

export function batchAddAdminCategoryMedicines(categoryId: number, medicineIds: number[]) {
  return request<ApiSuccessResponse<AdminBatchAddResult & { category_id: number }>>(
    `/v1/admin/categories/${categoryId}/medicines/batch`,
    { method: 'POST', body: { medicine_ids: medicineIds } },
  );
}

export function batchRemoveAdminCategoryMedicines(categoryId: number, medicineIds: number[]) {
  return request<ApiSuccessResponse<AdminBatchRemoveResult & { category_id: number }>>(
    `/v1/admin/categories/${categoryId}/medicines/batch`,
    { method: 'DELETE', body: { medicine_ids: medicineIds } },
  );
}

export function reorderAdminCategories(categoryIds: number[]) {
  return request<ApiSuccessResponse<{ category_ids: number[] }>>('/v1/admin/categories/reorder', {
    method: 'PATCH', body: { category_ids: categoryIds },
  });
}

export function putAdminCategoryMedicine(categoryId: number, medicineId: number) {
  return request<ApiSuccessResponse<{ category_id: number; medicine_id: number }>>(
    `/v1/admin/categories/${categoryId}/medicines/${medicineId}`, { method: 'PUT' },
  );
}

export function deleteAdminCategoryMedicine(categoryId: number, medicineId: number) {
  return request<ApiSuccessResponse<{ category_id: number; medicine_id: number; deleted: boolean }>>(
    `/v1/admin/categories/${categoryId}/medicines/${medicineId}`, { method: 'DELETE' },
  );
}

export function previewAdminCategoryMedicineBulkAdd(
  categoryId: number,
  fragment: string,
  page = 1,
  limit = 20,
): Promise<AdminCategoryMedicineBulkPreviewResponse> {
  return request(
    `/v1/admin/categories/${categoryId}/medicines/bulk-preview${queryString({ fragment, page, limit })}`,
  );
}

export function bulkAddAdminCategoryMedicines(
  categoryId: number,
  fragment: string,
  confirmedCount: number,
): Promise<ApiSuccessResponse<AdminCategoryMedicineBulkAddResult>> {
  return request(`/v1/admin/categories/${categoryId}/medicines/bulk-add`, {
    method: 'POST',
    body: { fragment, confirmed_count: confirmedCount },
    timeoutMs: 15_000,
  });
}

export function listCatalogSyncs(limit = 50): Promise<AdminApiListResponse<CatalogSyncSummary>> {
  return request(`/v1/admin/catalog-syncs${queryString({ limit })}`);
}

export function getAdminCatalogStats(): Promise<ApiSuccessResponse<AdminCatalogStats>> {
  return request('/v1/admin/catalog/stats');
}

export function getAdminDashboardSummary(days: 7 | 30 | 90): Promise<ApiSuccessResponse<AdminDashboardSummary>> {
  return request(`/v1/admin/dashboard${queryString({ days })}`);
}

export function getAdminPricingSettings(): Promise<ApiSuccessResponse<AdminPricingSettings>> {
  return request('/v1/admin/pricing-settings');
}

export function updateAdminPricingSettings(body: {
  markup_enabled: boolean;
  markup_percent: number;
}): Promise<ApiSuccessResponse<AdminPricingSettings>> {
  return request('/v1/admin/pricing-settings', { method: 'PATCH', body });
}

export function listAdminMedicines(values: {
  availability?: 'all' | 'in_stock' | 'out_of_stock';
  page?: number;
  limit?: number;
  q?: string;
  country?: string;
  vendor?: string;
} = {}): Promise<AdminNumberedListResponse<AdminMedicine>> {
  return request(`/v1/admin/medicines${queryString({
    availability: values.availability ?? 'all',
    page: values.page ?? 1,
    limit: values.limit ?? 50,
    q: values.q,
    country: values.country,
    vendor: values.vendor,
  })}`);
}

export function exportAdminOutOfStockMedicines(): Promise<ApiSuccessResponse<AdminMedicineExport>> {
  return request('/v1/admin/medicines/out-of-stock-export', { timeoutMs: 30_000 });
}

export function listAdminDuplicateGroups(page = 1, limit = 50): Promise<AdminNumberedListResponse<AdminDuplicateGroup>> {
  return request(`/v1/admin/medicine-duplicates${queryString({ page, limit })}`);
}

export function getAdminDuplicateGroup(groupKey: string): Promise<AdminDuplicateDetailResponse> {
  return request(`/v1/admin/medicine-duplicates${queryString({ group_key: groupKey })}`);
}

export function listAdminHomepageBanners(): Promise<AdminApiListResponse<AdminHomepageBanner>> {
  return request('/v1/admin/homepage-banners');
}

export function updateAdminHomepageBanner(
  slot: AdminHomepageBanner['slot'],
  body: Partial<Pick<AdminHomepageBanner, 'title' | 'subtitle' | 'image_url' | 'link_url' | 'is_active'>>,
): Promise<ApiSuccessResponse<AdminHomepageBanner>> {
  return request(`/v1/admin/homepage-banners/${slot}`, { method: 'PATCH', body });
}

export function uploadAdminMediaImage(body: {
  content_type: 'image/jpeg' | 'image/png' | 'image/webp';
  data_base64: string;
  scope: 'banners' | 'products';
}): Promise<ApiSuccessResponse<{ url: string; key: string; size_bytes: number }>> {
  return request('/v1/admin/media/images', { method: 'POST', body, timeoutMs: 20_000 });
}

export function listAdminFeaturedProducts(): Promise<AdminApiListResponse<AdminFeaturedProduct>> {
  return request('/v1/admin/featured-products');
}

export function createAdminFeaturedProduct(body: {
  medicine_id: number;
  image_url: string | null;
  sort_order: number;
}): Promise<ApiSuccessResponse<AdminFeaturedProduct>> {
  return request('/v1/admin/featured-products', { method: 'POST', body });
}

export function updateAdminFeaturedProduct(
  medicineId: number,
  body: { image_url: string | null; sort_order: number },
): Promise<ApiSuccessResponse<AdminFeaturedProduct>> {
  return request(`/v1/admin/featured-products/${medicineId}`, { method: 'PATCH', body });
}

export function deleteAdminFeaturedProduct(
  medicineId: number,
): Promise<ApiSuccessResponse<{ medicine_id: number; deleted: boolean }>> {
  return request(`/v1/admin/featured-products/${medicineId}`, { method: 'DELETE' });
}

export function listAdminProductCarousels(): Promise<AdminApiListResponse<AdminProductCarousel>> {
  return request('/v1/admin/product-carousels');
}

export function listAdminProductCarouselItems(
  carouselId: number,
  values: { page?: number; limit?: number; q?: string } = {},
): Promise<AdminNumberedListResponse<AdminCarouselProduct>> {
  return request(`/v1/admin/product-carousels/${carouselId}/products${queryString({
    page: values.page ?? 1, limit: values.limit ?? 20, q: values.q,
  })}`);
}

export function searchAdminProductCarouselCandidates(
  carouselId: number,
  q: string,
  page = 1,
  limit = 25,
): Promise<AdminNumberedListResponse<AdminMedicineCandidate>> {
  return request(`/v1/admin/product-carousels/${carouselId}/candidates${queryString({ q, page, limit })}`);
}

export function batchAddAdminProductCarouselItems(carouselId: number, medicineIds: number[]) {
  return request<ApiSuccessResponse<AdminBatchAddResult & { carousel_id: number }>>(
    `/v1/admin/product-carousels/${carouselId}/products/batch`,
    { method: 'POST', body: { medicine_ids: medicineIds } },
  );
}

export function batchRemoveAdminProductCarouselItems(carouselId: number, medicineIds: number[]) {
  return request<ApiSuccessResponse<AdminBatchRemoveResult & { carousel_id: number }>>(
    `/v1/admin/product-carousels/${carouselId}/products/batch`,
    { method: 'DELETE', body: { medicine_ids: medicineIds } },
  );
}

export function reorderAdminProductCarousels(carouselIds: number[]) {
  return request<ApiSuccessResponse<{ carousel_ids: number[] }>>('/v1/admin/product-carousels/reorder', {
    method: 'PATCH', body: { carousel_ids: carouselIds },
  });
}

export function reorderAdminProductCarouselPage(carouselId: number, medicineIds: number[]) {
  return request<ApiSuccessResponse<{ carousel_id: number; medicine_ids: number[] }>>(
    `/v1/admin/product-carousels/${carouselId}/products/reorder-page`,
    { method: 'PATCH', body: { medicine_ids: medicineIds } },
  );
}

export function createAdminProductCarousel(body: {
  slug: string;
  title: string;
  is_active: boolean;
  sort_order: number;
}): Promise<ApiSuccessResponse<AdminProductCarousel>> {
  return request('/v1/admin/product-carousels', { method: 'POST', body });
}

export function updateAdminProductCarousel(
  carouselId: number,
  body: Partial<Pick<AdminProductCarousel, 'title' | 'is_active' | 'sort_order'>>,
): Promise<ApiSuccessResponse<AdminProductCarousel>> {
  return request(`/v1/admin/product-carousels/${carouselId}`, { method: 'PATCH', body });
}

export function deleteAdminProductCarousel(carouselId: number) {
  return request<ApiSuccessResponse<{ carousel_id: number; deleted: boolean }>>(
    `/v1/admin/product-carousels/${carouselId}`, { method: 'DELETE' },
  );
}

export function addAdminProductCarouselItem(carouselId: number, medicineId: number, sortOrder: number) {
  return request<ApiSuccessResponse<{ carousel_id: number; medicine_id: number; sort_order: number }>>(
    `/v1/admin/product-carousels/${carouselId}/products`,
    { method: 'POST', body: { medicine_id: medicineId, sort_order: sortOrder } },
  );
}

export function updateAdminProductCarouselItem(
  carouselId: number,
  medicineId: number,
  body: { sort_order: number; image_url: string | null },
) {
  return request<ApiSuccessResponse<{ carousel_id: number; medicine_id: number }>>(
    `/v1/admin/product-carousels/${carouselId}/products/${medicineId}`,
    { method: 'PATCH', body },
  );
}

export function deleteAdminProductCarouselItem(carouselId: number, medicineId: number) {
  return request<ApiSuccessResponse<{ carousel_id: number; medicine_id: number; deleted: boolean }>>(
    `/v1/admin/product-carousels/${carouselId}/products/${medicineId}`,
    { method: 'DELETE' },
  );
}

export function reorderAdminProductCarouselItems(carouselId: number, medicineIds: number[]) {
  return request<ApiSuccessResponse<{ carousel_id: number; medicine_ids: number[] }>>(
    `/v1/admin/product-carousels/${carouselId}/products/reorder`,
    { method: 'PATCH', body: { medicine_ids: medicineIds } },
  );
}
