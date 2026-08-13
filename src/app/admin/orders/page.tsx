import Link from 'next/link';
import { listAdminOrders } from '@/lib/api-v1/admin-server';
import { requireAdminSession } from '@/lib/admin-auth';
import type { OrderStatus } from '@/lib/api-v1/types';
import OrderList from './OrderList';

export const dynamic = 'force-dynamic';

const allowedStatuses: OrderStatus[] = ['pending', 'confirmed', 'delivering', 'delivered', 'cancelled'];

export default async function AdminOrdersPage({ searchParams }: {
  searchParams: Promise<{ q?: string; status?: string; created_from?: string; created_to?: string; cursor?: string }>;
}) {
  await requireAdminSession();
  const params = await searchParams;
  const status = allowedStatuses.includes(params.status as OrderStatus) ? params.status as OrderStatus : undefined;
  const q = (params.q || '').trim();
  const createdFrom = params.created_from || '';
  const createdTo = params.created_to || '';
  const response = await listAdminOrders({
    q,
    status,
    createdFrom: createdFrom ? `${createdFrom}T00:00:00Z` : undefined,
    createdTo: createdTo ? `${createdTo}T23:59:59Z` : undefined,
    cursor: params.cursor,
    limit: 50,
  });

  const nextParams = new URLSearchParams();
  if (q) nextParams.set('q', q);
  if (status) nextParams.set('status', status);
  if (createdFrom) nextParams.set('created_from', createdFrom);
  if (createdTo) nextParams.set('created_to', createdTo);
  if (response.page.next_cursor) nextParams.set('cursor', response.page.next_cursor);

  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 'bold', marginBottom: 8 }}>Управление заказами</h1>
      <p style={{ color: '#666', marginTop: 0 }}>Поиск и фильтрация выполняются в базе. Суммы показаны без доставки.</p>

      <form method="get" className="admin-search-section" style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr auto', gap: 10 }}>
        <input className="admin-search-input" name="q" defaultValue={q} placeholder="Номер заказа, телефон или имя" />
        <select name="status" defaultValue={status || ''}>
          <option value="">Все статусы</option>
          <option value="pending">Новый</option>
          <option value="confirmed">Подтверждён</option>
          <option value="delivering">Доставляется</option>
          <option value="delivered">Доставлен</option>
          <option value="cancelled">Отменён</option>
        </select>
        <input type="date" name="created_from" defaultValue={createdFrom} aria-label="Дата от" />
        <input type="date" name="created_to" defaultValue={createdTo} aria-label="Дата до" />
        <button type="submit" style={{ padding: '10px 18px', cursor: 'pointer' }}>Найти</button>
      </form>

      <OrderList initialOrders={response.data} />
      {response.page.has_more && response.page.next_cursor && (
        <div className="admin-pagination">
          <Link href={`/admin/orders?${nextParams.toString()}`}>Следующая страница</Link>
        </div>
      )}
    </div>
  );
}
