import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { ApiV1Error, getPublicMedicine } from '@/lib/api-v1/server';
import type { PublicMedicine } from '@/lib/api-v1/types';
import { formatVendorCountry } from '@/lib/formatters';
import { SITE_CITY, SITE_NAME, absoluteUrl, formatPriceTjs, getSiteUrl, jsonLd, medicinePath } from '@/lib/seo';
import ProductDetailsClient from './ProductDetailsClient';

type Params = { params: Promise<{ name: string }> };

const loadMedicine = cache(async (rawId: string): Promise<PublicMedicine> => {
  const medicineId = Number(rawId);
  if (!Number.isInteger(medicineId) || medicineId <= 0) notFound();
  try {
    return (await getPublicMedicine(medicineId)).data;
  } catch (error) {
    if (error instanceof ApiV1Error && error.status === 404) notFound();
    throw error;
  }
});

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { name } = await params;
  const product = await loadMedicine(name);
  const price = formatPriceTjs(product.selling_unit_price);
  const availability = product.in_stock ? 'в наличии' : 'нет в наличии';
  const title = `${product.medicine_name} — купить в ${SITE_CITY}, цена ${price}`;
  const maker = [product.vendor, product.country]
    .map((value) => (value ? formatVendorCountry(value) : null))
    .filter((value) => value && value !== 'Не указано')
    .join(', ');
  const description = `${product.medicine_name}${maker ? ` (${maker})` : ''}: цена ${price}, ${availability}. `
    + `Закажите онлайн в ${SITE_NAME} с доставкой по ${SITE_CITY}, оплата при получении.`;
  const path = medicinePath(product.medicine_id);
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      type: 'website',
      title,
      description,
      url: path,
      ...(product.image_url ? { images: [{ url: product.image_url, alt: product.medicine_name }] } : {}),
    },
  };
}

function productStructuredData(product: PublicMedicine) {
  const siteUrl = getSiteUrl();
  const url = absoluteUrl(medicinePath(product.medicine_id));
  const brand = product.vendor ? formatVendorCountry(product.vendor) : null;
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    '@id': `${url}#product`,
    name: product.medicine_name,
    url,
    sku: String(product.medicine_id),
    ...(product.image_url ? { image: [product.image_url] } : {}),
    ...(brand && brand !== 'Не указано' ? { brand: { '@type': 'Brand', name: brand } } : {}),
    ...(product.country && formatVendorCountry(product.country) !== 'Не указано'
      ? { countryOfOrigin: formatVendorCountry(product.country) }
      : {}),
    offers: {
      '@type': 'Offer',
      url,
      price: product.selling_unit_price.toFixed(2),
      priceCurrency: product.currency,
      availability: product.in_stock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
      itemCondition: 'https://schema.org/NewCondition',
      seller: { '@id': `${siteUrl}/#pharmacy` },
      areaServed: { '@type': 'City', name: SITE_CITY },
    },
  };
}

export default async function MedicinePage({ params }: Params) {
  const { name } = await params;
  const product = await loadMedicine(name);
  return (
    <div className="container" style={{ paddingTop: '30px' }}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLd(productStructuredData(product)) }}
      />
      <ProductDetailsClient product={product} />
    </div>
  );
}
