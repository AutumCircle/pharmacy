import Link from 'next/link';
import { requireAdminSession } from '@/lib/admin-auth';
import { listAdminMedicines } from '@/lib/api-v1/admin-server';

export const dynamic = 'force-dynamic';
const PHARMACY_TIME_ZONE = 'Asia/Dushanbe';
type Availability = 'all' | 'in_stock' | 'out_of_stock';

type Filters = {
  availability: Availability;
  q: string;
  country: string;
  vendor: string;
};

function pageHref(page: number, filters: Filters): string {
  const params = new URLSearchParams({ page: String(Math.max(1, page)), availability: filters.availability });
  if (filters.q) params.set('q', filters.q);
  if (filters.country) params.set('country', filters.country);
  if (filters.vendor) params.set('vendor', filters.vendor);
  return `/admin/medicines?${params.toString()}`;
}

export default async function AdminMedicinesPage({ searchParams }: {
  searchParams: Promise<{ page?: string; availability?: string; q?: string; country?: string; vendor?: string }>;
}) {
  await requireAdminSession();
  const params = await searchParams;
  const page = Math.max(1, Number.parseInt(params.page || '1', 10) || 1);
  const availability: Availability = ['in_stock', 'out_of_stock'].includes(params.availability || '')
    ? params.availability as Availability
    : 'all';
  const filters: Filters = {
    availability,
    q: (params.q || '').trim(),
    country: (params.country || '').trim(),
    vendor: (params.vendor || '').trim(),
  };
  const response = await listAdminMedicines({ ...filters, page, limit: 50 });

  return (
    <div>
      <h1 style={{ fontSize: 24, marginBottom: 8 }}>Каталог лекарств</h1>
      <p style={{ color: '#666' }}>Найдено: {response.page.total_items.toLocaleString('ru-RU')}</p>

      <form method="get" className="admin-search-section" style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr auto', gap: 10 }}>
        <input type="hidden" name="availability" value={availability} />
        <input className="admin-search-input" name="q" defaultValue={filters.q} placeholder="Название, medicine_id или SKU" />
        <input className="admin-search-input" name="country" defaultValue={filters.country} placeholder="Страна" />
        <input className="admin-search-input" name="vendor" defaultValue={filters.vendor} placeholder="Производитель" />
        <button type="submit" style={{ padding: '10px 18px', cursor: 'pointer' }}>Найти</button>
      </form>

      <div className="admin-pagination" style={{ justifyContent: 'flex-start', paddingTop: 0 }}>
        <Link href={pageHref(1, { ...filters, availability: 'all' })}>Все</Link>
        <Link href={pageHref(1, { ...filters, availability: 'in_stock' })}>Доступные</Link>
        <Link href={pageHref(1, { ...filters, availability: 'out_of_stock' })}>Архивные</Link>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table className="admin-table">
          <thead><tr><th>ID / SKU</th><th>Название</th><th>Базовая цена</th><th>Цена продажи</th><th>Страна / производитель</th><th>Наличие</th><th>Обновлено</th></tr></thead>
          <tbody>
            {response.data.map((medicine) => (
              <tr key={medicine.medicine_id}>
                <td>{medicine.medicine_id}<div className="admin-country">{medicine.source_sku || 'SKU отсутствует'}</div></td>
                <td><strong>{medicine.medicine_name}</strong></td>
                <td>{Number(medicine.base_unit_price).toFixed(2)} TJS</td>
                <td><strong>{Number(medicine.selling_unit_price).toFixed(2)} TJS</strong></td>
                <td>{medicine.country || '—'}<div className="admin-country">{medicine.vendor || '—'}</div></td>
                <td><span className={`admin-stock-badge ${medicine.in_stock ? 'in-stock' : 'out-of-stock'}`}>{medicine.in_stock ? 'Доступно' : 'Архив'}</span></td>
                <td>{medicine.updated_at ? new Date(medicine.updated_at).toLocaleString('ru-RU', { timeZone: PHARMACY_TIME_ZONE }) : '—'}</td>
              </tr>
            ))}
            {response.data.length === 0 && <tr><td colSpan={7}>Лекарства не найдены.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="admin-pagination">
        <Link className={page <= 1 ? 'disabled' : ''} href={pageHref(page - 1, filters)}>Назад</Link>
        <span className="current">Страница {response.page.number} из {response.page.total_pages}</span>
        <Link className={page >= response.page.total_pages ? 'disabled' : ''} href={pageHref(page + 1, filters)}>Далее</Link>
      </div>
    </div>
  );
}
