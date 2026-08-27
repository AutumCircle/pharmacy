/** Public Pharmacy Vatan API v1 wire types.
 *
 * These types describe JSON exchanged with Next.js same-origin proxy routes.
 * Base prices, database credentials, API keys and admin-only fields are
 * intentionally absent from public types.
 */

export type Currency = 'TJS';
export type OrderStatus = 'pending' | 'confirmed' | 'delivering' | 'delivered' | 'cancelled';
export type PaymentMethod = 'cash_on_delivery';
export type PaymentStatus = 'unpaid';

export interface ApiErrorDetail {
  fields?: Record<string, string>;
  medicine_ids?: number[];
}

export interface ApiError {
  code: string;
  message: string;
  details?: ApiErrorDetail;
}

export interface ApiErrorResponse {
  error: ApiError;
  request_id: string;
}

export interface ApiSuccessResponse<T> {
  data: T;
  request_id: string;
}

export interface CursorPage {
  next_cursor: string | null;
  previous_cursor?: string | null;
  has_more: boolean;
}

export interface NumberedPage {
  number: number;
  size: number;
  total_items: number;
  total_pages: number;
}

export interface ApiListResponse<T> {
  data: T[];
  page: CursorPage;
  request_id: string;
}

export interface PublicMedicine {
  medicine_id: number;
  medicine_name: string;
  selling_unit_price: number;
  currency: Currency;
  country: string | null;
  vendor: string | null;
  in_stock: boolean;
  catalog_updated_at: string | null;
  image_url: string | null;
}

export interface FeaturedProduct extends PublicMedicine {
  sort_order: number;
}

export interface ProductCarousel {
  slug: string;
  title: string;
  sort_order: number;
  products: FeaturedProduct[];
}

export interface ResolvedMedicines {
  medicines: PublicMedicine[];
  missing_medicine_ids: number[];
}

export type HomepageBannerSlot = 'left' | 'center' | 'right_top' | 'right_bottom';
export type BannerFitMode = 'cover' | 'contain';
export type BannerOverlayType = 'solid' | 'gradient';
export type BannerOverlayDirection = 'to_right' | 'to_left' | 'to_top' | 'to_bottom';
export type BannerTextAlign = 'left' | 'center' | 'right';
export type BannerContentVertical = 'top' | 'center' | 'bottom';

export interface HomepageBanner {
  slot: HomepageBannerSlot;
  title: string | null;
  subtitle: string | null;
  image_url: string | null;
  link_url: string | null;
  cta_text: string | null;
  alt_text: string | null;
  fit_mode: BannerFitMode;
  object_position_x: number;
  object_position_y: number;
  image_width: number | null;
  image_height: number | null;
  overlay_enabled: boolean;
  overlay_color: string;
  overlay_opacity: number;
  overlay_type: BannerOverlayType;
  overlay_direction: BannerOverlayDirection;
  text_color: string;
  text_align: BannerTextAlign;
  content_vertical: BannerContentVertical;
  title_size: number;
  subtitle_size: number;
  content_max_width: number;
}

export interface PublicCategory {
  id: number;
  slug: string;
  name: string;
  icon: string | null;
  color: string | null;
}

export interface CategoryMedicines extends PublicCategory {
  medicines: PublicMedicine[];
}

export interface CategoryMedicinesResponse {
  data: CategoryMedicines;
  page: NumberedPage;
  request_id: string;
}

export interface CreateOrderItemRequest {
  medicine_id: number;
  quantity: number;
}

export interface CreateOrderRequest {
  customer_name: string;
  phone: string;
  address: string;
  comment?: string | null;
  items: CreateOrderItemRequest[];
}

export interface PublicOrderItem {
  medicine_id: number;
  medicine_name: string;
  quantity: number;
  selling_unit_price: number;
  line_total: number;
}

export interface PublicOrder {
  order_id: string;
  order_reference: string;
  status: OrderStatus;
  payment_method: PaymentMethod;
  payment_status: PaymentStatus;
  currency: Currency;
  items: PublicOrderItem[];
  items_subtotal: number;
  order_total: number;
  created_at: string;
}

export interface TrackOrdersRequest {
  phone: string;
}

export type CreateOrderResponse = ApiSuccessResponse<PublicOrder>;
export type TrackOrdersResponse = ApiSuccessResponse<PublicOrder[]>;
export type MedicineResponse = ApiSuccessResponse<PublicMedicine>;
export type ResolveMedicinesResponse = ApiSuccessResponse<ResolvedMedicines>;
export type HomepageBannersResponse = ApiSuccessResponse<{ banners: HomepageBanner[] }>;
export type FeaturedProductsResponse = ApiSuccessResponse<{ products: FeaturedProduct[] }>;
export type ProductCarouselsResponse = ApiSuccessResponse<{ carousels: ProductCarousel[] }>;
export type MedicineSearchResponse = ApiListResponse<PublicMedicine>;
export type CategoriesResponse = ApiListResponse<PublicCategory>;
