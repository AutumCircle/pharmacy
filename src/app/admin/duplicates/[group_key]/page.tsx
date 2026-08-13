import Link from 'next/link';
import { requireAdminSession } from '@/lib/admin-auth';
import { getAdminDuplicateGroup } from '@/lib/api-v1/admin-server';

export const metadata = { title: 'Группа дубликатов — Vatan Admin' };

export const dynamic = 'force-dynamic';

export default async function AdminDuplicateGroupPage({ params }: { params: Promise<{ group_key: string }> }) {
  await requireAdminSession();
  const { group_key: groupKey } = await params;
  const response = await getAdminDuplicateGroup(groupKey);
  return <div>
    <nav aria-label="Хлебные крошки" style={{ marginBottom: 14, color: '#666' }}>
      <Link href="/admin">Панель управления</Link> → <Link href="/admin/duplicates">Дубликаты</Link> → Группа
    </nav>
    <Link href="/admin/duplicates">← Все дубликаты</Link>
    <h1 style={{ fontSize: 24, marginBottom: 8 }}>{response.data[0]?.medicine_name || 'Группа дублей'}</h1>
    <p style={{ color: '#666' }}>Записей в группе: {response.data.length}</p>
    <div style={{ overflowX: 'auto' }}><table className="admin-table">
      <thead><tr><th>ID</th><th>Точное название</th><th>Цена</th><th>Страна</th><th>Производитель</th><th>Наличие</th><th>Обновлено</th></tr></thead>
      <tbody>{response.data.map((medicine) => <tr key={medicine.medicine_id}>
        <td>{medicine.medicine_id}</td><td><strong>{medicine.medicine_name}</strong></td><td>{Number(medicine.base_unit_price).toFixed(2)} TJS</td>
        <td>{medicine.country || '—'}</td><td>{medicine.vendor || '—'}</td>
        <td><span className={`admin-stock-badge ${medicine.in_stock ? 'in-stock' : 'out-of-stock'}`}>{medicine.in_stock ? 'В наличии' : 'Нет в наличии'}</span></td>
        <td>{medicine.updated_at ? new Date(medicine.updated_at).toLocaleString('ru-RU') : '—'}</td>
      </tr>)}</tbody>
    </table></div>
  </div>;
}
