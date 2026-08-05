import { fetchAdminData } from '../../lib/api';
import ExcelExportButtons from './ExcelExportButtons';
import DashboardCharts from './DashboardCharts';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

function getRelativeTime(dateString: string | undefined): string {
  if (!dateString) return 'Неизвестно';
  const now = new Date();
  const date = new Date(dateString);
  const diffInMinutes = Math.floor((now.getTime() - date.getTime()) / 60000);
  
  if (diffInMinutes < 1) return 'Только что';
  if (diffInMinutes < 60) return `${diffInMinutes} минут назад`;
  const diffInHours = Math.floor(diffInMinutes / 60);
  if (diffInHours < 24) return `${diffInHours} часов назад`;
  const diffInDays = Math.floor(diffInHours / 24);
  return `${diffInDays} дней назад`;
}

export default async function AdminDashboard() {
  let statsData: any = null;
  let ordersData: any = null;

  try {
    const statsPromise = fetchAdminData('stats');
    const ordersPromise = fetchAdminData('list_orders');
    
    [statsData, ordersData] = await Promise.all([statsPromise, ordersPromise]);
  } catch (e) {
    console.error("Dashboard data error:", e);
  }

  const totalMedicines = statsData?.total_medicines || 0;
  const inStock = statsData?.in_stock || 0;
  const outOfStock = statsData?.out_of_stock || 0;
  const lastUpdated = statsData?.last_updated;
  const lastUpdatedFormatted = lastUpdated ? new Date(lastUpdated).toLocaleString('ru-RU') : 'Неизвестно';
  const lastUpdatedRelative = getRelativeTime(lastUpdated);
  
  const orders = ordersData?.orders || [];
  
  // Calculate uncategorized
  let categorizedCount = 0;
  try {
    const catData = await fetchAdminData('list_categories');
    if (catData && catData.categories) {
      for (const cat of catData.categories) {
        const itemsData = await fetchAdminData('get_category_medicines', { slug: cat.slug });
        if (itemsData && itemsData.items) {
          categorizedCount += itemsData.items.length;
        }
      }
    }
  } catch (err) {
    console.error('Failed to calculate categorized count', err);
  }
  const uncategorizedCount = Math.max(0, totalMedicines - categorizedCount);
  
  // Calculate Today's Metrics
  const todayStr = new Date().toLocaleDateString('ru-RU');
  let todaysOrdersCount = 0;
  let todaysRevenue = 0;
  
  orders.forEach((o: any) => {
    const oDateStr = new Date(o.created_at || o.date).toLocaleDateString('ru-RU');
    if (oDateStr === todayStr) {
      todaysOrdersCount += 1;
      if (o.status !== 'cancelled') {
        const safeItems = o.items || [];
        let orderTotal = 0;
        if (safeItems.length > 0) {
          orderTotal = safeItems.reduce((acc: number, item: any) => {
            const p = Number(item.sellPrice || item.price || 0);
            return acc + (p * Number(item.quantity || 1));
          }, 0);
        } else {
          orderTotal = Number(o.total_price || 0);
        }
        todaysRevenue += orderTotal;
      }
    }
  });

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '30px' }}>
        <h1 style={{ fontSize: '24px', fontWeight: 'bold' }}>Общая сводка базы</h1>
        <ExcelExportButtons />
      </div>

      <div style={{ background: '#FFF8E1', padding: '15px 20px', borderRadius: '12px', border: '1px solid #FFE082', marginBottom: '30px', display: 'flex', alignItems: 'center', gap: '15px' }}>
        <div style={{ width: '10px', height: '10px', background: '#FF8F00', borderRadius: '50%', flexShrink: 0 }}></div>
        <div>
          <div style={{ fontSize: '13px', color: '#F57F17', fontWeight: 'bold', marginBottom: '4px' }}>ПОСЛЕДНЕЕ ОБНОВЛЕНИЕ БАЗЫ:</div>
          <div style={{ color: '#333', fontSize: '15px' }}>{lastUpdatedFormatted} <span style={{ color: '#888', fontSize: '13px', marginLeft: '10px' }}>({lastUpdatedRelative})</span></div>
        </div>
      </div>

      {/* Summary Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '20px', marginBottom: '40px' }}>
        
        <Link href="/admin/inventory" style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}>
          <div style={{ background: 'white', padding: '24px', borderRadius: '12px', borderLeft: '4px solid var(--primary)', boxShadow: '0 2px 10px rgba(0,0,0,0.02)', transition: 'transform 0.2s', cursor: 'pointer' }} className="admin-stat-hover">
            <div style={{ fontSize: '14px', color: '#666', marginBottom: '10px' }}>Всего лекарств в базе</div>
            <div style={{ fontSize: '28px', fontWeight: 'bold', color: '#111' }}>{totalMedicines.toLocaleString('ru-RU')}</div>
          </div>
        </Link>
        
        <Link href="/admin/inventory" style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}>
          <div style={{ background: 'white', padding: '24px', borderRadius: '12px', borderLeft: '4px solid #4CAF50', boxShadow: '0 2px 10px rgba(0,0,0,0.02)', transition: 'transform 0.2s', cursor: 'pointer' }} className="admin-stat-hover">
            <div style={{ fontSize: '14px', color: '#666', marginBottom: '10px' }}>Доступно (В наличии)</div>
            <div style={{ fontSize: '28px', fontWeight: 'bold', color: '#4CAF50' }}>{inStock.toLocaleString('ru-RU')}</div>
          </div>
        </Link>
        
        <Link href="/admin/categories" style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}>
          <div style={{ background: 'white', padding: '24px', borderRadius: '12px', borderLeft: '4px solid #9C27B0', boxShadow: '0 2px 10px rgba(0,0,0,0.02)', transition: 'transform 0.2s', cursor: 'pointer' }} className="admin-stat-hover">
            <div style={{ fontSize: '14px', color: '#666', marginBottom: '10px' }}>Без категории</div>
            <div style={{ fontSize: '28px', fontWeight: 'bold', color: '#9C27B0' }}>{uncategorizedCount.toLocaleString('ru-RU')}</div>
          </div>
        </Link>
        
        <Link href="/admin/archive" style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}>
          <div style={{ background: 'white', padding: '24px', borderRadius: '12px', borderLeft: '4px solid #F44336', boxShadow: '0 2px 10px rgba(0,0,0,0.02)', transition: 'transform 0.2s', cursor: 'pointer' }} className="admin-stat-hover">
            <div style={{ fontSize: '14px', color: '#666', marginBottom: '10px' }}>Нет в наличии (Архив)</div>
            <div style={{ fontSize: '28px', fontWeight: 'bold', color: '#F44336' }}>{outOfStock.toLocaleString('ru-RU')}</div>
          </div>
        </Link>
        
        <Link href="/admin/orders" style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}>
          <div style={{ background: 'white', padding: '24px', borderRadius: '12px', borderLeft: '4px solid #FF9800', boxShadow: '0 2px 10px rgba(0,0,0,0.02)', transition: 'transform 0.2s', cursor: 'pointer' }} className="admin-stat-hover">
            <div style={{ fontSize: '14px', color: '#666', marginBottom: '10px' }}>Заказы (За сегодня)</div>
            <div style={{ fontSize: '28px', fontWeight: 'bold', color: '#FF9800' }}>{todaysOrdersCount}</div>
          </div>
        </Link>
        
        <div style={{ background: 'white', padding: '24px', borderRadius: '12px', borderLeft: '4px solid #29b6f6', boxShadow: '0 2px 10px rgba(0,0,0,0.02)', transition: 'transform 0.2s' }} className="admin-stat-hover">
          <div style={{ fontSize: '14px', color: '#666', marginBottom: '10px' }}>Выручка (За сегодня)</div>
          <div style={{ fontSize: '28px', fontWeight: 'bold', color: '#29b6f6' }}>{todaysRevenue.toLocaleString('ru-RU', { maximumFractionDigits: 0 })} с.</div>
        </div>

      </div>

      <div style={{ marginTop: '20px' }}>
        <DashboardCharts orders={orders} />
      </div>
    </div>
  );
}
