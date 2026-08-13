'use client';

import { useState, useEffect } from 'react';
import { useCart } from '../../context/CartContext';
import Link from 'next/link';
import type { CreateOrderRequest, CreateOrderResponse, PublicOrder } from '@/lib/api-v1/types';
import { invalidateTrackedOrders } from '@/lib/api-v1/client-reads';

function orderFingerprint(value: string): string {
  // This fingerprint only matches a pending retry with the same payload. It is
  // not used for authentication, so it must also work on local HTTP origins
  // where mobile browsers do not expose crypto.subtle.
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
  }
  return `${(first >>> 0).toString(16).padStart(8, '0')}${(second >>> 0).toString(16).padStart(8, '0')}`;
}

function createIdempotencyKey(): string {
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export default function CartPage() {
  const { items, removeItem, updateQuantity, clearCart, totalPrice, totalItems } = useCart();
  const [phase, setPhase] = useState<'cart' | 'checkout' | 'success'>('cart');
  const [formData, setFormData] = useState({ 
    name: '', 
    phone: '', 
    address: '',
    comment: ''
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [createdOrder, setCreatedOrder] = useState<PublicOrder | null>(null);
  
  const [addresses, setAddresses] = useState<string[]>([]);
  const [isAddressModalOpen, setIsAddressModalOpen] = useState(false);
  const [newAddress, setNewAddress] = useState({ street: '', landmark: '' });
  const unavailableCount = items.filter((item) => !item.in_stock).length;

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const saved = localStorage.getItem('vatan_customer');
      if (saved) {
        try {
          const parsed = JSON.parse(saved) as { name?: string; phone?: string; address?: string };
          setFormData(prev => ({
            ...prev,
            name: parsed.name || '',
            phone: parsed.phone || '',
            address: parsed.address || ''
          }));
        } catch {}
      }
      const savedAddresses = localStorage.getItem('vatan_addresses');
      if (savedAddresses) {
        try {
          setAddresses(JSON.parse(savedAddresses) as string[]);
        } catch {}
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  // Formatting phone: XXX-XX-XX-XX
  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.replace(/\D/g, '').substring(0, 9);
    setFormData({ ...formData, phone: val });
  };

  const displayPhone = () => {
    const val = formData.phone;
    let formatted = val;
    if (val.length > 3) formatted = val.slice(0,3) + '-' + val.slice(3);
    if (val.length > 5) formatted = formatted.slice(0,7) + '-' + formatted.slice(7);
    if (val.length > 7) formatted = formatted.slice(0,10) + '-' + formatted.slice(10);
    return formatted;
  }

  const handleAddAddress = () => {
    if (!newAddress.street) return;
    const full = `${newAddress.street}${newAddress.landmark ? ` (${newAddress.landmark})` : ''}`;
    const updated = [...addresses, full];
    setAddresses(updated);
    setFormData({ ...formData, address: full });
    localStorage.setItem('vatan_addresses', JSON.stringify(updated));
    setIsAddressModalOpen(false);
    setNewAddress({ street: '', landmark: '' });
  };

  const handleCheckoutSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsSubmitting(true);
    setCheckoutError(null);
    if (!formData.address.trim()) {
      setCheckoutError('Добавьте и выберите адрес доставки.');
      setIsSubmitting(false);
      return;
    }
    
    // Save customer info for future
    localStorage.setItem('vatan_customer', JSON.stringify(formData));
    
    try {
      const order: CreateOrderRequest = {
        customer_name: formData.name,
        phone: formData.phone,
        address: formData.address,
        comment: formData.comment || null,
        items: items.map((item) => ({
          medicine_id: item.medicine_id,
          quantity: item.quantity,
        })),
      };
      const payloadJson = JSON.stringify(order);
      const requestHash = orderFingerprint(payloadJson);
      const pendingRaw = sessionStorage.getItem('vatan_pending_order_v1');
      let idempotencyKey = createIdempotencyKey();
      if (pendingRaw) {
        try {
          const pending = JSON.parse(pendingRaw) as { requestHash?: string; idempotencyKey?: string };
          if (pending.requestHash === requestHash && pending.idempotencyKey) idempotencyKey = pending.idempotencyKey;
        } catch {
          sessionStorage.removeItem('vatan_pending_order_v1');
        }
      }
      sessionStorage.setItem('vatan_pending_order_v1', JSON.stringify({ requestHash, idempotencyKey }));
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        body: payloadJson,
      });
      
      if (res.ok) {
        const response = await res.json() as CreateOrderResponse;
        // Save just the phone for tracking purposes globally
        localStorage.setItem('userPhone', formData.phone);
        localStorage.setItem('lastOrderReference', response.data.order_reference);
        invalidateTrackedOrders(`+992${formData.phone}`);
        sessionStorage.removeItem('vatan_pending_order_v1');
        setCreatedOrder(response.data);
        setPhase('success');
        setIsSubmitting(false);
        clearCart();
      } else {
        const payload = await res.json().catch(() => null) as { error?: { code?: string; message?: string } } | null;
        const messages: Record<string, string> = {
          ORDER_ITEMS_UNAVAILABLE: 'Некоторые лекарства больше не доступны. Вернитесь в корзину и обновите товары.',
          MEDICINE_NOT_FOUND: 'Некоторые лекарства больше не найдены в каталоге.',
          MINIMUM_ORDER_NOT_REACHED: 'После проверки актуальных цен сумма заказа меньше 50 сомони.',
          IDEMPOTENCY_CONFLICT: 'Данные заказа изменились. Повторите оформление ещё раз.',
        };
        const code = payload?.error?.code || '';
        setCheckoutError(messages[code] || payload?.error?.message || 'Не удалось оформить заказ. Повторите попытку.');
        setIsSubmitting(false);
      }
    } catch {
      setCheckoutError('Нет связи с сервером. Проверьте интернет и повторите попытку.');
      setIsSubmitting(false);
    }
  };

  if (items.length === 0 && phase !== 'success') {
    return (
      <div className="container" style={{ padding: '80px 0', textAlign: 'center' }}>
        <div style={{ marginBottom: '20px', color: 'var(--border)' }}>
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="9" cy="21" r="1"></circle><circle cx="20" cy="21" r="1"></circle><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path></svg>
        </div>
        <h2 style={{ marginBottom: '10px' }}>Ваша корзина пуста</h2>
        <p style={{ color: '#666', marginBottom: '30px' }}>Начните покупки, чтобы добавить товары в корзину.</p>
        <Link href="/" className="pagination button" style={{ padding: '10px 20px', background: 'var(--primary)', color: 'white', borderRadius: '24px' }}>
          Перейти к покупкам
        </Link>
      </div>
    );
  }

  return (
    <div className="container" style={{ paddingTop: '40px', paddingBottom: '60px' }}>
      
      {phase === 'cart' && (
        <>
          <h1 className="section-title" style={{ fontSize: '28px', fontWeight: 'bold', marginBottom: '30px', color: '#313131' }}>Корзина</h1>
          <div className="cart-layout" style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: '40px', alignItems: 'start' }}>
            {/* Left: Cart Items */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>
              {items.map((item) => (
                <div className="cart-line-item" key={item.medicine_id} style={{ display: 'flex', gap: '20px', padding: '25px 0', borderBottom: '1px solid #F0F0F0' }}>
                  <div className="cart-line-image" style={{ width: '80px', height: '80px', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid #E8E8E8', borderRadius: '8px' }}>
                    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#ccc" strokeWidth="1.5"><rect x="7" y="7" width="10" height="14" rx="2" ry="2"></rect><path d="M5 7h14"></path><path d="M12 11v4"></path><path d="M10 13h4"></path><path d="M9 3h6v4H9z"></path></svg>
                  </div>
                  <div className="cart-line-body" style={{ flex: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div className="cart-line-info">
                      <div style={{ fontWeight: 'bold', fontSize: '18px', color: '#111', marginBottom: '4px' }}>{item.selling_unit_price.toFixed(0)} с.</div>
                      <div style={{ fontSize: '15px', color: '#333', fontWeight: 500, marginBottom: '4px' }}>{item.medicine_name}</div>
                      <div style={{ fontSize: '13px', color: item.in_stock ? '#4CAF50' : '#c62828', fontWeight: 500 }}>
                        {item.in_stock ? 'В наличии' : 'Нет в наличии — удалите из корзины'}
                      </div>
                    </div>
                    <div className="cart-line-actions" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '10px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                        <div className="cart-line-counter" style={{ display: 'flex', alignItems: 'center', background: '#F5F5F7', borderRadius: '24px', padding: '6px' }}>
                          <button onClick={() => updateQuantity(item.medicine_id, item.quantity - 1)} style={{ background: 'white', border: 'none', width: '32px', height: '32px', borderRadius: '50%', cursor: 'pointer', fontSize: '18px', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>−</button>
                          <span style={{ fontWeight: '600', fontSize: '15px', width: '32px', textAlign: 'center' }}>{item.quantity}</span>
                          <button disabled={!item.in_stock} onClick={() => updateQuantity(item.medicine_id, item.quantity + 1)} style={{ background: 'white', border: 'none', width: '32px', height: '32px', borderRadius: '50%', cursor: item.in_stock ? 'pointer' : 'not-allowed', fontSize: '18px', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', opacity: item.in_stock ? 1 : 0.4 }}>+</button>
                        </div>
                        <button className="cart-line-remove" aria-label="Удалить из корзины" onClick={() => removeItem(item.medicine_id)} style={{ background: '#fff', border: '1px solid #ffcdd2', color: '#d32f2f', width: '36px', height: '36px', borderRadius: '50%', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}>
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Right: Summary */}
            <div style={{ border: '1px solid #E8E8E8', borderRadius: '12px', padding: '25px', position: 'sticky', top: '20px' }}>
              <h3 style={{ fontSize: '22px', fontWeight: 'bold', marginBottom: '25px', color: '#313131' }}>Ваш заказ</h3>
              
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '15px', fontSize: '14px', color: '#666' }}>
                <span>Кол-во товаров</span>
                <span style={{ fontWeight: 'bold', color: '#111' }}>{totalItems} шт.</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '30px', fontSize: '14px', color: '#666' }}>
                <span>Стоимость товаров</span>
                <span style={{ fontWeight: 'bold', color: '#111' }}>{totalPrice.toFixed(0)} с.</span>
              </div>



              <button 
                onClick={() => setPhase('checkout')}
                disabled={unavailableCount > 0}
                style={{ 
                  width: '100%', 
                  padding: '16px', 
                  borderRadius: '24px',
                  background: 'var(--primary)', // Made red as requested
                  color: 'white',
                  border: 'none',
                  fontWeight: '600',
                  fontSize: '15px',
                  cursor: unavailableCount > 0 ? 'not-allowed' : 'pointer',
                  opacity: unavailableCount > 0 ? 0.5 : 1
                }}
              >
                {unavailableCount > 0 ? `Удалите недоступные товары (${unavailableCount})` : 'Перейти к оформлению'}
              </button>
            </div>
          </div>
        </>
      )}

      {phase === 'checkout' && (
        <div style={{ maxWidth: '600px', margin: '0 auto' }}>
          <h1 className="section-title" style={{ fontSize: '28px', fontWeight: 'bold', marginBottom: '30px', color: '#313131', textAlign: 'center' }}>Оформление заказа</h1>
          
          <form onSubmit={handleCheckoutSubmit}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '30px' }}>
              
              {/* Товары на оформление */}
              <div>
                <h3 style={{ fontSize: '18px', color: '#313131', marginBottom: '15px', fontWeight: 600 }}>Товары на оформление</h3>
                <div style={{ borderRadius: '12px', border: '1px solid #E8E8E8', overflow: 'hidden' }}>
                  {items.map((item, index) => (
                    <div key={item.medicine_id} style={{ display: 'flex', gap: '15px', padding: '15px 20px', borderBottom: index < items.length - 1 ? '1px solid #F0F0F0' : 'none', alignItems: 'center' }}>
                      <div style={{ width: '40px', height: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid #E8E8E8', borderRadius: '8px' }}>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ccc" strokeWidth="1.5"><rect x="7" y="7" width="10" height="14" rx="2" ry="2"></rect><path d="M5 7h14"></path><path d="M12 11v4"></path><path d="M10 13h4"></path><path d="M9 3h6v4H9z"></path></svg>
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: '14px', color: '#313131', fontWeight: 500 }}>{item.medicine_name}</div>
                        <div style={{ fontWeight: 'bold', fontSize: '14px', color: '#111', marginTop: '2px' }}>{item.selling_unit_price.toFixed(0)} с.</div>
                      </div>
                      <div style={{ fontSize: '14px', color: '#313131', fontWeight: 500 }}>{item.quantity} шт.</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Адрес доставки */}
              <div>
                <h3 style={{ fontSize: '18px', color: '#313131', marginBottom: '15px', fontWeight: 600 }}>Адрес доставки</h3>
                
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {addresses.map((a, i) => (
                    <label key={i} style={{ display: 'flex', alignItems: 'center', padding: '15px', borderRadius: '8px', border: formData.address === a ? '2px solid var(--primary)' : '1px solid #E8E8E8', background: formData.address === a ? '#FFEBEE' : 'white', cursor: 'pointer', transition: 'all 0.2s' }}>
                      <input 
                        type="radio" 
                        name="address_select" 
                        checked={formData.address === a}
                        onChange={() => setFormData({...formData, address: a})}
                        style={{ marginRight: '15px', accentColor: 'var(--primary)', width: '18px', height: '18px' }}
                      />
                      <span style={{ fontSize: '15px', color: '#313131', flex: 1 }}>{a}</span>
                    </label>
                  ))}
                  
                  <button 
                    type="button"
                    onClick={() => setIsAddressModalOpen(true)}
                    style={{ padding: '15px', borderRadius: '8px', border: '1px dashed var(--primary)', background: 'transparent', color: 'var(--primary)', cursor: 'pointer', fontSize: '15px', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', transition: 'all 0.2s' }}
                    onMouseOver={(e) => (e.currentTarget.style.background = '#FFEBEE')}
                    onMouseOut={(e) => (e.currentTarget.style.background = 'transparent')}
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                    Добавить новый адрес
                  </button>
                </div>
              </div>

              {/* Контактные данные */}
              <div>
                <h3 style={{ fontSize: '18px', color: '#313131', marginBottom: '15px', fontWeight: 600 }}>Контактные данные</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                  <input 
                    type="text" 
                    name="customer_name" 
                    placeholder="Ваше имя" 
                    required 
                    minLength={2}
                    maxLength={120}
                    value={formData.name}
                    onChange={(e) => setFormData({...formData, name: e.target.value})}
                    style={{ fontFamily: 'inherit', width: '100%', padding: '15px', borderRadius: '8px', border: '1px solid #E8E8E8', outline: 'none', fontSize: '15px' }} 
                  />
                  <input 
                    type="tel" 
                    name="phone" 
                    placeholder="Ваш номер телефона (без +992)" 
                    required 
                    inputMode="numeric"
                    minLength={9}
                    value={displayPhone()}
                    onChange={handlePhoneChange}
                    style={{ fontFamily: 'inherit', width: '100%', padding: '15px', borderRadius: '8px', border: '1px solid #E8E8E8', outline: 'none', fontSize: '15px' }} 
                  />
                  <textarea 
                    name="comment"
                    placeholder="Комментарий к заказу (необязательно)" 
                    value={formData.comment}
                    maxLength={500}
                    onChange={(e) => setFormData({...formData, comment: e.target.value})}
                    style={{ fontFamily: 'inherit', width: '100%', padding: '15px', borderRadius: '8px', border: '1px solid #E8E8E8', outline: 'none', fontSize: '15px', minHeight: '100px', resize: 'vertical' }} 
                  />
                </div>
              </div>

              {/* Способ оплаты */}
              <div>
                <h3 style={{ fontSize: '18px', color: '#313131', marginBottom: '15px', fontWeight: 600 }}>Способ оплаты</h3>
                <div style={{ background: '#FFEBEE', borderRadius: '8px', border: '1px solid var(--primary)', overflow: 'hidden' }}>
                  <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px', cursor: 'pointer' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                      <div style={{ width: '22px', height: '22px', borderRadius: '50%', background: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                         <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'white' }}></div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <div style={{ background: 'white', padding: '5px 8px', borderRadius: '4px', border: '1px solid #ffcdd2' }}>
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth="2"><rect x="2" y="6" width="20" height="12" rx="2"></rect><circle cx="12" cy="12" r="2"></circle><path d="M6 12h.01M18 12h.01"></path></svg>
                        </div>
                        <div>
                          <div style={{ fontSize: '15px', fontWeight: 500, color: 'var(--primary)', marginBottom: '2px' }}>Наличными при получении</div>
                          <div style={{ fontSize: '13px', color: '#B71C1C' }}>Оплата курьеру при получении заказа</div>
                        </div>
                      </div>
                    </div>
                    <div style={{ width: '24px', height: '24px', borderRadius: '50%', background: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white' }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"></polyline></svg>
                    </div>
                  </label>
                </div>
              </div>

              {/* Summary Block before Submit */}
              <div style={{ border: '1px solid #E8E8E8', borderRadius: '12px', padding: '25px', marginTop: '10px' }}>
                {checkoutError && (
                  <div role="alert" style={{ marginBottom: 16, color: '#c62828', background: '#ffebee', padding: 12, borderRadius: 8 }}>
                    {checkoutError}
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '15px', fontSize: '14px', color: '#666' }}>
                  <span>Кол-во товаров</span>
                  <span style={{ fontWeight: 500, color: '#111' }}>{totalItems} шт.</span>
                </div>
                
                <div style={{ borderTop: '1px solid #F0F0F0', paddingTop: '20px', marginBottom: '25px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '15px', color: '#666' }}>Итого за товары</span>
                  <span style={{ fontSize: '24px', fontWeight: 'bold', color: '#111' }}>{totalPrice.toFixed(0)} с.</span>
                </div>

                <p style={{ margin: '0 0 20px', color: '#666', fontSize: '13px', lineHeight: 1.5 }}>
                  Стоимость доставки рассчитывается и оплачивается напрямую курьеру при доставке.
                </p>
                
                {totalPrice < 50 && (
                  <div style={{ marginBottom: '15px', color: '#c62828', background: '#ffebee', padding: '12px', borderRadius: '8px', fontSize: '13px', textAlign: 'center' }}>
                    Минимальная сумма заказа — 50 с.<br />
                    Добавьте товаров ещё на {(50 - totalPrice).toFixed(2)} с.
                  </div>
                )}
                {unavailableCount > 0 && (
                  <div style={{ marginBottom: '15px', color: '#c62828', background: '#ffebee', padding: '12px', borderRadius: '8px', fontSize: '13px', textAlign: 'center' }}>
                    В корзине есть недоступные товары: {unavailableCount}. Вернитесь в корзину и удалите их.
                  </div>
                )}
                
                <div style={{ display: 'flex', gap: '15px' }}>
                  <button 
                    type="button" 
                    onClick={() => setPhase('cart')}
                    style={{ 
                      width: '100%', 
                      padding: '16px', 
                      borderRadius: '24px',
                      background: '#eee',
                      color: '#333',
                      border: 'none',
                      fontWeight: '600',
                      fontSize: '15px',
                      cursor: 'pointer'
                    }}
                  >
                    В корзину
                  </button>
                  {totalPrice < 50 || unavailableCount > 0 ? (
                    <Link href="/"
                      style={{ 
                        width: '100%', 
                        padding: '16px', 
                        borderRadius: '24px',
                        background: 'var(--primary)',
                        color: 'white',
                        border: 'none',
                        fontWeight: '600',
                        fontSize: '15px',
                        cursor: 'pointer',
                        textAlign: 'center',
                        textDecoration: 'none'
                      }}
                    >
                      В каталог
                    </Link>
                  ) : (
                    <button 
                      type="submit" 
                      style={{ 
                        width: '100%', 
                        padding: '16px', 
                        borderRadius: '24px',
                        background: 'var(--primary)',
                        color: 'white',
                        border: 'none',
                        fontWeight: '600',
                        fontSize: '15px',
                        cursor: isSubmitting ? 'not-allowed' : 'pointer'
                      }}
                      disabled={isSubmitting}
                    >
                      {isSubmitting ? 'Оформляем...' : 'Оформить заказ'}
                    </button>
                  )}
                </div>
              </div>

            </div>
          </form>
        </div>
      )}
      
      {phase === 'success' && (
        <div className="order-success-card" style={{ maxWidth: '560px', margin: '40px auto', textAlign: 'center', background: 'white', padding: '40px', borderRadius: '16px', border: '1px solid #E8E8E8' }}>
          <div style={{ width: '80px', height: '80px', background: '#e8f5e9', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px auto' }}>
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#4CAF50" strokeWidth="2"><polyline points="20 6 9 17 4 12"></polyline></svg>
          </div>
          <h1 style={{ fontSize: '26px', fontWeight: 'bold', color: '#313131', marginBottom: '10px' }}>Заказ принят!</h1>
          {createdOrder && <p style={{ fontSize: '16px', color: '#555', marginBottom: '20px' }}>Номер заказа: <strong>{createdOrder.order_reference}</strong></p>}
          <p style={{ fontSize: '16px', color: '#444', lineHeight: '1.6', marginBottom: '14px' }}>
            Спасибо, {formData.name}. Сотрудник аптеки свяжется с вами по телефону <strong>+992 {displayPhone()}</strong>, чтобы подтвердить заказ и уточнить доставку.
          </p>
          <p style={{ fontSize: '14px', color: '#777', lineHeight: '1.5', marginBottom: '24px' }}>Пожалуйста, держите телефон доступным. Оплата производится наличными курьеру при получении.</p>
          {createdOrder && <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px', padding: '16px', marginBottom: '24px', borderRadius: '12px', background: '#f7f7f7' }}><span style={{ color: '#666' }}>Сумма товаров</span><strong>{createdOrder.order_total.toFixed(0)} с.</strong></div>}
          <div className="order-success-actions" style={{ display: 'flex', gap: '12px' }}>
            <Link href="/tracking" style={{ display: 'inline-block', flex: 1, padding: '14px', borderRadius: '24px', background: 'var(--primary)', color: 'white', textDecoration: 'none', fontWeight: '600', fontSize: '15px' }}>Посмотреть заказ</Link>
            <Link href="/" style={{ display: 'inline-block', flex: 1, padding: '14px', borderRadius: '24px', background: '#f2f2f2', color: '#333', textDecoration: 'none', fontWeight: '600', fontSize: '15px' }}>Продолжить покупки</Link>
          </div>
        </div>
      )}
      
      {/* Address Modal */}
      {isAddressModalOpen && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px' }}>
          <div style={{ background: 'white', padding: '30px', borderRadius: '16px', width: '100%', maxWidth: '400px', position: 'relative' }}>
            <button 
              onClick={() => setIsAddressModalOpen(false)} 
              style={{ position: 'absolute', top: '15px', right: '15px', background: 'none', border: 'none', cursor: 'pointer', color: '#888' }}
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
            <h2 style={{ fontSize: '20px', fontWeight: 'bold', marginBottom: '20px', color: '#313131' }}>Добавление адреса</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '13px', color: '#313131', marginBottom: '5px' }}>Адрес</label>
                <input 
                  type="text" 
                  value={newAddress.street} 
                  onChange={e => setNewAddress({...newAddress, street: e.target.value})}
                  style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid var(--primary)', outline: 'none' }} 
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '13px', color: '#313131', marginBottom: '5px' }}>Ориентир (необязательно)</label>
                <input 
                  type="text" 
                  value={newAddress.landmark} 
                  onChange={e => setNewAddress({...newAddress, landmark: e.target.value})}
                  style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid #E8E8E8', outline: 'none' }} 
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'center', marginTop: '10px' }}>
                <button 
                  onClick={handleAddAddress}
                  disabled={newAddress.street.trim().length < 5}
                  style={{ background: 'var(--primary)', color: 'white', border: 'none', padding: '12px 30px', borderRadius: '8px', fontWeight: 600, fontSize: '14px', cursor: newAddress.street.trim().length >= 5 ? 'pointer' : 'not-allowed', opacity: newAddress.street.trim().length >= 5 ? 1 : 0.5 }}
                >
                  Добавить
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
