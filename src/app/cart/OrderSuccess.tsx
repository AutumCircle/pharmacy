'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import type { PublicOrder } from '@/lib/api-v1/types';

/** «Заказ принят»: animated check, order number, one line, «Смотреть заказ». Shown at the top of the page
 * with focus on the heading, so a phone never stays scrolled down at the old form. */
export default function OrderSuccess({ order }: { order: PublicOrder }) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    headingRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <div className="order-done" role="status" aria-live="polite">
      <div className="order-done-mark" aria-hidden="true">
        <span className="order-done-ring" />
        <span className="order-done-circle">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none">
            <path className="order-done-check" d="M5 12.5l4.5 4.5L19 7.5" stroke="#FFFFFF" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </div>
      <h1 ref={headingRef} tabIndex={-1} className="order-done-title">Заказ принят</h1>
      <div className="order-done-number">
        <span>№ {order.order_reference}</span>
        <span className="order-done-next">Скоро позвоним для подтверждения</span>
      </div>
      <div className="order-done-actions">
        <Link href={`/tracking?order=${encodeURIComponent(order.order_id)}`} className="order-done-primary">Смотреть заказ</Link>
        <Link href="/" className="order-done-secondary">Продолжить покупки</Link>
      </div>
    </div>
  );
}
