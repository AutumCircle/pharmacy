import { fetchAdminData } from '../../../lib/api';
import OrderList from './OrderList';

export const dynamic = 'force-dynamic';

export default async function AdminOrdersPage() {
  let orders = [];
  let error = null;

  try {
    const res = await fetchAdminData('list_orders');
    orders = res.orders || [];
    
    // Sort orders by created_at descending if available, else fallback
    orders.sort((a: any, b: any) => {
      const dateA = a.created_at ? new Date(a.created_at).getTime() : 0;
      const dateB = b.created_at ? new Date(b.created_at).getTime() : 0;
      return dateB - dateA;
    });
  } catch (err: any) {
    console.error("Failed to fetch orders:", err);
    error = err.message;
  }

  return (
    <div>
      <h1 style={{ fontSize: '24px', fontWeight: 'bold', marginBottom: '30px' }}>Управление заказами</h1>
      
      {error && (
        <div style={{ background: '#ffebee', padding: '15px', borderRadius: '8px', color: '#c62828', marginBottom: '20px' }}>
          Ошибка загрузки заказов: {error}
        </div>
      )}

      <OrderList initialOrders={orders} />
    </div>
  );
}
