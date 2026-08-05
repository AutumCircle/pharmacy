import { getDuplicates, searchMedicines } from "@/lib/api";
import Link from "next/link";

export const revalidate = 0;

export default async function DuplicatesPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const inspectName = typeof params.name === "string" ? params.name : "";

  let duplicatesData;
  let inspectData;

  if (inspectName) {
    // If a name is clicked, search for ALL versions (in stock and out of stock)
    inspectData = await searchMedicines(inspectName, 50, undefined);
  } else {
    // Load the list of duplicates
    duplicatesData = await getDuplicates();
  }

  const duplicatesList = duplicatesData?.duplicates || [];
  const inspectMatches = inspectData?.matches || [];

  return (
    <>
      <div className="header-inner" style={{ marginBottom: "20px" }}>
        <h2>🔍 Панель дубликатов</h2>
        <Link href="/" className="pagination button">
          &larr; На главную
        </Link>
      </div>

      <div className="stats-bar" style={{ marginBottom: "20px" }}>
        <p style={{ color: "var(--text-muted)" }}>
          Здесь показаны лекарства с абсолютно одинаковым названием (но возможно
          разным производителем, страной или просто дубли из исходного файла).
        </p>
      </div>

      {inspectName ? (
        <div>
          <h3>
            Все версии лекарства: <span style={{ color: "var(--accent)" }}>{inspectName}</span>
          </h3>
          <p style={{ margin: "10px 0 20px" }}>
            Найдено {inspectMatches.length} записей (включая удаленные / не в наличии):
          </p>
          <div style={{ overflowX: "auto" }}>
            <table className="medicine-table">
              <thead>
                <tr>
                  <th>Название</th>
                  <th>Производитель</th>
                  <th>Страна</th>
                  <th>Цена (TJS)</th>
                  <th>Наличие</th>
                  <th>Последнее обновление</th>
                </tr>
              </thead>
              <tbody>
                {inspectMatches.map((med: any, i: number) => (
                  <tr key={i}>
                    <td style={{ fontWeight: 500 }}>{med.name}</td>
                    <td>{med.vendor ? med.vendor : <span style={{ color: "red" }}>NULL</span>}</td>
                    <td>{med.country ? med.country : <span style={{ color: "red" }}>NULL</span>}</td>
                    <td className="price">{med.price.toFixed(2)}</td>
                    <td>
                      <span
                        className={`stock-badge ${
                          med.in_stock ? "in-stock" : "out-of-stock"
                        }`}
                      >
                        {med.in_stock ? "В наличии" : "Нет (архив)"}
                      </span>
                    </td>
                    <td style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
                      {new Date(med.updated_at).toLocaleString("ru-RU")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: "20px" }}>
            <Link href="/duplicates" className="pagination button">
              &larr; Назад к списку дубликатов
            </Link>
          </div>
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          {duplicatesList.length > 0 ? (
            <table className="medicine-table" style={{ width: "100%", maxWidth: "600px" }}>
              <thead>
                <tr>
                  <th>Название лекарства</th>
                  <th>Количество записей в базе</th>
                  <th>Действие</th>
                </tr>
              </thead>
              <tbody>
                {duplicatesList.map((dup, i) => (
                  <tr key={i}>
                    <td style={{ fontWeight: 500 }}>{dup.name}</td>
                    <td>
                      <span style={{ 
                        background: "#fee2e2", 
                        color: "#991b1b", 
                        padding: "4px 8px", 
                        borderRadius: "999px",
                        fontWeight: "bold",
                        fontSize: "0.8rem"
                      }}>
                        {dup.count}
                      </span>
                    </td>
                    <td>
                      <Link 
                        href={`/duplicates?name=${encodeURIComponent(dup.name)}`}
                        className="pagination button"
                        style={{ padding: "4px 12px", fontSize: "0.8rem" }}
                      >
                        Посмотреть все
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="loading">Загрузка дубликатов или дубликатов нет...</div>
          )}
        </div>
      )}
    </>
  );
}
