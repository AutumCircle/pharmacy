/** Shared SEO constants and helpers for public pages.
 *
 * The canonical origin comes from the server-only `SITE_URL` variable (for
 * example `https://vatan.tj`). On Vercel it falls back to the production
 * domain so canonical links, sitemap entries and Open Graph URLs never point
 * at preview deployments.
 */

export const SITE_NAME = 'Аптека «Ватан»';
export const SITE_SHORT_NAME = 'Аптека Ватан';
export const SITE_CITY = 'Душанбе';

export const DEFAULT_TITLE = 'Аптека Ватан — заказ и доставка лекарств в Душанбе';
export const DEFAULT_DESCRIPTION =
  'Аптека Ватан в Душанбе: тысячи лекарств и товаров для здоровья с актуальными ценами в сомони. '
  + 'Закажите онлайн за пару минут — доставим по Душанбе, оплата наличными при получении.';

export const DEFAULT_KEYWORDS = [
  'аптека Ватан',
  'аптека Ватан Душанбе',
  'Ватан аптека',
  'Vatan pharmacy',
  'аптека Душанбе',
  'онлайн аптека Душанбе',
  'заказать лекарства Душанбе',
  'доставка лекарств Душанбе',
  'купить лекарства Душанбе',
  'дорухона Душанбе',
  'дорухонаи Ватан',
];

export const LOGO_PATH = '/assets/apteka-vatan-logo.png';

function normalizeOrigin(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    return new URL(withProtocol).origin;
  } catch {
    return null;
  }
}

export function getSiteUrl(): string {
  return normalizeOrigin(process.env.SITE_URL)
    ?? normalizeOrigin(process.env.VERCEL_PROJECT_PRODUCTION_URL)
    ?? 'http://localhost:3000';
}

export function absoluteUrl(path = '/'): string {
  return new URL(path, getSiteUrl()).toString();
}

export function medicinePath(medicineId: number): string {
  return `/medicine/${medicineId}`;
}

export function categoryPath(slug: string): string {
  return `/category/${encodeURIComponent(slug)}`;
}

export function formatPriceTjs(value: number): string {
  return `${value.toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} сомони`;
}

/** Serialises JSON-LD safely for an inline <script> tag. */
export function jsonLd(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}
