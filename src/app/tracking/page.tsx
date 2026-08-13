'use client';

import { useState, useEffect, useCallback } from 'react';
import type { PublicOrder } from '@/lib/api-v1/types';
import { trackOrdersClient } from '@/lib/api-v1/client-reads';
import { parseTrackingPhone, TRACKING_PHONE_ERROR } from '@/lib/tracking-phone';

export default function TrackingPage() {
  const [phone, setPhone] = useState('');
  const [inputPhone, setInputPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [inputRejected, setInputRejected] = useState(false);
  const [orders, setOrders] = useState<PublicOrder[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<PublicOrder | null>(null);
  const fetchOrders = useCallback(async (phoneNumber: string, force = false) => {
    if (!phoneNumber) return;
    setLoading(true);
    setError('');
    
    try {
      const data = await trackOrdersClient(phoneNumber, force);
      setOrders(data.data || []);
      if (data.data && data.data.length > 0) {
        setSelectedOrder(data.data[0]);
      }
    } catch {
      setError('Ошибка при загрузке заказов.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const savedPhone = localStorage.getItem('userPhone');
      if (savedPhone) {
        const parsed = parseTrackingPhone(savedPhone);
        if (parsed.valid && parsed.normalized) {
          setPhone(parsed.formatted);
          void fetchOrders(parsed.normalized);
        } else {
          localStorage.removeItem('userPhone');
        }
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [fetchOrders]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = parseTrackingPhone(inputPhone);
    if (inputRejected || !parsed.valid || !parsed.normalized) {
      setError(parsed.error || TRACKING_PHONE_ERROR);
      return;
    }
    setPhone(parsed.formatted);
    localStorage.setItem('userPhone', parsed.formatted);
    void fetchOrders(parsed.normalized, true);
  };

  const renderStepper = (status: string) => {
    if (status === 'cancelled') {
      return (
        <div style={{ margin: '30px 0', padding: '16px', borderRadius: '10px', background: '#ffebee', color: '#c62828', fontWeight: 600 }}>
          Заказ отменён
        </div>
      );
    }
    const steps = [
      { id: 'pending', label: 'В обработке' },
      { id: 'confirmed', label: 'Сборка' },
      { id: 'delivering', label: 'В пути' },
      { id: 'delivered', label: 'Доставлен' },
    ];
    
    let currentIndex = 0;
    if (status === 'confirmed') currentIndex = 1;
    if (status === 'delivering') currentIndex = 2;
    if (status === 'delivered') currentIndex = 3;

    return (
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '30px 0', position: 'relative' }}>
        <div style={{ position: 'absolute', top: '15px', left: '10%', right: '10%', height: '4px', background: '#F0F0F0', zIndex: 0 }}></div>
        <div style={{ position: 'absolute', top: '15px', left: '10%', right: '10%', height: '4px', background: 'var(--primary)', zIndex: 1, width: `${(currentIndex / (steps.length - 1)) * 80}%`, transition: 'width 0.3s ease' }}></div>

        {steps.map((step, idx) => {
          const isCompleted = idx <= currentIndex;
          const isActive = idx === currentIndex;
          return (
            <div key={step.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', zIndex: 2, width: '25%' }}>
              <div style={{ 
                width: '34px', height: '34px', borderRadius: '50%', 
                background: isCompleted ? 'var(--primary)' : '#fff', 
                border: isCompleted ? 'none' : '3px solid #F0F0F0',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'white', fontWeight: 'bold', marginBottom: '8px',
                boxShadow: isActive ? '0 0 0 4px rgba(227, 30, 36, 0.2)' : 'none'
              }}>
                {isCompleted ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"></polyline></svg> : (idx + 1)}
              </div>
              <div style={{ fontSize: '13px', fontWeight: isCompleted ? '600' : '400', color: isCompleted ? '#333' : '#999', textAlign: 'center' }}>
                {step.label}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="container" style={{ paddingTop: '40px', paddingBottom: '60px' }}>
      
      {!phone ? (
        // Clean Search Bar if no phone in localStorage
        <div style={{ maxWidth: '500px', margin: '40px auto', textAlign: 'center', background: 'white', padding: '40px', borderRadius: '16px', border: '1px solid #E8E8E8' }}>
          <h1 className="section-title" style={{ fontSize: '24px', fontWeight: 'bold', marginBottom: '15px', color: '#313131' }}>Отследить заказы</h1>
          <p style={{ fontSize: '15px', color: '#666', marginBottom: '30px' }}>Введите номер телефона, который вы указывали при оформлении заказа.</p>
          
          <form onSubmit={handleSearchSubmit}>
            <input 
              type="tel" 
              value={inputPhone}
              onChange={(e) => {
                const parsed = parseTrackingPhone(e.target.value);
                const rejected = parsed.localDigits.length > 9 || parsed.error !== null && parsed.error !== TRACKING_PHONE_ERROR;
                setInputPhone(parsed.formatted);
                setInputRejected(rejected);
                setError(rejected ? (parsed.error || TRACKING_PHONE_ERROR) : '');
              }}
              inputMode="numeric"
              autoComplete="tel-national"
              maxLength={12}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? 'tracking-phone-error' : undefined}
              placeholder="Номер телефона" 
              style={{ width: '100%', padding: '16px', borderRadius: '8px', border: '1px solid #E8E8E8', outline: 'none', fontSize: '16px', marginBottom: '15px', textAlign: 'center' }}
            />
            {error && <div id="tracking-phone-error" role="alert" style={{ color: '#c62828', marginBottom: '15px', fontSize: '14px' }}>{error}</div>}
            <button 
              type="submit" 
              style={{ width: '100%', padding: '16px', borderRadius: '24px', fontSize: '16px', background: 'var(--primary)', color: 'white', border: 'none', cursor: 'pointer', fontWeight: 600, display: 'flex', justifyContent: 'center' }}
              disabled={loading}
            >
              {loading ? <span className="spinner" style={{ width: '16px', height: '16px', border: '2px solid white', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite' }}></span> : 'Найти заказы'}
            </button>
          </form>
        </div>
      ) : (
        // Tracking Interface
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '30px' }}>
            <h1 className="section-title" style={{ margin: 0, fontSize: '28px', color: '#313131' }}>Мои заказы</h1>
            <button 
              onClick={() => { setPhone(''); setOrders([]); setSelectedOrder(null); localStorage.removeItem('userPhone'); }} 
              style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', textDecoration: 'underline', fontSize: '14px' }}
            >
              Сменить номер телефона
            </button>
          </div>

          <div className="tracking-layout" style={{
            display: 'grid',
            gridTemplateColumns: '1fr 2fr',
            gap: '30px',
            alignItems: 'start'
          }}>
            
            {/* Left Sidebar: List of Orders */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div style={{ background: 'white', padding: '25px', borderRadius: '12px', border: '1px solid #E8E8E8' }}>
                <h3 style={{ fontSize: '18px', margin: '0 0 15px 0', fontWeight: 600 }}>Список заказов</h3>
                
                {loading ? (
                  <div style={{ textAlign: 'center', padding: '20px', color: '#888' }}>Загрузка...</div>
                ) : orders.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '20px', color: '#888' }}>У вас пока нет заказов</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {orders.map((o) => {
                      const isActive = selectedOrder?.order_id === o.order_id;
                      return (
                        <div 
                          key={o.order_id}
                          onClick={() => setSelectedOrder(o)}
                          style={{ 
                            padding: '15px', 
                            borderRadius: '10px', 
                            border: isActive ? '2px solid var(--primary)' : '1px solid #E8E8E8', 
                            cursor: 'pointer',
                            background: isActive ? '#FFEBEE' : 'transparent',
                            transition: 'all 0.2s'
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                            <span style={{ fontWeight: 'bold', fontSize: '15px', color: '#313131' }}>Заказ #{o.order_reference}</span>
                            <span style={{ fontSize: '12px', color: '#888' }}>{new Date(o.created_at).toLocaleDateString('ru-RU')}</span>
                          </div>
                          <div style={{ fontSize: '13px', color: isActive ? 'var(--primary)' : '#666', display: 'flex', alignItems: 'center', gap: '5px' }}>
                            Смотреть детали <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"></polyline></svg>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Right Main Area: Order Details */}
            <div style={{ background: 'white', padding: '30px', borderRadius: '12px', border: '1px solid #E8E8E8', minHeight: '500px' }}>
              {!selectedOrder ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#999' }}>
                  <p>{orders.length === 0 ? 'Нет доступных заказов' : 'Выберите заказ из списка слева'}</p>
                </div>
              ) : (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #eee', paddingBottom: '20px', marginBottom: '20px' }}>
                    <div>
                      <h2 style={{ margin: '0 0 5px 0', fontSize: '24px', color: '#313131' }}>
                        Заказ #{selectedOrder.order_reference}
                      </h2>
                      <div style={{ color: '#888', fontSize: '14px' }}>
                        Оформлен: {new Date(selectedOrder.created_at).toLocaleString('ru-RU')}
                      </div>
                    </div>
                  </div>
                  
                  {renderStepper(selectedOrder.status)}

                  <h3 style={{ fontSize: '18px', marginBottom: '15px', fontWeight: 600, color: '#313131' }}>Состав заказа</h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '25px' }}>
                    {selectedOrder.items.map((item, index) => (
                      <div key={`${item.medicine_id ?? 'legacy'}-${index}`} style={{ display: 'flex', gap: '15px', alignItems: 'center', borderBottom: '1px solid #F0F0F0', paddingBottom: '15px' }}>
                        <div style={{ width: '60px', height: '60px', background: 'white', border: '1px solid #E8E8E8', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#ddd" strokeWidth="1.5"><rect x="7" y="7" width="10" height="14" rx="2" ry="2"></rect><path d="M5 7h14"></path><path d="M12 11v4"></path><path d="M10 13h4"></path><path d="M9 3h6v4H9z"></path></svg>
                        </div>
                        <div style={{ flex: 1 }}>
                          {item.medicine_id == null ? (
                            <span style={{ fontWeight: '500', color: '#313131', display: 'block', marginBottom: '5px' }}>
                              {item.medicine_name}
                            </span>
                          ) : (
                            <a href={`/medicine/${item.medicine_id}`} style={{ fontWeight: '500', color: '#313131', textDecoration: 'none', display: 'block', marginBottom: '5px' }}>
                              {item.medicine_name}
                            </a>
                          )}
                          <div style={{ fontSize: '13px', color: '#888' }}>{item.quantity} шт.</div>
                        </div>
                        <div style={{ fontWeight: 'bold', fontSize: '15px', color: '#111' }}>{item.line_total.toFixed(0)} с.</div>
                      </div>
                    ))}
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: '15px' }}>
                    <div style={{ textAlign: 'right', minWidth: '200px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px', color: '#666', marginBottom: '10px' }}>
                        <span>Сумма товаров:</span>
                        <span style={{ fontWeight: 500, color: '#111' }}>{selectedOrder.items_subtotal.toFixed(0)} с.</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '16px', color: '#313131', fontWeight: 'bold', borderTop: '1px solid #F0F0F0', paddingTop: '15px' }}>
                        <span>Итого:</span>
                        <span style={{ color: 'var(--primary)', fontSize: '20px' }}>{selectedOrder.order_total.toFixed(0)} с.</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      )}

    </div>
  );
}
