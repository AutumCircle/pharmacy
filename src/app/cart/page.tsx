'use client';

import { useState, useEffect } from 'react';
import { useCart } from '../../context/CartContext';
import Link from 'next/link';

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
  
  const [addresses, setAddresses] = useState<string[]>([]);
  const [isAddressModalOpen, setIsAddressModalOpen] = useState(false);
  const [newAddress, setNewAddress] = useState({ street: '', landmark: '' });

  useEffect(() => {
    const saved = localStorage.getItem('vatan_customer');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setFormData(prev => ({
          ...prev,
          name: parsed.name || '',
          phone: parsed.phone || '',
          address: parsed.address || ''
        }));
      } catch (e) {}
    }
    
    const savedAddresses = localStorage.getItem('vatan_addresses');
    if (savedAddresses) {
      try {
        setAddresses(JSON.parse(savedAddresses));
      } catch (e) {}
    } else {
      setAddresses(['г. Душанбе, ул. Айни 24']);
    }
  }, []);

  const deliveryCost = 30;
  const finalTotal = totalPrice + deliveryCost;

  // Formatting phone: XXX-XX-XX-XX
  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let val = e.target.value.replace(/\D/g, '').substring(0, 9);
    setFormData({ ...formData, phone: val });
  };

  const displayPhone = () => {
    let val = formData.phone;
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

  const handleAddressSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
    if (e.target.value === 'ADD_NEW') {
      setIsAddressModalOpen(true);
      // Reset select back to what it was, or keep it on the previous value
      e.target.value = formData.address || "";
    } else {
      setFormData({ ...formData, address: e.target.value });
    }
  };

  const handleCheckoutSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsSubmitting(true);
    
    // Save customer info for future
    localStorage.setItem('vatan_customer', JSON.stringify(formData));
    
    try {
      const formDataToSend = new FormData();
      formDataToSend.append('customer_name', formData.name);
      formDataToSend.append('phone', formData.phone);
      formDataToSend.append('address', formData.address);
      formDataToSend.append('comment', formData.comment);
      formDataToSend.append('items', JSON.stringify(items));
      formDataToSend.append('total', totalPrice.toString());
      
      const res = await fetch('/api/checkout', {
        method: 'POST',
        body: formDataToSend
      });
      
      if (res.ok) {
        // Save just the phone for tracking purposes globally
        localStorage.setItem('userPhone', formData.phone);
        
        clearCart();
        window.location.href = '/tracking';
      } else {
        window.location.href = '/cart?error=checkout_failed';
      }
    } catch (err) {
      window.location.href = '/cart?error=checkout_failed';
    }
  };

  if (items.length === 0) {
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
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: '40px', alignItems: 'start' }}>
            {/* Left: Cart Items */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>
              {items.map((item, index) => (
                <div key={index} style={{ display: 'flex', gap: '20px', padding: '25px 0', borderBottom: '1px solid #F0F0F0' }}>
                  <div style={{ width: '80px', height: '80px', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid #E8E8E8', borderRadius: '8px' }}>
                    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#ccc" strokeWidth="1.5"><rect x="7" y="7" width="10" height="14" rx="2" ry="2"></rect><path d="M5 7h14"></path><path d="M12 11v4"></path><path d="M10 13h4"></path><path d="M9 3h6v4H9z"></path></svg>
                  </div>
                  <div style={{ flex: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontWeight: 'bold', fontSize: '18px', color: '#111', marginBottom: '4px' }}>{item.price.toFixed(0)} с.</div>
                      <div style={{ fontSize: '15px', color: '#333', fontWeight: 500, marginBottom: '4px' }}>{item.name}</div>
                      <div style={{ fontSize: '13px', color: '#888', marginBottom: '4px' }}>{item.country || 'Индия'}, {item.vendor || 'Не указан'}</div>
                      <div style={{ fontSize: '13px', color: '#4CAF50', fontWeight: 500 }}>В наличии</div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '10px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', background: '#F5F5F7', borderRadius: '24px', padding: '6px' }}>
                          <button onClick={() => updateQuantity(item.name, item.quantity - 1)} style={{ background: 'white', border: 'none', width: '32px', height: '32px', borderRadius: '50%', cursor: 'pointer', fontSize: '18px', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>−</button>
                          <span style={{ fontWeight: '600', fontSize: '15px', width: '32px', textAlign: 'center' }}>{item.quantity}</span>
                          <button onClick={() => updateQuantity(item.name, item.quantity + 1)} style={{ background: 'white', border: 'none', width: '32px', height: '32px', borderRadius: '50%', cursor: 'pointer', fontSize: '18px', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>+</button>
                        </div>
                        <button onClick={() => removeItem(item.name)} style={{ background: '#fff', border: '1px solid #ffcdd2', color: '#d32f2f', width: '36px', height: '36px', borderRadius: '50%', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}>
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
                style={{ 
                  width: '100%', 
                  padding: '16px', 
                  borderRadius: '24px',
                  background: 'var(--primary)', // Made red as requested
                  color: 'white',
                  border: 'none',
                  fontWeight: '600',
                  fontSize: '15px',
                  cursor: 'pointer'
                }}
              >
                Перейти к оформлению
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
                    <div key={index} style={{ display: 'flex', gap: '15px', padding: '15px 20px', borderBottom: index < items.length - 1 ? '1px solid #F0F0F0' : 'none', alignItems: 'center' }}>
                      <div style={{ width: '40px', height: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid #E8E8E8', borderRadius: '8px' }}>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ccc" strokeWidth="1.5"><rect x="7" y="7" width="10" height="14" rx="2" ry="2"></rect><path d="M5 7h14"></path><path d="M12 11v4"></path><path d="M10 13h4"></path><path d="M9 3h6v4H9z"></path></svg>
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: '14px', color: '#313131', fontWeight: 500 }}>{item.name}</div>
                        <div style={{ fontWeight: 'bold', fontSize: '14px', color: '#111', marginTop: '2px' }}>{item.price.toFixed(0)} с.</div>
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
                    value={formData.name}
                    onChange={(e) => setFormData({...formData, name: e.target.value})}
                    style={{ fontFamily: 'inherit', width: '100%', padding: '15px', borderRadius: '8px', border: '1px solid #E8E8E8', outline: 'none', fontSize: '15px' }} 
                  />
                  <input 
                    type="tel" 
                    name="phone" 
                    placeholder="Ваш номер телефона (без +992)" 
                    required 
                    value={displayPhone()}
                    onChange={handlePhoneChange}
                    style={{ fontFamily: 'inherit', width: '100%', padding: '15px', borderRadius: '8px', border: '1px solid #E8E8E8', outline: 'none', fontSize: '15px' }} 
                  />
                  <textarea 
                    name="comment"
                    placeholder="Комментарий к заказу (необязательно)" 
                    value={formData.comment}
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
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '15px', fontSize: '14px', color: '#666' }}>
                  <span>Кол-во товаров</span>
                  <span style={{ fontWeight: 500, color: '#111' }}>{totalItems} шт.</span>
                </div>
                
                <div style={{ borderTop: '1px solid #F0F0F0', paddingTop: '20px', marginBottom: '25px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '15px', color: '#666' }}>Итого за товары</span>
                  <span style={{ fontSize: '24px', fontWeight: 'bold', color: '#111' }}>{totalPrice.toFixed(0)} с.</span>
                </div>

                <input type="hidden" name="items" value={JSON.stringify(items)} />
                <input type="hidden" name="total" value={totalPrice} />
                
                {totalPrice < 50 && (
                  <div style={{ marginBottom: '15px', color: '#c62828', background: '#ffebee', padding: '12px', borderRadius: '8px', fontSize: '13px', textAlign: 'center' }}>
                    Минимальная сумма заказа — 50 с.<br />
                    Добавьте товаров ещё на {(50 - totalPrice).toFixed(2)} с.
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
                  {totalPrice < 50 ? (
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
        <div style={{ maxWidth: '500px', margin: '40px auto', textAlign: 'center', background: 'white', padding: '40px', borderRadius: '16px', border: '1px solid #E8E8E8' }}>
          <div style={{ width: '80px', height: '80px', background: '#e8f5e9', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px auto' }}>
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#4CAF50" strokeWidth="2"><polyline points="20 6 9 17 4 12"></polyline></svg>
          </div>
          <h2 style={{ fontSize: '24px', fontWeight: 'bold', color: '#313131', marginBottom: '15px' }}>Спасибо за заказ!</h2>
          <p style={{ fontSize: '16px', color: '#666', lineHeight: '1.5', marginBottom: '30px' }}>
            Мы позвоним вам по номеру <strong>{displayPhone()}</strong> для подтверждения заказа, и после этого начнется процесс доставки.
          </p>
          <Link href="/tracking" style={{ display: 'inline-block', width: '100%', padding: '16px', borderRadius: '24px', background: 'var(--primary)', color: 'white', textDecoration: 'none', fontWeight: '600', fontSize: '15px' }}>
            Отследить мои заказы
          </Link>
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
                  disabled={!newAddress.street}
                  style={{ background: 'var(--primary)', color: 'white', border: 'none', padding: '12px 30px', borderRadius: '8px', fontWeight: 600, fontSize: '14px', cursor: newAddress.street ? 'pointer' : 'not-allowed', opacity: newAddress.street ? 1 : 0.5 }}
                >
                  Добавить
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <style dangerouslySetInnerHTML={{__html: `
        @media (max-width: 768px) {
          form > div, .container > div { grid-template-columns: 1fr !important; }
        }
      `}} />
    </div>
  );
}
