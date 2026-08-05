'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState, useEffect } from 'react';
import './admin.css';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [activeOrdersCount, setActiveOrdersCount] = useState(0);

  useEffect(() => {
    if (pathname === '/admin/login') return;
    const fetchActiveOrders = async () => {
      try {
        const res = await fetch('/api/admin/active-orders');
        if (res.ok) {
          const data = await res.json();
          setActiveOrdersCount(data.activeCount || 0);
        }
      } catch (err) {
        console.error("Failed to fetch active orders", err);
      }
    };
    fetchActiveOrders();
    // Refresh every 30 seconds
    const interval = setInterval(fetchActiveOrders, 30000);
    return () => clearInterval(interval);
  }, [pathname]);

  // If we are on the login page, don't show the sidebar
  if (pathname === '/admin/login') {
    return <>{children}</>;
  }

  const handleLogout = async () => {
    await fetch('/api/admin/logout', { method: 'POST' });
    router.push('/admin/login');
  };

  const menu = [
    { name: 'Дашборд', path: '/admin', icon: '📊' },
    { name: 'Заказы', path: '/admin/orders', icon: '🛒' },
    { name: 'Инвентарь', path: '/admin/inventory', icon: '💊' },
    { name: 'Категории', path: '/admin/categories', icon: '📁' },
    { name: 'Баннеры', path: '/admin/banners', icon: '🖼️' },
    { name: 'Архив', path: '/admin/archive', icon: '🗄' },
    { name: 'Дубликаты', path: '/admin/duplicates', icon: '👯' },
    { name: 'История', path: '/admin/history', icon: '⏱' },
  ];

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#F5F5F7' }}>
      
      {/* Sidebar */}
      <div style={{ width: '260px', background: 'white', borderRight: '1px solid #E0E0E0', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '24px', borderBottom: '1px solid #E0E0E0' }}>
          <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 'bold', color: '#111' }}>Vatan Admin</h2>
        </div>
        
        <nav style={{ flex: 1, padding: '20px 10px', display: 'flex', flexDirection: 'column', gap: '5px' }}>
          {menu.map((item) => {
            const active = pathname === item.path;
            return (
              <Link 
                key={item.path} 
                href={item.path}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '12px 15px',
                  borderRadius: '8px',
                  textDecoration: 'none',
                  color: active ? 'var(--primary)' : '#555',
                  background: active ? '#FFEBEE' : 'transparent',
                  fontWeight: active ? 600 : 500,
                  fontSize: '15px'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <span>{item.icon}</span>
                  {item.name}
                </div>
                {item.path === '/admin/orders' && activeOrdersCount > 0 && (
                  <div style={{
                    background: 'var(--primary)',
                    color: 'white',
                    fontSize: '12px',
                    fontWeight: 'bold',
                    padding: '2px 8px',
                    borderRadius: '12px',
                    minWidth: '24px',
                    textAlign: 'center'
                  }}>
                    {activeOrdersCount}
                  </div>
                )}
              </Link>
            )
          })}
        </nav>

        <div style={{ padding: '20px', borderTop: '1px solid #E0E0E0' }}>
          <button 
            onClick={handleLogout}
            style={{ width: '100%', padding: '10px', background: 'none', border: '1px solid #ccc', borderRadius: '8px', cursor: 'pointer', fontWeight: 500, color: '#555' }}
          >
            Выйти
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div style={{ flex: 1, padding: '40px', overflowY: 'auto', maxHeight: '100vh' }}>
        {children}
      </div>

    </div>
  );
}
