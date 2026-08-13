import Link from 'next/link';
import { requireAdminSession } from '@/lib/admin-auth';
import {
  getAdminCatalogStats,
  getAdminDashboardSummary,
  listAdminCategories,
  listCatalogSyncs,
} from '@/lib/api-v1/admin-server';

export const dynamic = 'force-dynamic';
const PHARMACY_TIME_ZONE = 'Asia/Dushanbe';

function timeAgo(value: string | null): string {
  if (!value) return 'нет данных';
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return `${seconds} сек. назад`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} мин. назад`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} ч. назад`;
  return `${Math.floor(seconds / 86400)} дн. назад`;
}

export default async function AdminDashboard({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  await requireAdminSession();
  const params = await searchParams;
  const days = ([7, 30, 90].includes(Number(params.days)) ? Number(params.days) : 30) as 7 | 30 | 90;
  const [summaryResult, categoriesResult, syncsResult, statsResult] = await Promise.allSettled([
    getAdminDashboardSummary(days),
    listAdminCategories(100),
    listCatalogSyncs(1),
    getAdminCatalogStats(),
  ]);

  const warnings: string[] = [];
  if (summaryResult.status === 'rejected') warnings.push('Не удалось загрузить статистику заказов');
  if (categoriesResult.status === 'rejected') warnings.push('Не удалось загрузить категории');
  if (syncsResult.status === 'rejected') warnings.push('Не удалось загрузить историю синхронизации');
  if (statsResult.status === 'rejected') warnings.push('Не удалось загрузить статистику каталога');

  const summary = summaryResult.status === 'fulfilled' ? summaryResult.value.data : {
    period_days: days, order_counts: { pending: 0, confirmed: 0, delivering: 0, delivered: 0, cancelled: 0 },
    new_orders: 0, active_orders: 0, sales_total: 0, currency: 'TJS' as const,
  };
  const categories = categoriesResult.status === 'fulfilled' ? categoriesResult.value.data : [];
  const syncs = syncsResult.status === 'fulfilled' ? syncsResult.value.data : [];
  const stats = statsResult.status === 'fulfilled'
    ? statsResult.value.data
    : { total: 0, in_stock: 0, out_of_stock: 0, duplicate_groups: 0, last_updated_at: null, warnings: [] };
  if (stats.warnings.includes('CATALOG_ARCHIVE_ABNORMALLY_LARGE')) {
    warnings.push('Архив каталога аномально большой. Синхронизация остановлена до безопасной очистки дублей.');
  }
  const activeCategories = categories.filter((category) => category.is_active).length;
  const lastSync = syncs[0];
  const cards = [
    { label: 'Всего лекарств', value: stats.total, href: '/admin/medicines', color: '#1565c0' },
    { label: 'В наличии', value: stats.in_stock, href: '/admin/medicines?availability=in_stock', color: '#2e7d32' },
    { label: 'Нет в наличии', value: stats.out_of_stock, href: '/admin/medicines?availability=out_of_stock', color: '#c62828' },
    { label: 'Одинаковые названия', value: stats.duplicate_groups, href: '/admin/duplicates', color: '#6a1b9a' },
    { label: 'Новые заказы', value: summary.new_orders, href: '/admin/orders?status=pending', color: '#ef6c00' },
    { label: 'Активные заказы', value: summary.active_orders, href: '/admin/orders', color: '#ad4d00' },
    { label: 'Активные категории', value: activeCategories, href: '/admin/categories', color: '#00838f' },
  ];

  return (
    <div>
      <h1 style={{ fontSize: 24, marginBottom: 8 }}>Панель управления</h1>
      <p style={{ color: '#666', marginTop: 0, marginBottom: 24 }}>
        Каталог обновлён: <strong>{timeAgo(stats.last_updated_at)}</strong>
        {stats.last_updated_at && ` · ${new Date(stats.last_updated_at).toLocaleString('ru-RU', { timeZone: PHARMACY_TIME_ZONE })}`}
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 20 }}>
        {cards.map((card) => (
          <Link key={card.label} href={card.href} style={{ textDecoration: 'none', color: 'inherit' }}>
            <div className="admin-stat-hover" style={{ background: 'white', padding: 24, borderRadius: 12, borderLeft: `4px solid ${card.color}`, transition: '0.2s' }}>
              <div style={{ color: '#666', marginBottom: 10 }}>{card.label}</div>
              <div style={{ fontSize: 28, fontWeight: 700, color: card.color }}>{Number(card.value).toLocaleString('ru-RU')}</div>
            </div>
          </Link>
        ))}
      </div>
      <div style={{ background: 'white', padding: 20, borderRadius: 12, marginTop: 24 }}>
        Последняя v1-синхронизация: <strong>{lastSync?.status || 'нет данных'}</strong>
        {lastSync && ` · ${new Date(lastSync.created_at).toLocaleString('ru-RU', { timeZone: PHARMACY_TIME_ZONE })}`}
      </div>
      <div style={{ background: 'white', padding: 20, borderRadius: 12, marginTop: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          <div>
            <div style={{ color: '#666', marginBottom: 6 }}>Продажи доставленных заказов без доставки</div>
            <strong style={{ fontSize: 28 }}>{Number(summary.sales_total).toFixed(2)} {summary.currency}</strong>
          </div>
          <div className="admin-pagination" style={{ padding: 0 }}>
            {[7, 30, 90].map((period) => <Link key={period} href={`/admin?days=${period}`}>{period} дней</Link>)}
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginTop: 20 }}>
          {Object.entries(summary.order_counts).map(([status, count]) => (
            <Link key={status} href={`/admin/orders?status=${status}`} style={{ padding: 12, borderRadius: 8, background: '#f7f7f7', color: 'inherit', textDecoration: 'none' }}>
              <div style={{ color: '#666', fontSize: 13 }}>{status}</div>
              <strong style={{ fontSize: 22 }}>{count}</strong>
            </Link>
          ))}
        </div>
      </div>
      {warnings.length > 0 && (
        <div style={{ background: '#fff8e1', color: '#7a4f00', padding: 20, borderRadius: 12, marginTop: 16 }}>
          <strong>Системные предупреждения</strong>
          <ul style={{ marginBottom: 0 }}>
            {warnings.map((warning) => <li key={warning}>{warning}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}
