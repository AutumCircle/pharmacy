'use client';

import { useState } from 'react';
import { updateOrderStatus, deleteAllOrders } from './actions';
import { formatOrderNumber } from '../../../lib/utils';

const statusColors: any = {
  'pending': '#fbc02d',
  'confirmed': '#29b6f6',
  'delivering': '#0288d1',
  'delivered': '#388e3c',
  'cancelled': '#d32f2f'
};

const statusLabels: any = {
  'pending': 'Новый',
  'confirmed': 'Подтвержден',
  'delivering': 'В пути',
  'delivered': 'Доставлен',
  'cancelled': 'Отменен'
};

export default function OrderList({ initialOrders }: { initialOrders: any[] }) {
  const [filter, setFilter] = useState('all');
  const [loadingId, setLoadingId] = useState<string | null>(null);

  const updateStatus = async (id: string, newStatus: string) => {
    setLoadingId(id);
    await updateOrderStatus(id, newStatus);
    setLoadingId(null);
  };

  // Optional: fallback if initialOrders is undefined
  const orders = initialOrders || [];
  
  const filteredOrders = filter === 'all' ? orders : orders.filter((o: any) => o.status === filter);

  const handleDeleteAll = async () => {
    if (confirm("Вы уверены, что хотите удалить ВСЕ заказы? Это действие нельзя отменить.")) {
      setLoadingId('delete_all');
      await deleteAllOrders();
      setLoadingId(null);
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: '10px', marginBottom: '30px', flexWrap: 'wrap', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <button onClick={() => setFilter('all')} style={{ padding: '8px 16px', borderRadius: '20px', border: '1px solid #ccc', background: filter === 'all' ? '#e0e0e0' : 'white', cursor: 'pointer' }}>Все</button>
          {Object.keys(statusLabels).map(k => (
            <button key={k} onClick={() => setFilter(k)} style={{ padding: '8px 16px', borderRadius: '20px', border: '1px solid #ccc', background: filter === k ? statusColors[k] : 'white', color: filter === k ? 'white' : '#333', cursor: 'pointer' }}>
              {statusLabels[k]}
            </button>
          ))}
        </div>
        <button 
          onClick={handleDeleteAll}
          disabled={loadingId === 'delete_all'}
          style={{ padding: '8px 16px', borderRadius: '6px', border: 'none', background: '#d32f2f', color: 'white', cursor: 'pointer', fontWeight: 'bold' }}
        >
          {loadingId === 'delete_all' ? 'Удаление...' : 'Очистить все заказы'}
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        {filteredOrders.length === 0 ? (
          <div style={{ padding: '40px', textAlign: 'center', color: '#888', background: 'white', borderRadius: '12px' }}>Заказов нет</div>
        ) : (
          filteredOrders.map((order: any) => {
            const safeItems = order.items || [];
            const totalBase = safeItems.reduce((acc: number, item: any) => acc + (Number(item.basePrice || item.price || 0) * Number(item.quantity || 1)), 0);
            const totalSell = safeItems.reduce((acc: number, item: any) => acc + (Number(item.sellPrice || item.price || 0) * Number(item.quantity || 1)), 0);
            const isUpdating = loadingId === order.id;

            return (
              <div key={order.id} style={{ background: 'white', padding: '20px', borderRadius: '12px', border: '1px solid #E8E8E8', boxShadow: '0 2px 10px rgba(0,0,0,0.02)', opacity: isUpdating ? 0.6 : 1 }}>
                
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #F0F0F0', paddingBottom: '15px', marginBottom: '15px' }}>
                  <div>
                    <h3 style={{ margin: '0 0 5px 0', fontSize: '18px' }}>Заказ #{formatOrderNumber(order.phone, order.id)}</h3>
                    <div style={{ color: '#333', fontSize: '14px', fontWeight: 500, marginBottom: '4px' }}>
                      {new Date(order.created_at || Date.now()).toLocaleString('ru-RU')} | {order.customer_name || 'Неизвестно'} ({order.phone || '-'})
                    </div>
                    {order.address && (
                      <div style={{ color: '#555', fontSize: '13px', marginBottom: '2px' }}>
                        <strong>Адрес:</strong> {order.address}
                      </div>
                    )}
                    {order.comment && (
                      <div style={{ color: '#e65100', fontSize: '13px', background: '#fff3e0', padding: '4px 8px', borderRadius: '4px', display: 'inline-block', marginTop: '4px' }}>
                        <strong>Комментарий:</strong> {order.comment}
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                    <span style={{ padding: '5px 12px', borderRadius: '20px', fontSize: '12px', fontWeight: 'bold', color: 'white', background: statusColors[order.status] || '#ccc' }}>
                      {statusLabels[order.status] || order.status}
                    </span>
                    
                    <select 
                      value={order.status}
                      onChange={(e) => updateStatus(order.id, e.target.value)}
                      disabled={isUpdating}
                      style={{ padding: '8px', borderRadius: '8px', border: '1px solid #ccc', outline: 'none' }}
                    >
                      {Object.keys(statusLabels).map(k => (
                        <option key={k} value={k}>{statusLabels[k]}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
                    <thead>
                      <tr style={{ color: '#888', textAlign: 'left', borderBottom: '1px solid #F0F0F0' }}>
                        <th style={{ padding: '10px 0' }}>Название</th>
                        <th style={{ padding: '10px 0' }}>Кол-во</th>
                        <th style={{ padding: '10px 0', textAlign: 'right' }}>База (в аптеку)</th>
                        <th style={{ padding: '10px 0', textAlign: 'right' }}>Клиенту</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(order.items || []).map((item: any, idx: number) => {
                        const bPrice = Number(item.basePrice || item.price) || 0;
                        const sPrice = Number(item.sellPrice || item.price) || 0;
                        const mName = item.medicine_name || item.name || 'Неизвестный препарат';
                        
                        return (
                          <tr key={idx} style={{ borderBottom: '1px solid #F0F0F0' }}>
                            <td style={{ padding: '10px 0', color: '#333' }}>{mName}</td>
                            <td style={{ padding: '10px 0' }}>{item.quantity} шт.</td>
                            <td style={{ padding: '10px 0', textAlign: 'right', color: '#888' }}>{bPrice.toFixed(2)} с.</td>
                            <td style={{ padding: '10px 0', textAlign: 'right', fontWeight: 'bold' }}>{sPrice.toFixed(2)} с.</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '15px', gap: '30px' }}>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '12px', color: '#888' }}>Сумма заказа</div>
                    <div style={{ fontWeight: 'bold', fontSize: '18px', color: 'var(--primary)' }}>
                      {totalSell.toFixed(2)} с.
                    </div>
                  </div>
                </div>

              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
