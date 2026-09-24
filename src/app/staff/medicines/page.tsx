import Link from 'next/link';
import { requireStaffSession } from '@/lib/staff-auth';
import { getAdminCatalogStats, listAdminMedicines } from '@/lib/api-v1/admin-server';

export const dynamic = 'force-dynamic';
const PHARMACY_TIME_ZONE = 'Asia/Dushanbe';
type Availability = 'all' | 'in_stock' | 'out_of_stock';

function timeAgo(value: string | null): string {
  if (!value) return 'нет данных';
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return 'менее минуты назад';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} мин. назад`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} ч. назад`;
  return `${Math.floor(seconds / 86400)} дн. назад`;
}

function pageHref(page: number, availability: Availability, q: string): string {
  const params = new URLSearchParams({ page: String(Math.max(1, page)), availability });
  if (q) params.set('q', q);
  return `/staff/medicines?${params.toString()}`;
}

export default async function StaffMedicinesPage({ searchParams }: {
  searchParams: Promise<{ page?: string; availability?: string; q?: string }>;
}) {
  await requireStaffSession();
  const params = await searchParams;
  const page = Math.max(1, Number.parseInt(params.page || '1', 10) || 1);
  const availability: Availability = ['in_stock', 'out_of_stock'].includes(params.availability || '')
    ? params.availability as Availability
    : 'all';
  const query = (params.q || '').trim();
  const [medicinesResult, statsResult] = await Promise.all([
    listAdminMedicines({ q: query, availability, page, limit: 50 }),
    getAdminCatalogStats(),
  ]);
  const stats = statsResult.data;
  const updatedAt = stats.last_updated_at;

  return (
    <div>
      <section className="staff-title-row">
        <div><h1>Каталог лекарств</h1><p>Базовые цены аптеки без наценки</p></div>
        <div className="staff-sync-status">
          <span>Каталог обновлён</span>
          <strong>{timeAgo(updatedAt)}</strong>
          <small>{updatedAt ? new Date(updatedAt).toLocaleString('ru-RU', { timeZone: PHARMACY_TIME_ZONE }) : 'Время обновления неизвестно'}</small>
        </div>
      </section>

      <form method="get" className="staff-search">
        <input type="hidden" name="availability" value={availability} />
        <input name="q" defaultValue={query} placeholder="Введите название лекарства" autoFocus />
        <button type="submit">Найти</button>
      </form>

      <nav className="staff-filters" aria-label="Фильтр наличия">
        <Link className={availability === 'all' ? 'active' : ''} href={pageHref(1, 'all', query)}>Все · {stats.total.toLocaleString('ru-RU')}</Link>
        <Link className={availability === 'in_stock' ? 'active' : ''} href={pageHref(1, 'in_stock', query)}>В наличии · {stats.in_stock.toLocaleString('ru-RU')}</Link>
        <Link className={availability === 'out_of_stock' ? 'active' : ''} href={pageHref(1, 'out_of_stock', query)}>Нет в наличии · {stats.out_of_stock.toLocaleString('ru-RU')}</Link>
      </nav>

      <div className="staff-result-count">Найдено: {medicinesResult.page.total_items.toLocaleString('ru-RU')}</div>
      <div className="staff-table-wrap">
        <table className="staff-table">
          <thead><tr><th>Лекарство</th><th>Базовая цена</th><th>Наличие</th></tr></thead>
          <tbody>
            {medicinesResult.data.map((medicine) => (
              <tr key={medicine.medicine_id}>
                <td><strong>{medicine.medicine_name}</strong>{(medicine.country || medicine.vendor) && <small>{[medicine.country, medicine.vendor].filter(Boolean).join(' · ')}</small>}</td>
                <td className="staff-price">{Number(medicine.base_unit_price).toFixed(2)} TJS</td>
                <td><span className={medicine.in_stock ? 'staff-stock in' : 'staff-stock out'}>{medicine.in_stock ? 'В наличии' : 'Нет в наличии'}</span></td>
              </tr>
            ))}
            {medicinesResult.data.length === 0 && <tr><td colSpan={3} className="staff-empty">Лекарства не найдены</td></tr>}
          </tbody>
        </table>
      </div>

      <nav className="staff-pagination">
        <Link className={page <= 1 ? 'disabled' : ''} href={pageHref(page - 1, availability, query)}>Назад</Link>
        <span>Страница {medicinesResult.page.number} из {medicinesResult.page.total_pages}</span>
        <Link className={page >= medicinesResult.page.total_pages ? 'disabled' : ''} href={pageHref(page + 1, availability, query)}>Далее</Link>
      </nav>
    </div>
  );
}
