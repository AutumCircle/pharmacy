import type { MetadataRoute } from 'next';
import { getPublicCategories, getPublicCategoryMedicines } from '@/lib/api-v1/server';
import type { PublicCategory, PublicMedicine } from '@/lib/api-v1/types';
import { absoluteUrl, categoryPath, medicinePath } from '@/lib/seo';

// Rebuild at most once per day; search engines do not need fresher data and
// this keeps the number of upstream catalogue reads small. Upstream reads use
// the same lifetime, otherwise their shorter cache would shorten this route's.
const SITEMAP_CACHE_SECONDS = 86400;
export const revalidate = 86400;

const PAGE_SIZE = 100; // public API maximum
const MAX_PAGES_PER_CATEGORY = 100;
const CONCURRENCY = 6;
const MAX_URLS = 45_000; // single sitemap file limit is 50 000 URLs

async function loadCategories(): Promise<PublicCategory[]> {
  const categories: PublicCategory[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 20; i += 1) {
    const response = await getPublicCategories(PAGE_SIZE, cursor, SITEMAP_CACHE_SECONDS);
    categories.push(...response.data);
    if (!response.page.has_more || !response.page.next_cursor) break;
    cursor = response.page.next_cursor;
  }
  return categories;
}

async function loadCategoryMedicines(slug: string): Promise<PublicMedicine[]> {
  const medicines: PublicMedicine[] = [];
  let totalPages = 1;
  for (let page = 1; page <= Math.min(totalPages, MAX_PAGES_PER_CATEGORY); page += 1) {
    try {
      const response = await getPublicCategoryMedicines(slug, page, PAGE_SIZE, SITEMAP_CACHE_SECONDS);
      totalPages = response.page.total_pages;
      medicines.push(...response.data.medicines);
    } catch (error) {
      console.error(`sitemap: failed to load category ${slug} page ${page}`, error);
      break;
    }
  }
  return medicines;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const entries: MetadataRoute.Sitemap = [
    { url: absoluteUrl('/'), changeFrequency: 'daily', priority: 1 },
    { url: absoluteUrl('/catalog'), changeFrequency: 'daily', priority: 0.9 },
  ];

  let categories: PublicCategory[] = [];
  try {
    categories = await loadCategories();
  } catch (error) {
    console.error('sitemap: failed to load categories', error);
    return entries;
  }

  for (const category of categories) {
    entries.push({ url: absoluteUrl(categoryPath(category.slug)), changeFrequency: 'daily', priority: 0.8 });
  }

  const seen = new Set<number>();
  for (let start = 0; start < categories.length; start += CONCURRENCY) {
    const batch = categories.slice(start, start + CONCURRENCY);
    const results = await Promise.all(batch.map((category) => loadCategoryMedicines(category.slug)));
    for (const medicine of results.flat()) {
      if (seen.has(medicine.medicine_id)) continue;
      seen.add(medicine.medicine_id);
      entries.push({
        url: absoluteUrl(medicinePath(medicine.medicine_id)),
        lastModified: medicine.catalog_updated_at ?? undefined,
        changeFrequency: 'weekly',
        priority: medicine.in_stock ? 0.6 : 0.3,
      });
    }
    if (entries.length >= MAX_URLS) break;
  }

  return entries.slice(0, MAX_URLS);
}
