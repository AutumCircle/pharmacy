import Link from 'next/link';
import { requireAdminSession } from '@/lib/admin-auth';
import { listAdminDuplicateGroups } from '@/lib/api-v1/admin-server';

export const metadata = { title: 'Дубликаты — Vatan Admin' };

export const dynamic = 'force-dynamic';

export default async function AdminDuplicatesPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  await requireAdminSession();
  const params = await searchParams;
  const page = Math.max(1, Number.parseInt(params.page || '1', 10) || 1);
  const response = await listAdminDuplicateGroups(page, 50);

  return (
    <div>
      <nav aria-label="Хлебные крошки" style={{ marginBottom: 14, color: '#666' }}>
        <Link href="/admin">Панель управления</Link> → Дубликаты
      </nav>
      <h1 style={{ fontSize: 24, marginBottom: 8 }}>Дубликаты</h1>
      <p style={{ color: '#666' }}>В каждой группе показаны все записи с одинаковым нормализованным названием, включая архивные. Число в колонке «Записей» — полный размер группы. Найдено групп: {response.page.total_items.toLocaleString('ru-RU')}</p>
      <div style={{ overflowX: 'auto' }}>
        <table className="admin-table">
          <thead><tr><th>Название</th><th>Записей</th><th>Доступно</th><th>Диапазон базовых цен</th><th></th></tr></thead>
          <tbody>
            {response.data.map((group) => (
              <tr key={group.group_key}>
                <td><strong>{group.medicine_name}</strong></td>
                <td><strong className={group.medicine_count >= 3 ? 'admin-duplicate-count notable' : 'admin-duplicate-count'}>{group.medicine_count}</strong></td>
                <td>{group.in_stock_count}</td>
                <td>{Number(group.min_base_price).toFixed(2)}–{Number(group.max_base_price).toFixed(2)} TJS</td>
                <td><Link href={`/admin/duplicates/${group.group_key}`}>Открыть</Link></td>
              </tr>
            ))}
            {response.data.length === 0 && <tr><td colSpan={5}>Лекарства с одинаковым названием не найдены.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="admin-pagination">
        <Link className={page <= 1 ? 'disabled' : ''} href={`/admin/duplicates?page=${Math.max(1, page - 1)}`}>Назад</Link>
        <span className="current">Страница {response.page.number} из {response.page.total_pages}</span>
        <Link className={page >= response.page.total_pages ? 'disabled' : ''} href={`/admin/duplicates?page=${page + 1}`}>Далее</Link>
      </div>
    </div>
  );
}
