import { getHistory } from "@/lib/api";
import Link from "next/link";

export const revalidate = 0;

export default async function HistoryPage() {
  const data = await getHistory().catch(() => ({ history: [] }));
  const history = data?.history || [];

  return (
    <>
      <div className="header-inner" style={{ marginBottom: "20px" }}>
        <h2>🕒 История обновлений базы</h2>
        <Link href="/" className="pagination button">
          &larr; На главную
        </Link>
      </div>

      <div className="stats-bar" style={{ marginBottom: "20px" }}>
        <p style={{ color: "var(--text-muted)" }}>
          Здесь показаны последние события синхронизации данных из файла OSTATKI.DBF в облачную базу AWS.
          (Новая функция — записываются только события после её добавления).
        </p>
      </div>

      <div style={{ overflowX: "auto" }}>
        {history.length > 0 ? (
          <table className="medicine-table">
            <thead>
              <tr>
                <th>Дата и Время синхронизации</th>
                <th>Обраработано записей (Уникальных)</th>
                <th>В наличии после обновления</th>
                <th>Отправлено в архив (Нет в наличии)</th>
              </tr>
            </thead>
            <tbody>
              {history.map((log, i) => (
                <tr key={i}>
                  <td style={{ fontWeight: 500 }}>
                    {new Date(log.sync_time).toLocaleString("ru-RU")}
                  </td>
                  <td>
                    <span style={{ color: "var(--accent)", fontWeight: "bold" }}>
                      {log.upserted_count}
                    </span>
                  </td>
                  <td style={{ color: "var(--success)" }}>
                    {log.in_stock_count}
                  </td>
                  <td style={{ color: "var(--text-muted)" }}>
                    {log.out_of_stock_count}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="loading">
            История пуста. Записей о синхронизации пока нет. (Они появятся при следующем обновлении базы).
          </div>
        )}
      </div>
    </>
  );
}
