import { fetchAdminData } from '../../../lib/api';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function AdminDuplicates() {
  let duplicatesData: any = null;
  let error = null;

  try {
    const res = await fetchAdminData('duplicates');
    duplicatesData = res;
  } catch (err: any) {
    error = err.message;
  }

  const items = Array.isArray(duplicatesData?.duplicates) ? duplicatesData.duplicates : (Array.isArray(duplicatesData) ? duplicatesData : []);

  return (
    <div>
      <h1 style={{ fontSize: '24px', fontWeight: 'bold', marginBottom: '30px' }}>Управление дубликатами</h1>
      
      {error && (
        <div style={{ background: '#ffebee', padding: '15px', borderRadius: '8px', color: '#c62828', marginBottom: '20px' }}>
          Ошибка загрузки данных API: {error}
        </div>
      )}

      <div style={{ background: 'white', borderRadius: '12px', border: '1px solid #E8E8E8', overflow: 'hidden' }}>
        {items.length === 0 ? (
          <div style={{ padding: '40px', textAlign: 'center', color: '#888' }}>
            Дубликатов не найдено
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
            <thead>
              <tr style={{ background: '#f5f5f5', textAlign: 'left', color: '#666' }}>
                <th style={{ padding: '15px 20px' }}>Название товара</th>
                <th style={{ padding: '15px 20px' }}>Количество дублей</th>
                <th style={{ padding: '15px 20px' }}>Действия</th>
              </tr>
            </thead>
            <tbody>
              {items.map((dup: any, idx: number) => (
                <tr key={idx} style={{ borderBottom: '1px solid #eee' }}>
                  <td style={{ padding: '15px 20px', fontWeight: 500, color: '#333' }}>{dup.name}</td>
                  <td style={{ padding: '12px', textAlign: 'center' }}>
                    <span style={{ background: '#FFEBEE', color: '#C62828', padding: '4px 8px', borderRadius: '4px', fontWeight: 'bold' }}>
                      {dup.count}
                    </span>
                  </td>
                  <td style={{ padding: '12px', textAlign: 'right' }}>
                    <Link 
                      href={`/admin/duplicates/${encodeURIComponent(dup.name)}`}
                      style={{ background: 'var(--primary)', color: 'white', padding: '6px 12px', borderRadius: '4px', textDecoration: 'none', fontSize: '12px', fontWeight: 'bold' }}
                    >
                      Посмотреть все
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
