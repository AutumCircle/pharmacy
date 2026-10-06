import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { ApiV1Error, getPublicCollection, getPublicSiteSettings } from '@/lib/api-v1/server';
import type { PublicCollection } from '@/lib/api-v1/types';
import { isValidSlug } from '@/lib/collections';
import { LOGO_PATH, SITE_NAME, absoluteUrl } from '@/lib/seo';
import CollectionProducts from './CollectionProducts';

// Prices and stock must come from the live catalogue, exactly like the rest of the site.
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ slug: string }> };

const loadCollection = cache(async (slug: string): Promise<PublicCollection> => {
  if (!isValidSlug(slug)) notFound();
  try {
    return (await getPublicCollection(slug)).data;
  } catch (error) {
    if (error instanceof ApiV1Error && error.status === 404) notFound();
    throw error;
  }
});

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const collection = await loadCollection(slug);
  const title = `${collection.title} — ${SITE_NAME}`;
  const description = collection.description || 'Товары с актуальными ценами. Закажите онлайн с доставкой по Душанбе.';
  const firstImage = collection.medicines.find((medicine) => medicine.image_url)?.image_url;
  const image = firstImage || absoluteUrl(LOGO_PATH);
  const path = `/podborka/${encodeURIComponent(collection.slug)}`;
  return {
    title: { absolute: title },
    description,
    // Temporary marketing pages: not needed in search results.
    robots: { index: false, follow: true },
    openGraph: { type: 'website', title, description, url: path, images: [{ url: image, alt: collection.title }] },
    twitter: { card: 'summary_large_image', title, description, images: [image] },
  };
}

async function pharmacyPhone(): Promise<string | null> {
  try {
    const phone = (await getPublicSiteSettings()).data.delivery_contact_phone;
    if (phone) return phone;
  } catch {
    // Fall through to the configured site phone.
  }
  return process.env.SITE_PHONE?.trim() || null;
}

export default async function CollectionPage({ params }: Params) {
  const { slug } = await params;
  const [collection, phone] = await Promise.all([loadCollection(slug), pharmacyPhone()]);

  return (
    <div className="container" style={{ paddingTop: '20px', paddingBottom: '50px' }}>
      <div style={{ marginBottom: '20px' }}>
        <h1 className="section-title" style={{ marginBottom: '8px' }}>{collection.title}</h1>
        {collection.description && <p style={{ margin: 0, color: '#555', lineHeight: 1.5 }}>{collection.description}</p>}
      </div>

      {collection.medicines.length > 0 ? (
        <CollectionProducts slug={collection.slug} medicines={collection.medicines} phone={phone} />
      ) : (
        <div className="empty-state" style={{ padding: '60px', textAlign: 'center' }}>В этой подборке пока нет товаров</div>
      )}

      <section className="collection-order-guide" aria-labelledby="how-to-order">
        <div className="collection-order-guide__heading">
          <span>Заказ за несколько минут</span>
          <h2 id="how-to-order">Как заказать</h2>
        </div>
        <ol className="collection-order-steps">
          <li className="collection-order-step">
            <span className="collection-order-step__number">1</span>
            <span className="collection-order-step__icon" aria-hidden="true">＋</span>
            <strong>Добавьте в корзину</strong>
            <p>Выберите нужные товары и нажмите кнопку «В корзину».</p>
          </li>
          <li className="collection-order-step">
            <span className="collection-order-step__number">2</span>
            <span className="collection-order-step__icon" aria-hidden="true">🛒</span>
            <strong>Откройте корзину</strong>
            <p>Проверьте выбранные товары и их количество.</p>
          </li>
          <li className="collection-order-step">
            <span className="collection-order-step__number">3</span>
            <span className="collection-order-step__icon" aria-hidden="true">✓</span>
            <strong>Оформите заказ</strong>
            <p>Укажите телефон и адрес — аптека подтвердит заказ.</p>
          </li>
        </ol>
        <div className="collection-order-guide__actions">
          <Link href="/cart" style={{ padding: '12px 24px', background: 'var(--primary)', color: 'white', borderRadius: '24px', fontWeight: 600 }}>
            Перейти в корзину
          </Link>
          <Link href="/catalog" style={{ padding: '12px 24px', border: '1px solid var(--primary)', color: 'var(--primary)', borderRadius: '24px', fontWeight: 600 }}>
            Весь каталог
          </Link>
        </div>
      </section>
    </div>
  );
}
