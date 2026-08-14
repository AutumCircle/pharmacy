import type { CursorPage, OrderStatus, PaymentMethod, PaymentStatus } from './types';
import type { HomepageBanner } from './types';

export type AdminApiListResponse<T> = {
  data: T[];
  page: CursorPage;
  request_id: string;
};

export type AdminNumberedPage = {
  number: number;
  size: number;
  total_items: number;
  total_pages: number;
};

export type AdminNumberedListResponse<T> = {
  data: T[];
  page: AdminNumberedPage;
  request_id: string;
};

export type AdminCatalogStats = {
  total: number;
  in_stock: number;
  out_of_stock: number;
  duplicate_groups: number;
  last_updated_at: string | null;
  warnings: string[];
};

export type AdminDashboardSummary = {
  period_days: 7 | 30 | 90;
  order_counts: Record<OrderStatus, number>;
  new_orders: number;
  active_orders: number;
  sales_total: number | string;
  currency: 'TJS';
};

export type AdminPricingSettings = {
  markup_enabled: boolean;
  markup_percent: number | string;
  updated_at: string;
  updated_by: string | null;
};

export type AdminMedicine = {
  medicine_id: number;
  medicine_name: string;
  base_unit_price: number | string;
  selling_unit_price: number | string;
  source_sku: string | null;
  country: string | null;
  vendor: string | null;
  in_stock: boolean;
  updated_at: string | null;
  image_url: string | null;
};

export type AdminFeaturedProduct = {
  medicine_id: number;
  medicine_name: string;
  base_unit_price: number | string;
  selling_unit_price: number | string;
  country: string | null;
  vendor: string | null;
  in_stock: boolean;
  image_url: string | null;
  sort_order: number;
  updated_at: string;
};

export type AdminCarouselProduct = AdminFeaturedProduct;

export type AdminProductCarousel = {
  id: number;
  slug: string;
  title: string;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
  products: AdminCarouselProduct[];
};

export type AdminDuplicateGroup = {
  group_key: string;
  medicine_name: string;
  medicine_count: number;
  in_stock_count: number;
  out_of_stock_count: number;
  min_base_price: number | string;
  max_base_price: number | string;
  last_updated_at: string | null;
};

export type AdminDuplicateDetailResponse = {
  group_key: string;
  data: AdminMedicine[];
  request_id: string;
};

export type AdminCategory = {
  id: number;
  slug: string;
  name: string;
  icon: string | null;
  color: string | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
};

export type AdminCategoryMedicine = {
  medicine_id: number;
  medicine_name: string;
  country: string | null;
  vendor: string | null;
  in_stock: boolean;
  updated_at: string | null;
};

export type AdminOrderSummary = {
  order_id: string;
  order_reference: string | null;
  customer_name: string;
  phone: string;
  address: string;
  items_subtotal: number | string | null;
  order_total: number | string | null;
  currency: 'TJS';
  status: OrderStatus;
  payment_method: PaymentMethod;
  payment_status: PaymentStatus;
  notes: string | null;
  created_at: string;
};

export type AdminOrderItem = {
  medicine_id: number | null;
  medicine_name: string;
  base_unit_price: number | string | null;
  selling_unit_price: number | string | null;
  quantity: number;
  line_total: number | string | null;
};

export type AdminStatusHistory = {
  from_status: OrderStatus | null;
  to_status: OrderStatus;
  actor_type: string;
  actor_id: string | null;
  reason: string | null;
  created_at: string;
};

export type AdminOrderDetail = AdminOrderSummary & {
  items: AdminOrderItem[];
  status_history: AdminStatusHistory[];
};

export type CatalogSyncSummary = {
  sync_id: string;
  source_id: string;
  status: 'awaiting_upload' | 'validating' | 'importing' | 'succeeded' | 'failed';
  expected_row_count: number;
  received_row_count: number | null;
  inserted_count: number;
  updated_count: number;
  in_stock_count: number;
  out_of_stock_count: number;
  conflict_count: number;
  error_code: string | null;
  source_updated_at: string;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
};

export type AdminHomepageBanner = HomepageBanner & {
  is_active: boolean;
  updated_at: string;
};
