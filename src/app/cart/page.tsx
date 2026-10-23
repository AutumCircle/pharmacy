'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useCart } from '../../context/CartContext';
import type { PublicOrder } from '@/lib/api-v1/types';
import { invalidateTrackedOrders } from '@/lib/api-v1/client-reads';
import { type DeliveryAddress, minimumOrderShortfall, parseSavedAddresses, rememberAddress } from '@/lib/checkout-order';
import CartView from './CartView';
import CheckoutView from './CheckoutView';
import OrderSuccess from './OrderSuccess';
import './cart.css';

export default function CartPage() {
  const { items, removeItem, updateQuantity, clearCart, totalPrice, totalItems } = useCart();
  const [phase, setPhase] = useState<'cart' | 'checkout' | 'success'>('cart');
  const [createdOrder, setCreatedOrder] = useState<PublicOrder | null>(null);

  const goToCheckout = () => {
    // Unavailable items are taken out on the way, as the cart promises.
    const unavailable = items.filter((item) => !item.in_stock);
    unavailable.forEach((item) => removeItem(item.medicine_id));
    const remaining = items.filter((item) => item.in_stock);
    const remainingTotal = remaining.reduce((sum, item) => sum + item.selling_unit_price * item.quantity, 0);
    if (!remaining.length || minimumOrderShortfall(remainingTotal) > 0) return;
    setPhase('checkout');
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  };

  const backToCart = () => {
    setPhase('cart');
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  };

  const handleSuccess = (order: PublicOrder, phoneDigits: string, address: DeliveryAddress) => {
    try {
      const saved = parseSavedAddresses(localStorage.getItem('vatan_addresses'));
      localStorage.setItem('vatan_addresses', JSON.stringify(rememberAddress(saved, address)));
      // «Мои заказы» opens with this phone and this order.
      localStorage.setItem('userPhone', phoneDigits);
      localStorage.setItem('lastOrderReference', order.order_reference);
    } catch {
      // Storage is a convenience only; the order exists either way.
    }
    invalidateTrackedOrders(`+992${phoneDigits}`);
    setCreatedOrder(order);
    setPhase('success');
    clearCart();
  };

  if (phase === 'success' && createdOrder) {
    return <div className="container cart-shell"><OrderSuccess order={createdOrder} /></div>;
  }

  if (items.length === 0) {
    return (
      <div className="container cart-empty">
        <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><circle cx="9" cy="21" r="1" /><circle cx="20" cy="21" r="1" /><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" /></svg>
        <h1>Ваша корзина пуста</h1>
        <p>Начните покупки, чтобы добавить товары в корзину.</p>
        <Link href="/" className="cart-primary-button is-inline">Перейти к покупкам</Link>
      </div>
    );
  }

  return (
    <div className="container cart-shell">
      {phase === 'checkout' ? (
        <CheckoutView items={items} totalPrice={totalPrice} totalItems={totalItems} onBack={backToCart} onSuccess={handleSuccess} />
      ) : (
        <CartView items={items} totalItems={totalItems} onCheckout={goToCheckout}
          onRemove={removeItem} onQuantity={updateQuantity} onClear={clearCart} />
      )}
    </div>
  );
}
