export type StaffAccount = {
  account_id: 1 | 2;
  username: string;
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
  source: StaffOrderSource;
  items: Array<{ medicine_id: number; quantity: number }>;
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
  created_by_staff_account_id: 1 | 2;
  created_by_staff_username: string;
  order_source: StaffOrderSource;
};
