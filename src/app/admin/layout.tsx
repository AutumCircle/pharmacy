'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { readSidebarCollapsed, writeSidebarCollapsed } from '@/lib/admin-sidebar';
import './admin.css';

const menu = [
  { name: 'Панель управления', path: '/admin', icon: '⌂' },
  { name: 'Лекарства', path: '/admin/medicines', icon: '✚' },
  { name: 'Дубликаты', path: '/admin/duplicates', icon: '≡' },
  { name: 'Заказы', path: '/admin/orders', icon: '◉' },
  { name: 'Категории', path: '/admin/categories', icon: '▣' },
  { name: 'Цены', path: '/admin/pricing', icon: '%' },
  { name: 'Баннеры', path: '/admin/banners', icon: '▧' },
  { name: 'Карусели', path: '/admin/carousels', icon: '★' },
  { name: 'Синхронизации', path: '/admin/history', icon: '↻' },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [activeOrdersCount, setActiveOrdersCount] = useState(0);
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setCollapsed(readSidebarCollapsed(window.localStorage));
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setMobileOpen(false));
    if (pathname === '/admin/login') return () => window.cancelAnimationFrame(frame);
    const fetchActiveOrders = async () => {
      try {
        const response = await fetch('/api/admin/active-orders');
        if (response.ok) {
          const data = await response.json();
          setActiveOrdersCount(data.activeCount || 0);
        }
      } catch (error) {
        console.error('Failed to fetch active orders', error);
      }
    };
    fetchActiveOrders();
    const interval = setInterval(fetchActiveOrders, 30_000);
    return () => {
      window.cancelAnimationFrame(frame);
      clearInterval(interval);
    };
  }, [pathname]);

  if (pathname === '/admin/login') return <>{children}</>;

  const toggleCollapsed = () => {
    setCollapsed((current) => {
      const next = !current;
      writeSidebarCollapsed(window.localStorage, next);
      return next;
    });
  };

  const handleLogout = async () => {
    await fetch('/api/admin/logout', { method: 'POST' });
    router.push('/admin/login');
  };

  return (
    <div className={`admin-shell${collapsed ? ' sidebar-collapsed' : ''}${mobileOpen ? ' mobile-sidebar-open' : ''}`}>
      <button
        className="admin-mobile-menu-button"
        type="button"
        aria-label={mobileOpen ? 'Закрыть меню администратора' : 'Открыть меню администратора'}
        aria-expanded={mobileOpen}
        onClick={() => setMobileOpen((current) => !current)}
      >
        {mobileOpen ? '×' : '☰'}
      </button>
      {mobileOpen && <button className="admin-sidebar-backdrop" aria-label="Закрыть меню" onClick={() => setMobileOpen(false)} />}
      <aside className="admin-sidebar">
        <div className="admin-sidebar-brand">
          <strong className="admin-sidebar-label">Vatan Admin</strong>
          <button
            className="admin-sidebar-toggle"
            type="button"
            aria-label={collapsed ? 'Развернуть боковое меню' : 'Свернуть боковое меню'}
            aria-expanded={!collapsed}
            onClick={toggleCollapsed}
          >
            {collapsed ? '›' : '‹'}
          </button>
        </div>
        <nav className="admin-sidebar-nav" aria-label="Навигация панели администратора">
          {menu.map((item) => {
            const active = item.path === '/admin' ? pathname === '/admin' : pathname.startsWith(item.path);
            return (
              <Link
                key={item.path}
                href={item.path}
                className={`admin-sidebar-link${active ? ' active' : ''}`}
                aria-current={active ? 'page' : undefined}
                title={collapsed ? item.name : undefined}
              >
                <span className="admin-sidebar-icon" aria-hidden="true">{item.icon}</span>
                <span className="admin-sidebar-label">{item.name}</span>
                {item.path === '/admin/orders' && activeOrdersCount > 0 && (
                  <span className="admin-order-count" aria-label={`Активных заказов: ${activeOrdersCount}`}>{activeOrdersCount}</span>
                )}
              </Link>
            );
          })}
        </nav>
        <div className="admin-sidebar-footer">
          <button type="button" onClick={handleLogout} title={collapsed ? 'Выйти' : undefined}>
            <span aria-hidden="true">↪</span><span className="admin-sidebar-label">Выйти</span>
          </button>
        </div>
      </aside>
      <main className="admin-main">{children}</main>
    </div>
  );
}
