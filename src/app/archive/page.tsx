import { getMedicines, getStats } from "@/lib/api";
import Link from "next/link";
import CleanupButton from "./CleanupButton";

export const revalidate = 0;

export default async function ArchivePage() {
  const limit = 50;
  
  const dataPromise = getMedicines({ limit, offset: 0, sort: "updated", in_stock: false }).catch(() => ({ medicines: [] }));
  const statsPromise = getStats().catch(() => ({ out_of_stock: 0 }));

  const [stats, data] = await Promise.all([statsPromise, dataPromise]);

  const totalItems = stats.out_of_stock;
  const medicines = "medicines" in data ? data.medicines : [];

  return (
    <>
      <div className="header-inner" style={{ marginBottom: "20px" }}>
        <h2>📦 Архив (Нет в наличии)</h2>
        <Link href="/" className="pagination button">
          &larr; На главную
        </Link>
      </div>

      <div className="stats-bar" style={{ marginBottom: "20px" }}>
        <p style={{ color: "var(--text-muted)", marginBottom: "10px" }}>
          Здесь показаны лекарства, которых сейчас нет в наличии (отсутствуют в последней выгрузке OSTATKI.DBF).
          Всего в архиве: <strong>{totalItems}</strong> записей.
        </p>
        <CleanupButton totalItems={totalItems} />
      </div>

      {medicines.length > 0 ? (
        <div style={{ overflowX: "auto" }}>
          <table className="medicine-table">
            <thead>
              <tr>
                <th>Название</th>
                <th>Производитель / Страна</th>
                <th>Последняя Цена (TJS)</th>
                <th>Дата архивации (Обновлено)</th>
              </tr>
            </thead>
            <tbody>
              {medicines.map((med: any, i: number) => (
                <tr key={`${med.name}-${i}`}>
                  <td style={{ fontWeight: 500 }}>{med.name}</td>
                  <td>
                    {med.vendor ? med.vendor : "—"}
                    <br />
                    <span className="country">{med.country ? med.country : "—"}</span>
                  </td>
                  <td className="price" style={{ color: "var(--text-muted)" }}>{med.price.toFixed(2)}</td>
                  <td style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>
                    {new Date(med.updated_at).toLocaleString("ru-RU")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ textAlign: "center", marginTop: "15px", color: "var(--text-muted)" }}>
            Показаны последние {medicines.length} записей из архива.
          </p>
        </div>
      ) : (
        <div className="loading">В архиве пока ничего нет.</div>
      )}
    </>
  );
}
