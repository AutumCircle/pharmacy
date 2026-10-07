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
  pharmacy_total: number | string;
  profit_total: number | string;
  online_profit_total?: number | string;
  delivery_owner_total: number | string;
  delivery_courier_total: number | string;
  origin_counts: {
    total_orders: number;
    client_orders: number;
    pharmacy_orders: number;
    courier_orders: number;
    pharmacy_1_orders: number;
    pharmacy_2_orders: number;
    instagram_orders: number;
    whatsapp_orders: number;
    phone_orders: number;
    unspecified_source_orders: number;
  };
  recent_orders: Array<{
    order_id: string;
    order_reference: string;
    customer_name: string;
    created_at: string;
    order_total: number | string;
    status: OrderStatus;
    created_by_staff_account_id: 1 | 2 | 3 | null;
    fulfillment_pharmacy_id: 1 | 2 | null;
    order_source: 'instagram' | 'whatsapp' | 'phone' | null;
  }>;
  delivered_orders: Array<{
    order_id: string;
    order_reference: string;
    customer_name: string;
    created_at: string;
    sales_total: number | string;
    pharmacy_total: number | string;
    profit: number | string;
    delivery_owner_amount?: number | string;
    delivery_courier_amount?: number | string;
    owner_total?: number | string;
  }>;
  currency: 'TJS';
};

export type AdminPricingSettings = {
  markup_enabled: boolean;
  markup_percent: number | string;
  updated_at: string;
  updated_by: string | null;
};

export type AdminContactSettings = {
  delivery_contact_phone: string | null;
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

export type AdminMedicineExport = {
  filename: string;
  content_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  content_base64: string;
  row_count: number;
};

export type AdminAvailableMedicineExport = {
  filename: string;
  content_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' | 'text/csv; charset=utf-8';
  content_base64: string;
  row_count: number;
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
  product_count: number;
};

export type AdminMedicineCandidate = AdminMedicine & {
  already_present: boolean;
};

export type AdminBatchAddResult = {
  selected: number;
  added: number;
  already_present: number;
};

export type AdminBatchRemoveResult = {
  selected: number;
  removed: number;
  already_absent: number;
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

export type AdminCategoryMedicineMatch = AdminCategoryMedicine & {
  already_present: boolean;
};

export type AdminCategoryMedicineBulkPreviewResponse = {
  data: AdminCategoryMedicineMatch[];
  fragment: string;
  total: number;
  page: AdminNumberedPage;
  request_id: string;
};

export type AdminCategoryMedicineBulkAddResult = {
  category_id: number;
  fragment: string;
  matched: number;
  added: number;
  already_present: number;
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
  order_source: 'instagram' | 'whatsapp' | 'phone' | null;
  landmark: string | null;
  created_by_staff_account_id: 1 | 2 | 3 | null;
  fulfillment_pharmacy_id: 1 | 2 | null;
  created_by_staff_username: string | null;
  delivery_courier_amount: number | string;
  delivery_owner_amount: number | string;
  delivery_fee: number | string;
  source_collection: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
};

export type AdminOrderItem = {
  order_item_id: number;
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

export type AdminCollectionProduct = { id: number; name: string | null; in_stock: boolean };

export type AdminCollection = {
  id: number;
  slug: string;
  title: string;
  description: string;
  product_ids: number[];
  products: AdminCollectionProduct[];
  is_active: boolean;
  created_at: string;
};

export type AdminCollectionInput = {
  slug: string;
  title: string;
  description: string;
  product_ids: number[];
  is_active: boolean;
};

export type AdminResolvedProducts = { products: AdminCollectionProduct[]; missing_ids: number[] };

export type CollectionStatsTotals = {
  views: number;
  unique_visitors: number;
  product_opens: number;
  add_to_carts: number;
  orders: number;
  orders_total: number | string;
};

export type CollectionStatsRow = CollectionStatsTotals & {
  slug: string;
  title: string;
  is_active: boolean;
  deleted: boolean;
  by_medium: (CollectionStatsTotals & { medium: string | null })[];
};

export type CollectionProductStats = {
  product_id: number;
  name: string | null;
  in_collection: boolean;
  product_opens: number;
  add_to_carts: number;
  orders: number;
  orders_total: number | string;
};

export type CollectionUtmOrders = {
  utm_content: string;
  utm_source: string;
  utm_medium: string;
  utm_campaign: string;
  orders: number;
  orders_total: number | string;
};

export type CollectionUtmLinkStats = CollectionUtmOrders & {
  product_id: number | null;
  product_name: string | null;
  views: number;
  unique_visitors: number;
};

export type CollectionStats = {
  from: string | null;
  to: string | null;
  time_zone: string;
  collections: CollectionStatsRow[];
  utm_links: CollectionUtmLinkStats[];
  utm_orders: CollectionUtmOrders[];
  slug?: string;
  products?: CollectionProductStats[];
};
