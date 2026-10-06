import type { Metadata } from 'next';
import './globals.css';
import { CartProvider } from '../context/CartContext';
import { FavoritesProvider } from '../context/FavoritesContext';
import LayoutWrapper from '../components/LayoutWrapper';
import AttributionTracker from '../components/AttributionTracker';
import {
  DEFAULT_DESCRIPTION,
  DEFAULT_KEYWORDS,
  DEFAULT_TITLE,
  LOGO_PATH,
  SITE_CITY,
  SITE_NAME,
  SITE_SHORT_NAME,
  absoluteUrl,
  getSiteUrl,
  jsonLd,
} from '@/lib/seo';

export const metadata: Metadata = {
  metadataBase: new URL(getSiteUrl()),
  title: {
    default: DEFAULT_TITLE,
    template: `%s | ${SITE_SHORT_NAME}`,
  },
  description: DEFAULT_DESCRIPTION,
  keywords: DEFAULT_KEYWORDS,
  applicationName: SITE_SHORT_NAME,
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    locale: 'ru_RU',
    siteName: SITE_NAME,
    title: DEFAULT_TITLE,
    description: DEFAULT_DESCRIPTION,
    url: '/',
    images: [{ url: LOGO_PATH, alt: SITE_NAME }],
  },
  twitter: {
    card: 'summary',
    title: DEFAULT_TITLE,
    description: DEFAULT_DESCRIPTION,
  },
  robots: { index: true, follow: true },
  // Ownership tokens from Google Search Console / Yandex Webmaster / Bing Webmaster
  // are configured as server environment variables, never hard-coded.
  verification: {
    google: process.env.GOOGLE_SITE_VERIFICATION || undefined,
    yandex: process.env.YANDEX_VERIFICATION || undefined,
    other: process.env.BING_SITE_VERIFICATION
      ? { 'msvalidate.01': process.env.BING_SITE_VERIFICATION }
      : undefined,
  },
  icons: {
    icon: [{ url: LOGO_PATH, type: 'image/png', sizes: '66x66' }],
    shortcut: LOGO_PATH,
    apple: LOGO_PATH,
  },
};

function siteStructuredData() {
  const siteUrl = getSiteUrl();
  const sameAs = (process.env.SITE_SOCIAL_LINKS || '')
    .split(',')
    .map((link) => link.trim())
    .filter((link) => /^https:\/\//.test(link));
  const phone = process.env.SITE_PHONE?.trim();
  const street = process.env.SITE_STREET_ADDRESS?.trim();
  return [
    {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      '@id': `${siteUrl}/#website`,
      url: siteUrl,
      name: SITE_NAME,
      alternateName: [SITE_SHORT_NAME, 'Ватан аптека', 'Vatan pharmacy', 'Дорухонаи Ватан'],
      inLanguage: 'ru',
      publisher: { '@id': `${siteUrl}/#pharmacy` },
      potentialAction: {
        '@type': 'SearchAction',
        target: { '@type': 'EntryPoint', urlTemplate: `${siteUrl}/?q={search_term_string}` },
        'query-input': 'required name=search_term_string',
      },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'Pharmacy',
      '@id': `${siteUrl}/#pharmacy`,
      name: SITE_NAME,
      alternateName: [SITE_SHORT_NAME, 'Vatan pharmacy'],
      url: siteUrl,
      logo: absoluteUrl(LOGO_PATH),
      image: absoluteUrl(LOGO_PATH),
      description: DEFAULT_DESCRIPTION,
      ...(phone ? { telephone: phone } : {}),
      address: {
        '@type': 'PostalAddress',
        ...(street ? { streetAddress: street } : {}),
        addressLocality: SITE_CITY,
        addressCountry: 'TJ',
      },
      areaServed: { '@type': 'City', name: SITE_CITY },
      currenciesAccepted: 'TJS',
      paymentAccepted: 'Cash',
      ...(sameAs.length ? { sameAs } : {}),
    },
  ];
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ru">
      <body>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: jsonLd(siteStructuredData()) }}
        />
        <FavoritesProvider>
          <CartProvider>
            <AttributionTracker />
            <LayoutWrapper>
              {children}
            </LayoutWrapper>
          </CartProvider>
        </FavoritesProvider>
      </body>
    </html>
  );
}
