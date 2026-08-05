import type { Metadata } from 'next';
import './globals.css';
import { CartProvider } from '../context/CartContext';
import { FavoritesProvider } from '../context/FavoritesContext';
import LayoutWrapper from '../components/LayoutWrapper';

export const metadata: Metadata = {
  title: 'Аптека ВАТАН - Доставка лекарств в Душанбе',
  description: 'Широкий ассортимент лекарств и доставка в Душанбе',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ru">
      <body>
        <FavoritesProvider>
          <CartProvider>
            <LayoutWrapper>
              {children}
            </LayoutWrapper>
          </CartProvider>
        </FavoritesProvider>
      </body>
    </html>
  );
}
