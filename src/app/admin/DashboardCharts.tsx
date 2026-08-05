'use client';

import { useState } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  Legend
} from 'recharts';

export default function DashboardCharts({ orders }: { orders: any[] }) {
  const [activeTab, setActiveTab] = useState<'revenue' | 'volume'>('revenue');

  // Process orders into daily aggregated data
  const dailyDataMap: Record<string, { date: string; revenue: number; orders: number }> = {};
  
  // Initialize last 7 days
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
    dailyDataMap[dateStr] = { date: dateStr, revenue: 0, orders: 0 };
  }

  orders.forEach((o: any) => {
    if (o.status === 'cancelled') return;
    const oDate = new Date(o.created_at || o.date);
    const dateStr = oDate.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
    
    if (dailyDataMap[dateStr]) {
      const safeItems = o.items || [];
      let orderTotal = 0;
      if (safeItems.length > 0) {
        orderTotal = safeItems.reduce((acc: number, item: any) => {
          const p = Number(item.sellPrice || item.price || 0);
          return acc + (p * Number(item.quantity || 1));
        }, 0);
      } else {
        orderTotal = Number(o.total_price || 0);
      }
      dailyDataMap[dateStr].revenue += orderTotal;
      dailyDataMap[dateStr].orders += 1;
    }
  });

  const data = Object.values(dailyDataMap);

  return (
    <div style={{ background: 'white', padding: '24px', borderRadius: '12px', border: '1px solid #E8E8E8', boxShadow: '0 2px 10px rgba(0,0,0,0.02)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <h3 style={{ fontSize: '18px', fontWeight: 'bold', margin: 0 }}>Финансы и Аналитика (7 дней)</h3>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button 
            onClick={() => setActiveTab('revenue')}
            style={{ padding: '6px 12px', borderRadius: '20px', border: '1px solid var(--primary)', background: activeTab === 'revenue' ? 'var(--primary)' : 'white', color: activeTab === 'revenue' ? 'white' : 'var(--primary)', cursor: 'pointer', fontSize: '13px', fontWeight: 'bold' }}
          >
            Выручка
          </button>
          <button 
            onClick={() => setActiveTab('volume')}
            style={{ padding: '6px 12px', borderRadius: '20px', border: '1px solid #0288d1', background: activeTab === 'volume' ? '#0288d1' : 'white', color: activeTab === 'volume' ? 'white' : '#0288d1', cursor: 'pointer', fontSize: '13px', fontWeight: 'bold' }}
          >
            Заказы
          </button>
        </div>
      </div>

      <div style={{ height: '300px', width: '100%' }}>
        <ResponsiveContainer width="100%" height="100%">
          {activeTab === 'revenue' ? (
            <BarChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eee" />
              <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#888' }} dy={10} />
              <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#888' }} />
              <Tooltip 
                cursor={{ fill: '#f5f5f5' }}
                contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                formatter={(value: number) => [`${value.toFixed(2)} с.`, 'Выручка']}
              />
              <Bar dataKey="revenue" fill="var(--primary)" radius={[4, 4, 0, 0]} maxBarSize={50} />
            </BarChart>
          ) : (
            <LineChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eee" />
              <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#888' }} dy={10} />
              <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#888' }} />
              <Tooltip 
                contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                formatter={(value: number) => [value, 'Кол-во заказов']}
              />
              <Line type="monotone" dataKey="orders" stroke="#0288d1" strokeWidth={3} activeDot={{ r: 6 }} />
            </LineChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
}
