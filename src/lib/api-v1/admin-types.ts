import type { CursorPage, OrderStatus, PaymentMethod, PaymentStatus } from './types';
import type { OrderStage } from '../order-stage';
import type { CourierAssemblyMark, OrderTimelineEvent, PharmacyItemAnswer } from './staff-types';
import type { HomepageBanner } from './types';
import type { PharmacyAlarmSettings } from '../pharmacy-alarm';

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
  courier_daily: Array<{ date: string; amount: number | string; orders_count: number }>;
  delivery_origin_daily: Array<{ date: string; website_orders: number; courier_orders: number; pharmacy_orders: number;
    website_sales: number | string; courier_sales: number | string; pharmacy_sales: number | string }>;
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
  /** Owner's «Нет в наличии»: hidden from clients whatever the pharmacy sync says. Absent on older Lambdas. */
  hidden_from_clients?: boolean;
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
  /** Job 013: stage derived in Lambda; absent on older Lambdas (fall back to `status`). */
  stage?: OrderStage;
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

/** Job 013: read-only courier checklist, pharmacy answers and assembly marks of a website order. */
export type AdminOrderFulfillment = {
  stage: OrderStage;
  /** Completed manual courier checklist steps (1, 2, 6). */
  checklist_steps: number[];
  assembly: CourierAssemblyMark[];
  assembly_complete: boolean;
  pharmacy_answers_complete: boolean;
  confirmed_total: string | null;
  unavailable_count: number;
  answered_count?: number;
  item_count?: number;
  items: Array<{ order_item_id: number; medicine_name?: string | null; pharmacy_id: 1 | 2 | null;
    answers: PharmacyItemAnswer[] }>;
};

export type AdminOrderDetail = AdminOrderSummary & {
  edit_revision: number;
  items: AdminOrderItem[];
  status_history: AdminStatusHistory[];
  /** Job 013: null for staff-created orders; absent on older Lambdas (block hidden). */
  fulfillment?: AdminOrderFulfillment | null;
  /** Job 016: full order history, oldest first (newest 200); absent on older Lambdas. */
  timeline?: OrderTimelineEvent[];
  timeline_truncated?: boolean;
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

export type DeliveredDayOrder = {
  order_id: string;
  order_reference: string | null;
  customer_name: string | null;
  phone: string;
  address: string;
  order_total: number | string | null;
  currency: 'TJS';
  created_at: string;
  delivered_at: string;
  order_source: 'instagram' | 'whatsapp' | 'phone' | null;
  created_by_staff_account_id: 1 | 2 | 3 | null;
  fulfillment_pharmacy_id: 1 | 2 | null;
  created_by_staff_username: string | null;
};

export type OrdersInsightsPeriod = 1 | 7 | 30 | 90;

export type OrdersInsightsNewOrder = {
  order_id: string; order_reference: string | null; customer_name: string | null; phone: string; address: string;
  order_total: number | string | null; created_by_staff_account_id: 1 | 2 | 3 | null;
  fulfillment_pharmacy_id: 1 | 2 | null; order_source: 'instagram' | 'whatsapp' | 'phone' | null; created_at: string;
};

export type OrdersInsightsDay = {
  date: string; website_orders: number; courier_orders: number; pharmacy_orders: number; owner_delivered: number;
  website_sales: number | string; courier_sales: number | string; pharmacy_sales: number | string;
  profit: number | string; courier_fee: number | string; owner_fee: number | string;
};

export type OrdersInsights = {
  period_days: OrdersInsightsPeriod; from: string; to: string; currency: 'TJS';
  live: { pending: number; confirmed: number; delivering: number; new_orders: OrdersInsightsNewOrder[] };
  totals: { ordered_count: number; ordered_sum: number | string; website_ordered_count: number; cancelled_count: number;
    delivered_count: number; delivered_sum: number | string; average_check: number | string; profit: number | string;
    courier_fee: number | string; owner_fee: number | string; owner_delivered: number };
  daily: OrdersInsightsDay[];
  top_medicines: Array<{ medicine_name: string; quantity: number | string; sales: number | string; orders: number }>;
  hours: Array<{ hour: number; orders: number }>;
  clients: { new_clients: number; returning_clients: number };
  delivered_orders: Array<{ order_id: string; order_reference: string | null; customer_name: string | null;
    delivered_at: string; created_by_staff_account_id: 1 | 2 | 3 | null; delivery_courier_amount: number | string;
    delivery_owner_amount: number | string; sales: number | string; base: number | string; profit: number | string;
    owner_total: number | string }>;
};

export type OrdersDrillMetric = 'ordered' | 'delivered' | 'average_check' | 'profit' | 'cancelled' | 'clients';

export type OrdersDrillOrder = {
  order_id: string; order_reference: string | null; customer_name: string | null; status: OrderStatus;
  created_at: string; delivered_at?: string; created_by_staff_account_id: 1 | 2 | 3 | null;
  order_total: number | string | null; sales: number | string; base: number | string; profit: number | string;
  delivery_courier_amount: number | string | null; delivery_owner_amount: number | string | null;
};

export type OrdersDrillClient = {
  customer_name: string | null; phone: string | null; orders_in_period: number; first_order_at: string; is_new: boolean;
};

type OrdersDrillBase = {
  period_days: OrdersInsightsPeriod; from: string; to: string; currency: 'TJS'; page: CursorPage; request_id: string;
};

export type OrdersDrillResponse = OrdersDrillBase & ({
  metric: Exclude<OrdersDrillMetric, 'clients'>;
  summary: { count: number; sum: number | string; profit: number | string };
  data: OrdersDrillOrder[];
} | {
  metric: 'clients';
  summary: { new_clients: number; returning_clients: number };
  data: OrdersDrillClient[];
});

export type DeliveredDayResponse = {
  date: string;
  time_zone: 'Asia/Dushanbe';
  summary: { total: number; website: number; courier: number; pharmacy: number;
    whatsapp: number; instagram: number; phone: number; owner_delivered?: number;
    total_sales?: number | string; website_sales?: number | string; courier_sales?: number | string;
    pharmacy_sales?: number | string; courier_fee?: number | string; owner_fee?: number | string };
  data: DeliveredDayOrder[];
  page: CursorPage;
  request_id: string;
};

export type NotificationField = 'order_reference' | 'created_at' | 'source' | 'customer_name' | 'phone' |
  'address' | 'landmark' | 'comment' | 'items' | 'quantity' | 'item_client_total' | 'item_base_total' | 'client_total' |
  'base_total' | 'profit' | 'creator' | 'status';
export type NotificationChannel = 'owner_telegram' | 'courier_telegram' | 'pharmacy_telegram' | 'pharmacy_web';
export type AdminNotificationSettings = {
  courier_enabled: boolean;
  policies: Record<NotificationChannel, Record<NotificationField, boolean>>;
  revision: number;
  /** Job 014: the pharmacy alarm. Missing on an older Lambda (the page then shows the defaults). */
  pharmacy_alarm?: PharmacyAlarmSettings;
  updated_at: string | null;
  updated_by: string | null;
};
/** PATCH / preview body: all four keys are required by the Lambda (job 014). */
export type AdminNotificationSettingsUpdate = Pick<AdminNotificationSettings, 'courier_enabled' | 'policies' | 'revision'> & {
  pharmacy_alarm: PharmacyAlarmSettings;
};
export type AdminNotificationPreview = {
  telegram: Record<Exclude<NotificationChannel, 'pharmacy_web'>, string>;
  pharmacy_web: Array<{ label: string; value: string }>;
  courier_enabled: boolean;
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
