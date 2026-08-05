'use client';

import { useState, useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { formatOrderNumber } from '../../lib/utils';

export default function TrackingPage() {
  const [phone, setPhone] = useState('');
  const [inputPhone, setInputPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [orders, setOrders] = useState<any[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<any>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const savedPhone = localStorage.getItem('userPhone');
    if (savedPhone) {
      setPhone(savedPhone);
      fetchOrders(savedPhone);
    }
  }, []);

  const fetchOrders = async (phoneNumber: string) => {
    if (!phoneNumber) return;
    setLoading(true);
    setError('');
    
    try {
      const res = await fetch(`/api/tracking?phone=${encodeURIComponent(phoneNumber)}`);
      if (res.ok) {
        const data = await res.json();
        setOrders(data.orders || []);
        if (data.orders && data.orders.length > 0) {
          setSelectedOrder(data.orders[0]); // Auto-select first order
        }
      } else {
        setError('Не удалось загрузить заказы.');
      }
    } catch (err) {
      setError('Ошибка при загрузке заказов.');
    } finally {
      setLoading(false);
    }
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputPhone) {
      setError('Пожалуйста, введите номер телефона');
      return;
    }
    setPhone(inputPhone);
    localStorage.setItem('userPhone', inputPhone);
    fetchOrders(inputPhone);
  };

  const renderStepper = (status: string) => {
    const steps = [
      { id: 'pending', label: 'В обработке' },
      { id: 'confirmed', label: 'Сборка' },
      { id: 'shipping', label: 'В пути' },
      { id: 'delivered', label: 'Доставлен' },
    ];
    
    let currentIndex = 0;
    if (status === 'confirmed') currentIndex = 1;
    if (status === 'shipping' || status === 'delivering') currentIndex = 2;
    if (status === 'delivered') currentIndex = 3;

    return (
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '30px 0', position: 'relative' }}>
        <div style={{ position: 'absolute', top: '15px', left: '10%', right: '10%', height: '4px', background: '#F0F0F0', zIndex: 0 }}></div>
        <div style={{ position: 'absolute', top: '15px', left: '10%', right: '10%', height: '4px', background: 'var(--primary)', zIndex: 1, width: `${(currentIndex / (steps.length - 1)) * 80}%`, transition: 'width 0.3s ease' }}></div>

        {steps.map((step, idx) => {
          const isCompleted = idx <= currentIndex;
          const isActive = idx === currentIndex;
          return (
            <div key={idx} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', zIndex: 2, width: '25%' }}>
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

  if (!mounted) return null;

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
              onChange={(e) => setInputPhone(e.target.value.replace(/\D/g, ''))}
              placeholder="Номер телефона" 
              style={{ width: '100%', padding: '16px', borderRadius: '8px', border: '1px solid #E8E8E8', outline: 'none', fontSize: '16px', marginBottom: '15px', textAlign: 'center' }}
            />
            {error && <div style={{ color: '#c62828', marginBottom: '15px', fontSize: '14px' }}>{error}</div>}
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

          <div style={{ 
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
                    {orders.map((o: any, idx) => {
                      const isActive = selectedOrder?.id === o.id;
                      const displayId = formatOrderNumber(o.phone || phone, o.id);
                      
                      return (
                        <div 
                          key={idx} 
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
                            <span style={{ fontWeight: 'bold', fontSize: '15px', color: '#313131' }}>Заказ #{displayId}</span>
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
                        Заказ #{formatOrderNumber(selectedOrder.phone || phone, selectedOrder.id)}
                      </h2>
                      <div style={{ color: '#888', fontSize: '14px' }}>
                        Оформлен: {new Date(selectedOrder.created_at).toLocaleString('ru-RU')}
                      </div>
                    </div>
                  </div>
                  
                  {renderStepper(selectedOrder.status)}

                  <div style={{ background: '#F9F9F9', padding: '20px', borderRadius: '12px', marginBottom: '25px', display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '14px' }}>
                    <div style={{ display: 'flex' }}><span style={{ color: '#888', width: '140px' }}>Получатель:</span> <span style={{ fontWeight: 500, color: '#313131' }}>{selectedOrder.customer_name}</span></div>
                    <div style={{ display: 'flex' }}><span style={{ color: '#888', width: '140px' }}>Телефон:</span> <span style={{ fontWeight: 500, color: '#313131' }}>{selectedOrder.phone}</span></div>
                    <div style={{ display: 'flex' }}><span style={{ color: '#888', width: '140px' }}>Адрес:</span> <span style={{ fontWeight: 500, color: '#313131' }}>{selectedOrder.address}</span></div>
                    {selectedOrder.comment && (
                      <div style={{ display: 'flex' }}><span style={{ color: '#888', width: '140px' }}>Комментарий:</span> <span style={{ fontWeight: 500, color: '#313131' }}>{selectedOrder.comment}</span></div>
                    )}
                  </div>

                  <h3 style={{ fontSize: '18px', marginBottom: '15px', fontWeight: 600, color: '#313131' }}>Состав заказа</h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '25px' }}>
                    {(selectedOrder.items || []).map((item: any, idx: number) => (
                      <div key={idx} style={{ display: 'flex', gap: '15px', alignItems: 'center', borderBottom: '1px solid #F0F0F0', paddingBottom: '15px' }}>
                        <div style={{ width: '60px', height: '60px', background: 'white', border: '1px solid #E8E8E8', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#ddd" strokeWidth="1.5"><rect x="7" y="7" width="10" height="14" rx="2" ry="2"></rect><path d="M5 7h14"></path><path d="M12 11v4"></path><path d="M10 13h4"></path><path d="M9 3h6v4H9z"></path></svg>
                        </div>
                        <div style={{ flex: 1 }}>
                          <a href={`/medicine/${encodeURIComponent(item.medicine_name || item.name)}`} style={{ fontWeight: '500', color: '#313131', textDecoration: 'none', display: 'block', marginBottom: '5px' }}>
                            {item.medicine_name || item.name}
                          </a>
                          <div style={{ fontSize: '13px', color: '#888' }}>{item.quantity} шт.</div>
                        </div>
                        <div style={{ fontWeight: 'bold', fontSize: '15px', color: '#111' }}>{((item.quantity || 1) * (item.price || 0)).toFixed(2)} с.</div>
                      </div>
                    ))}
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: '15px' }}>
                    <div style={{ textAlign: 'right', minWidth: '200px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px', color: '#666', marginBottom: '10px' }}>
                        <span>Сумма товаров:</span>
                        <span style={{ fontWeight: 500, color: '#111' }}>{Number(selectedOrder.total_price || 0).toFixed(2)} с.</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px', color: '#666', marginBottom: '15px' }}>
                        <span>Доставка:</span>
                        <span style={{ fontWeight: 500, color: '#111' }}>30.00 с.</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '16px', color: '#313131', fontWeight: 'bold', borderTop: '1px solid #F0F0F0', paddingTop: '15px' }}>
                        <span>Итого:</span>
                        <span style={{ color: 'var(--primary)', fontSize: '20px' }}>{(Number(selectedOrder.total_price || 0) + 30).toFixed(2)} с.</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      <style dangerouslySetInnerHTML={{__html: `
        @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
        @media (max-width: 768px) {
          .container > div { grid-template-columns: 1fr !important; }
        }
      `}} />
    </div>
  );
}
