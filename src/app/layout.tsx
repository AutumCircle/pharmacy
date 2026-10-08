import type { Metadata } from 'next';
import './globals.css';
import { CartProvider } from '../context/CartContext';
import { FavoritesProvider } from '../context/FavoritesContext';
import LayoutWrapper from '../components/LayoutWrapper';
import { SITE_FOOTER } from '@/config/site-footer';
import AttributionTracker from '../components/AttributionTracker';
import {
  DEFAULT_DESCRIPTION,
  DEFAULT_KEYWORDS,
  DEFAULT_TITLE,
  LOGO_PATH,
  SITE_ALTERNATE_NAMES,
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
  const envLinks = (process.env.SITE_SOCIAL_LINKS || '')
    .split(',')
    .map((link) => link.trim())
    .filter((link) => /^https:\/\//.test(link));
  const sameAs = [...new Set([SITE_FOOTER.instagram, ...envLinks])];
  const phones = SITE_FOOTER.phones.map((phone) => phone.href.replace(/^tel:/, ''));
  const street = process.env.SITE_STREET_ADDRESS?.trim()
    || SITE_FOOTER.address.replace(new RegExp(`^${SITE_CITY},\\s*`), '');
  const [opens, closes] = SITE_FOOTER.workingHours.split(/[–-]/).map((value) => value.trim());
  return [
    {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      '@id': `${siteUrl}/#website`,
      url: siteUrl,
      name: SITE_SHORT_NAME,
      alternateName: SITE_ALTERNATE_NAMES,
      inLanguage: ['ru', 'tg'],
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
      alternateName: SITE_ALTERNATE_NAMES,
      url: siteUrl,
      logo: absoluteUrl(LOGO_PATH),
      image: absoluteUrl(LOGO_PATH),
      description: DEFAULT_DESCRIPTION,
      telephone: process.env.SITE_PHONE?.trim() || phones[0],
      address: {
        '@type': 'PostalAddress',
        streetAddress: street,
        addressLocality: SITE_CITY,
        addressCountry: 'TJ',
      },
      ...(opens && closes ? {
        openingHoursSpecification: {
          '@type': 'OpeningHoursSpecification',
          dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
          opens,
          closes,
        },
      } : {}),
      areaServed: { '@type': 'City', name: SITE_CITY },
      currenciesAccepted: 'TJS',
      paymentAccepted: 'Cash',
      sameAs,
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
