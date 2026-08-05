import Link from 'next/link';
import { redirect } from 'next/navigation';
import { fetchAdminData } from '../../../lib/api';
import { formatVendorCountry } from '../../../lib/formatters';

export const dynamic = 'force-dynamic';

export default async function AdminInventory({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const q = typeof params.q === 'string' ? params.q : '';
  const pageStr = typeof params.page === 'string' ? params.page : '1';
  let page = parseInt(pageStr, 10);
  if (isNaN(page) || page < 1) page = 1;
  const limit = 20;
  const offset = (page - 1) * limit;

  // Handle page jump submission
  if (typeof params.jump_to_page === 'string') {
    const jumpPage = parseInt(params.jump_to_page, 10);
    if (!isNaN(jumpPage) && jumpPage >= 1) {
      redirect(`/admin/inventory?page=${jumpPage}${q ? `&q=${q}` : ''}`);
    }
  }

  // Fetch stats and data concurrently
  let statsData: any = null;
  let medicinesData: any = null;
  let error = null;

  try {
    const statsPromise = fetchAdminData('stats');
    let dataPromise;

    if (q) {
      dataPromise = fetchAdminData('search', { name: q, limit, in_stock: true });
    } else {
      dataPromise = fetchAdminData('list', { limit, offset, sort: 'name', in_stock: true });
    }

    [statsData, medicinesData] = await Promise.all([statsPromise, dataPromise]);
  } catch (err: any) {
    error = err.message;
  }

  const medicines = medicinesData?.medicines || medicinesData?.matches || [];
  const stats = statsData || { in_stock: 0, out_of_stock: 0, last_updated: new Date().toISOString() };
  
  const totalItems = medicinesData?.medicines ? stats.in_stock : medicines.length;
  const totalPages = medicinesData?.medicines ? Math.ceil(totalItems / limit) : 1;

  // Format relative time
  const lastUpdated = new Date(stats.last_updated);
  const now = new Date();
  const diffMs = now.getTime() - lastUpdated.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  
  let relativeTimeStr = "";
  if (diffMins < 1) relativeTimeStr = "только что";
  else if (diffMins < 60) relativeTimeStr = `${diffMins} минут назад`;
  else if (diffHours < 24) relativeTimeStr = `${diffHours} часов назад`;
  else relativeTimeStr = lastUpdated.toLocaleString("ru-RU");

  const calculateClientPrice = (basePrice: number) => {
    return Math.ceil(basePrice * 1.05); // +5% markup, rounded up
  };

  return (
    <div>
      <h1 style={{ fontSize: '24px', fontWeight: 'bold', marginBottom: '20px' }}>Инвентарь и Ценообразование</h1>

      {error && (
        <div style={{ background: '#ffebee', padding: '15px', borderRadius: '8px', color: '#c62828', marginBottom: '20px' }}>
          Ошибка загрузки данных API: {error}
        </div>
      )}

      {/* Stats Bar */}
      <div className="admin-stats-bar">
        <div className="admin-stat-card">
          <div className="label">Всего (В наличии)</div>
          <div className="value" style={{ color: "#16a34a" }}>{stats.in_stock}</div>
        </div>
        <div className="admin-stat-card">
          <div className="label">Нет в наличии (Архив)</div>
          <div className="value" style={{ color: "#666" }}>
            <Link href="/admin/archive" style={{ textDecoration: "none", color: "inherit" }}>
              {stats.out_of_stock} &rarr;
            </Link>
          </div>
        </div>
        <div className="admin-stat-card">
          <div className="label">База обновлена</div>
          <div className="value" style={{ fontSize: "1.2rem", color: "var(--primary)" }}>
            <Link href="/admin/history" style={{ textDecoration: "none", color: "inherit" }}>
              {relativeTimeStr} &rarr;
            </Link>
          </div>
          <div style={{ fontSize: "0.75rem", color: "#888" }}>
            {lastUpdated.toLocaleString("ru-RU")}
          </div>
        </div>
      </div>

      <div style={{ background: '#E3F2FD', padding: '15px', borderRadius: '8px', marginBottom: '20px', border: '1px solid #BBDEFB' }}>
        <p style={{ margin: 0, color: '#1976D2', fontSize: '13px', lineHeight: '1.5' }}>
          <strong>Алгоритм наценки:</strong> +5% от базовой цены, округление вверх до целого сомони (CEIL).
        </p>
      </div>

      {/* Search Section */}
      <div className="admin-search-section">
        <form action="/admin/inventory" method="GET" style={{ display: "flex", width: "100%", gap: "12px", maxWidth: "600px" }}>
          <input
            type="text"
            name="q"
            defaultValue={q}
            placeholder="Поиск лекарства..."
            className="admin-search-input"
          />
          <button type="submit" style={{ padding: "10px 20px", background: "white", border: "1px solid #E8E8E8", borderRadius: "6px", cursor: "pointer" }}>
            Найти
          </button>
          {q && (
            <Link href="/admin/inventory" style={{ padding: "10px 20px", background: "white", border: "1px solid #E8E8E8", borderRadius: "6px", textDecoration: "none", color: "#333" }}>
              Сбросить
            </Link>
          )}
        </form>
      </div>

      <div style={{ padding: '8px 0', fontSize: '0.85rem', color: '#666', marginBottom: '10px' }}>
        {q ? (
          <span>Найдено результатов: {medicines.length}</span>
        ) : (
          <span>Показаны записи {offset + 1} - {Math.min(offset + limit, totalItems)} из {totalItems}</span>
        )}
      </div>

      {/* Table */}
      {medicines.length > 0 ? (
        <div style={{ overflowX: "auto" }}>
          <table className="admin-table">
            <thead>
              <tr>
                <th>Название</th>
                <th>Производитель / Страна</th>
                <th style={{ color: '#666' }}>Базовая цена</th>
                <th style={{ color: 'var(--primary)' }}>Цена для клиента (+5%)</th>
                <th>Наличие</th>
              </tr>
            </thead>
            <tbody>
              {medicines.map((med: any, i: number) => {
                const clientPrice = calculateClientPrice(med.price);
                
                return (
                  <tr key={`${med.name}-${i}`}>
                    <td style={{ fontWeight: 500 }}>{med.name}</td>
                    <td>
                      {formatVendorCountry(med.vendor)}
                      <br />
                      <span className="admin-country">
                        {formatVendorCountry(med.country)}
                      </span>
                    </td>
                    <td style={{ color: '#666' }}>{med.price.toFixed(2)} с.</td>
                    <td style={{ color: 'var(--primary)', fontWeight: 'bold' }}>{clientPrice.toFixed(2)} с.</td>
                    <td>
                      <span
                        className="admin-stock-badge in-stock"
                      >
                        В наличии
                      </span>
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

      {/* Pagination */}
      {!q && totalPages > 1 && (
        <div className="admin-pagination">
          <Link href={`/admin/inventory?page=${Math.max(1, page - 1)}`} className={page <= 1 ? "disabled" : ""}>
            &larr; Назад
          </Link>
          
          <span className="current">
            Страница {page} из {totalPages}
          </span>
          
          <Link href={`/admin/inventory?page=${Math.min(totalPages, page + 1)}`} className={page >= totalPages ? "disabled" : ""}>
            Вперед &rarr;
          </Link>

          <form action="/admin/inventory" method="GET" style={{ display: "flex", alignItems: "center", marginLeft: "20px", gap: "8px" }}>
            <span style={{ fontSize: "0.9rem" }}>Перейти на:</span>
            <input 
              type="number" 
              name="jump_to_page" 
              min="1" 
              max={totalPages} 
              defaultValue={page}
              style={{ width: "60px", padding: "6px", borderRadius: "4px", border: "1px solid #ccc", outline: 'none' }}
            />
            {q && <input type="hidden" name="q" value={q} />}
            <button type="submit" style={{ padding: "6px 12px", background: "white", border: "1px solid #ccc", borderRadius: "4px", cursor: "pointer" }}>Go</button>
          </form>
        </div>
      )}
    </div>
  );
}
