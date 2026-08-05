import { fetchAdminData } from '../../../lib/api';
import { formatVendorCountry } from '../../../lib/formatters';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function AdminArchive({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const pageStr = typeof params.page === 'string' ? params.page : '1';
  let page = parseInt(pageStr, 10);
  if (isNaN(page) || page < 1) page = 1;
  const limit = 20;
  const offset = (page - 1) * limit;

  let archiveData: any = null;
  let statsData: any = null;
  let error = null;

  try {
    const statsPromise = fetchAdminData('stats');
    const listPromise = fetchAdminData('list', { limit, offset, in_stock: false, sort: 'name' });
    
    [statsData, archiveData] = await Promise.all([statsPromise, listPromise]);
  } catch (err: any) {
    error = err.message;
  }

  const archiveCount = statsData?.out_of_stock || 0;
  const items = archiveData?.medicines || [];
  const totalPages = Math.ceil(archiveCount / limit);

  return (
    <div>
      <h1 style={{ fontSize: '24px', fontWeight: 'bold', marginBottom: '30px' }}>Архив медикаментов (Нет в наличии)</h1>
      
      {error && (
        <div style={{ background: '#ffebee', padding: '15px', borderRadius: '8px', color: '#c62828', marginBottom: '20px' }}>
          Ошибка загрузки данных API: {error}
        </div>
      )}

      {statsData && (
        <div style={{ background: '#E3F2FD', padding: '15px', borderRadius: '8px', marginBottom: '20px', fontSize: '14px' }}>
          <strong>Общая статистика базы:</strong> Всего товаров в базе: {statsData.total_medicines}. Из них в архиве: {statsData.out_of_stock}.
        </div>
      )}

      <div style={{ background: 'white', borderRadius: '12px', border: '1px solid #E8E8E8', overflow: 'hidden' }}>
        <div style={{ padding: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #E8E8E8' }}>
          <div>Устаревших товаров: <strong>{archiveCount}</strong></div>
        </div>
        
        {items.length > 0 ? (
          <div style={{ padding: '20px', overflowX: 'auto' }}>
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Название</th>
                  <th>Производитель / Страна</th>
                  <th>Последнее обновление</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item: any, idx: number) => (
                  <tr key={idx}>
                    <td style={{ fontWeight: 500, color: '#555' }}>{item.name || 'Неизвестно'}</td>
                    <td className="admin-country">
                      {formatVendorCountry(item.vendor)}
                      <br />
                      {formatVendorCountry(item.country)}
                    </td>
                    <td style={{ color: '#888', fontSize: '0.85rem' }}>
                      {item.updated_at ? new Date(item.updated_at).toLocaleDateString('ru-RU') : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ padding: '40px', textAlign: 'center', color: '#888' }}>
            Список пуст. Все товары в наличии.
          </div>
        )}

        {totalPages > 1 && (
          <div className="admin-pagination">
            <Link href={`/admin/archive?page=${Math.max(1, page - 1)}`} className={page <= 1 ? "disabled" : ""}>
              &larr; Назад
            </Link>
            <span className="current">
              Страница {page} из {totalPages}
            </span>
            <Link href={`/admin/archive?page=${Math.min(totalPages, page + 1)}`} className={page >= totalPages ? "disabled" : ""}>
              Вперед &rarr;
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
