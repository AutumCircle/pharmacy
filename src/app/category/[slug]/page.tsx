import ProductCard from "@/components/ProductCard";
import Link from "next/link";
import { redirect } from "next/navigation";

export const revalidate = 0;

export default async function CategoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const resolvedParams = await params;
  const slug = resolvedParams.slug;
  const sParams = await searchParams;
  
  const pageStr = typeof sParams.page === "string" ? sParams.page : "1";
  let page = parseInt(pageStr, 10);
  if (isNaN(page) || page < 1) page = 1;
  const limit = 20;

  // Jump page logic
  if (typeof sParams.jump_to_page === "string") {
    const jumpPage = parseInt(sParams.jump_to_page, 10);
    if (!isNaN(jumpPage) && jumpPage >= 1) {
      redirect(`/category/${slug}?page=${jumpPage}`);
    }
  }

  // Remove MOCK DATA
  const categoryData = { id: 1, name: slug };
  const totalRelations = 0;
  const products: any[] = []; // empty for now since API doesn't support categories yet

  const totalPages = 1;

  return (
    <div className="container" style={{ paddingTop: '20px' }}>
      <h2 className="section-title" style={{ marginBottom: '20px' }}>Категория: {categoryData.name}</h2>
      
      {products.length > 0 ? (
        <div className="medicine-grid">
          {products.map((item: any, i: number) => (
            <ProductCard key={i} item={item} />
          ))}
        </div>
      ) : (
        <div className="empty-state" style={{ padding: '60px', textAlign: 'center' }}>
           В этой категории пока нет товаров
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="pagination" style={{ flexWrap: "wrap", marginTop: '40px' }}>
          <Link href={`/category/${slug}?page=${Math.max(1, page - 1)}`} className={page <= 1 ? "disabled" : ""}>
            &larr; Назад
          </Link>
          
          <span className="current">
            Страница {page} из {totalPages}
          </span>
          
          <Link href={`/category/${slug}?page=${Math.min(totalPages, page + 1)}`} className={page >= totalPages ? "disabled" : ""}>
            Вперед &rarr;
          </Link>

          <form action={`/category/${slug}`} method="GET" style={{ display: "flex", alignItems: "center", marginLeft: "20px", gap: "8px" }}>
            <span style={{ fontSize: "0.9rem" }}>Перейти на:</span>
            <input 
              type="number" 
              name="jump_to_page" 
              min="1" 
              max={totalPages} 
              defaultValue={page}
              style={{ width: "60px", padding: "6px", borderRadius: "4px", border: "1px solid var(--border)" }}
            />
            <button type="submit" className="pagination button" style={{ padding: "6px 12px" }}>Go</button>
          </form>
        </div>
      )}
    </div>
  );
}
