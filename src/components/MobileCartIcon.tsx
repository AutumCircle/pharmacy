'use client';

import Link from 'next/link';
import { useCart } from '../context/CartContext';
import { usePathname } from 'next/navigation';

export default function MobileCartIcon() {
  const { totalItems } = useCart();
  const pathname = usePathname();
  const isActive = pathname === '/cart';

  return (
    <Link href="/cart" className={`nav-item ${isActive ? 'active' : ''}`}>
      <div className="icon-wrapper">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="9" cy="21" r="1"></circle>
          <circle cx="20" cy="21" r="1"></circle>
          <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path>
        </svg>
        {totalItems > 0 && <span className="badge">{totalItems}</span>}
      </div>
      <span>Корзина</span>
    </Link>
  );
}
