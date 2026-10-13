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
  medicines: Array<{ order_item_id: number; medicine_id: number | null; medicine_name: string;
    quantity: number | string; base_unit_price: number | string | null;
    selling_unit_price: number | string | null; line_total: number | string | null }>;
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
  source?: string;
  customer_name?: string;
  phone?: string;
  address?: string;
  landmark?: string | null;
  notes?: string | null;
  medicines?: Array<{ medicine_name: string; quantity?: number; line_total?: number | string; base_line_total?: number | string }>;
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
