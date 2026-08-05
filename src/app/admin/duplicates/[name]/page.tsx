import { fetchAdminData } from '../../../../lib/api';
import { formatVendorCountry } from '../../../../lib/formatters';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function DuplicateDetails({
  params,
}: {
  params: Promise<{ name: string }>;
}) {
  const { name } = await params;
  const decodedName = decodeURIComponent(name);

  let medicinesData: any = null;
  let error = null;

  try {
    // Fetch all variants of this medicine (in_stock is undefined, so it returns all)
    medicinesData = await fetchAdminData('search', { name: decodedName, limit: 100 });
  } catch (err: any) {
    error = err.message;
  }

  // Filter exact matches only
  const allMatches = medicinesData?.matches || [];
  const exactMatches = allMatches.filter((m: any) => m.name.toLowerCase() === decodedName.toLowerCase());

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '30px' }}>
        <h1 style={{ fontSize: '24px', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '24px' }}>🔍</span> Панель дубликатов
        </h1>
        <Link href="/admin/duplicates" style={{ color: 'var(--primary)', textDecoration: 'underline' }}>
          &larr; На главную
        </Link>
      </div>

      <p style={{ color: '#666', marginBottom: '30px' }}>
        Здесь показаны лекарства с абсолютно одинаковым названием (но возможно разным производителем, страной или просто дубли из исходного файла).
      </p>

      {error && (
        <div style={{ background: '#ffebee', padding: '15px', borderRadius: '8px', color: '#c62828', marginBottom: '20px' }}>
          Ошибка загрузки данных API: {error}
        </div>
      )}

      <div style={{ marginBottom: '20px' }}>
        <h2 style={{ fontSize: '18px', fontWeight: 'bold' }}>
          Все версии лекарства: <span style={{ color: 'var(--primary)' }}>{decodedName}</span>
        </h2>
        <p style={{ color: '#666', fontSize: '14px', marginTop: '5px' }}>
          Найдено {exactMatches.length} записей (включая удаленные / не в наличии):
        </p>
      </div>

      {exactMatches.length > 0 ? (
        <div style={{ overflowX: 'auto', background: 'white', borderRadius: '8px', border: '1px solid #E8E8E8' }}>
          <table className="admin-table" style={{ marginBottom: 0 }}>
            <thead>
              <tr>
                <th>НАЗВАНИЕ</th>
                <th>ПРОИЗВОДИТЕЛЬ</th>
                <th>СТРАНА</th>
                <th>ЦЕНА (TJS)</th>
                <th>НАЛИЧИЕ</th>
                <th>ПОСЛЕДНЕЕ ОБНОВЛЕНИЕ</th>
              </tr>
            </thead>
            <tbody>
              {exactMatches.map((med: any, i: number) => {
                const vendor = formatVendorCountry(med.vendor);
                const country = formatVendorCountry(med.country);
                
                return (
                  <tr key={i}>
                    <td style={{ fontWeight: 500 }}>{med.name}</td>
                    <td>{vendor}</td>
                    <td>{country}</td>
                    <td style={{ color: 'var(--primary)', fontWeight: 'bold' }}>{med.price?.toFixed(2) || '0.00'}</td>
                    <td>
                      <span className={`admin-stock-badge ${med.in_stock ? 'in-stock' : 'out-of-stock'}`}>
                        {med.in_stock ? 'В наличии' : 'Нет в наличии'}
                      </span>
                    </td>
                    <td style={{ color: '#888', fontSize: '0.85rem' }}>
                      {med.updated_at ? new Date(med.updated_at).toLocaleString('ru-RU') : '-'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{ textAlign: "center", padding: "40px", color: "#888", background: "white", borderRadius: "8px", border: "1px solid #E8E8E8" }}>
          Ничего не найдено
        </div>
      )}
    </div>
  );
}
