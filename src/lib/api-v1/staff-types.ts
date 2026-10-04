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
  items: Array<{ medicine_id: number; quantity: number }>;
  pharmacy_id?: 1 | 2;
};

export type StaffOrderMedicine = {
  medicine_id: number;
  medicine_name: string;
  base_unit_price: number | string;
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
};

export type CourierOrderList = {
  data: CourierOrder[];
  page: { next_cursor: string | null; has_more: boolean };
  request_id: string;
};

export type CourierEarnings = {
  total: number | string;
  today: number | string;
  yesterday: number | string;
  daily: Array<{ date: string; orders_count: number; amount: number | string }>;
  currency: 'TJS';
  page: { next_cursor: string | null; has_more: boolean };
};
