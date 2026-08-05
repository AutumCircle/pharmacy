import { getMedicines, searchMedicines } from "@/lib/api";
import Link from "next/link";
import { redirect } from "next/navigation";
import HeroBanners from "@/components/HeroBanners";
import ProductCard from "@/components/ProductCard";

export const revalidate = 0; // Don't cache this page heavily to see updates

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q : "";
  const pageStr = typeof params.page === "string" ? params.page : "1";
  let page = parseInt(pageStr, 10);
  if (isNaN(page) || page < 1) page = 1;
  const limit = 20;
  const offset = (page - 1) * limit;

  // Handle page jump submission
  if (typeof params.jump_to_page === "string") {
    const jumpPage = parseInt(params.jump_to_page, 10);
    if (!isNaN(jumpPage) && jumpPage >= 1) {
      redirect(`/?page=${jumpPage}${q ? `&q=${q}` : ""}`);
    }
  }

  let dataPromise;

  if (q) {
    // Search mode
    dataPromise = searchMedicines(q, limit);
  } else {
    // List mode
    dataPromise = getMedicines({ limit, offset, sort: "name", in_stock: true });
  }

  const data = await dataPromise;

  let medicines = "medicines" in data ? data.medicines : data.matches;
  
  if (q && medicines) {
    // Sort in-stock items first
    medicines = [...medicines].sort((a: any, b: any) => {
      if (a.in_stock === b.in_stock) return 0;
      return a.in_stock ? -1 : 1;
    });
  }
  // Fallback to basic length since we aren't showing stats right now
  const totalItems = "medicines" in data ? 87000 : medicines.length; // Hardcoded estimate just for pagination visual
  const totalPages = "medicines" in data ? Math.ceil(totalItems / limit) : 1; 

  return (
    <div className="container">
      {!q && <HeroBanners />}

      {q && (
        <div className="results-info" style={{ marginTop: '20px', marginBottom: '20px', color: '#666' }}>
          <span>Найдено совпадений: {medicines?.length || 0}</span>
        </div>
      )}

      {/* Products Grid */}
      <section className="products-section">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h2 className="section-title" style={{ margin: 0 }}>{q ? 'Результаты поиска' : 'Популярные товары'}</h2>
          <Link href="/catalog" style={{ color: 'var(--primary)', fontWeight: '500' }}>Смотреть все &rarr;</Link>
        </div>

        {medicines && medicines.length > 0 ? (
          <div className="medicine-grid">
            {medicines.map((item: any, i: number) => (
              <ProductCard key={i} item={item} />
            ))}
          </div>
        ) : (
          <div className="loading" style={{ padding: '60px', textAlign: 'center' }}>Ничего не найдено</div>
        )}
      </section>

      {/* Pagination & Jump */}
      {!q && totalPages > 1 && (
        <div className="pagination" style={{ flexWrap: "wrap", marginTop: '40px' }}>
          <Link href={`/?page=${Math.max(1, page - 1)}`} className={page <= 1 ? "disabled" : ""}>
            &larr; Назад
          </Link>
          
          <span className="current">
            Страница {page}
          </span>
          
          <Link href={`/?page=${Math.min(totalPages, page + 1)}`} className={page >= totalPages ? "disabled" : ""}>
            Вперед &rarr;
          </Link>
        </div>
      )}
    </div>
  );
}
