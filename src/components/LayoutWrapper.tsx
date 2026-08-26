'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import CartIcon from './CartIcon';
import MobileCartIcon from './MobileCartIcon';
import SearchBar from './SearchBar';
import CategoryNav from './CategoryNav';
import Footer from './Footer';
import Image from 'next/image';
import OrdersIcon from './OrdersIcon';

export default function LayoutWrapper({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  
  if (pathname.startsWith('/admin')) {
    return <main className="main-content">{children}</main>;
  }

  return (
    <>
      <header className="header">
        <div className="container">
          <div className="header-inner">
            <Link href="/" className="logo">
              <Image className="brand-symbol" src="/assets/apteka-vatan-logo.png" alt="" width={54} height={54} priority />
              <Image className="brand-name" src="/assets/apteka-vatan-name.png" alt="Аптека Ватан" width={150} height={52} priority />
              <div className="logo-icon">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"></path></svg>
              </div>
              <span className="logo-text">ВАТАН<br/><span style={{fontSize: '10px', display: 'block', color: '#B71C1C'}}>АПТЕКА</span></span>
            </Link>
            
            <SearchBar />

            <div className="header-actions">
              <Link href="/catalog" className="action-item">
                <div className="icon-wrapper">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>
                </div>
                <span>Каталог</span>
              </Link>
              <CartIcon />
              <Link href="/tracking" className="action-item">
                <div className="icon-wrapper">
                  <OrdersIcon />
                </div>
                <span style={{ whiteSpace: 'nowrap' }}>Мои заказы</span>
              </Link>
              <Link href="/favorites" className="action-item">
                <div className="icon-wrapper">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>
                </div>
                <span style={{ whiteSpace: 'nowrap' }}>Избранное</span>
              </Link>
            </div>
          </div>
        </div>
      </header>

      <CategoryNav />

      <main className="main-content">
        {children}
      </main>

      <Footer />

      {/* Mobile Bottom Nav */}
      <nav className="bottom-nav">
        <Link href="/" className={`nav-item ${pathname === '/' ? 'active' : ''}`} aria-current={pathname === '/' ? 'page' : undefined}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>
          <span>Главная</span>
        </Link>
        <Link href="/catalog" className={`nav-item ${pathname === '/catalog' || pathname.startsWith('/category/') ? 'active' : ''}`} aria-current={pathname === '/catalog' || pathname.startsWith('/category/') ? 'page' : undefined}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>
          <span>Каталог</span>
        </Link>
        <MobileCartIcon />

        <Link href="/tracking" className={`nav-item ${pathname === '/tracking' ? 'active' : ''}`} aria-current={pathname === '/tracking' ? 'page' : undefined}>
          <OrdersIcon />
          <span>Мои заказы</span>
        </Link>
        <Link href="/favorites" className={`nav-item ${pathname === '/favorites' ? 'active' : ''}`} aria-current={pathname === '/favorites' ? 'page' : undefined}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>
          <span>Избранное</span>
        </Link>
      </nav>
    </>
  );
}
