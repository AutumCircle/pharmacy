'use client';

import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import NewOrderAlerts, { type AlertOrder } from '@/components/NewOrderAlerts';
import PharmacyOrderAlerts from '@/components/PharmacyOrderAlerts';
import type { CourierOrder } from '@/lib/api-v1/staff-types';

const icons = {
  orders: 'M4 5h16v2H4V5Zm0 6h16v2H4v-2Zm0 6h10v2H4v-2Z',
  add: 'M11 4h2v7h7v2h-7v7h-2v-7H4v-2h7V4Z',
  wallet: 'M4 6a2 2 0 0 1 2-2h12v3H6v10h14v-7H15a3 3 0 0 0 0 6h5v3H6a2 2 0 0 1-2-2V6Zm11 7a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z',
};

function Icon({ path }: { path: string }) {
  return <svg aria-hidden="true" viewBox="0 0 24 24"><path d={path} /></svg>;
}

async function loadWebsiteOrders(): Promise<AlertOrder[]> {
  const response = await fetch('/api/staff/orders?status=pending', { cache: 'no-store' });
  if (!response.ok) throw new Error('orders unavailable');
  const data: { data?: CourierOrder[] } = await response.json();
  return (data.data ?? []).filter((order) => order.website_order).map((order) => ({
    id: order.order_id,
    title: `Новый заказ с сайта № ${order.order_reference || order.order_id.slice(-6)}`,
    detail: `${order.customer_name || 'Без имени'} · ${order.address}`,
    href: `/staff/orders/${order.order_id}`,
  }));
}

export default function StaffShell({ children, role, accountId }: {
  children: React.ReactNode; role: 'pharmacy' | 'courier' | null; accountId: 1 | 2 | 3 | null;
}) {
  const pathname = usePathname();
  const router = useRouter();
  if (pathname === '/staff/login') return <>{children}</>;

  async function logout() {
    await fetch('/api/staff/logout', { method: 'POST' });
    router.replace('/staff/login');
    router.refresh();
  }

  const courierTabs = [
    { href: '/staff/orders', label: 'Заказы', icon: icons.orders, active: pathname === '/staff/orders' || (pathname.startsWith('/staff/orders/') && !pathname.startsWith('/staff/orders/new')) },
    { href: '/staff/orders/new', label: 'Новый заказ', icon: icons.add, active: pathname.startsWith('/staff/orders/new') },
    { href: '/staff/earnings', label: 'Заработок', icon: icons.wallet, active: pathname.startsWith('/staff/earnings') },
  ];

  return (
    <div className={role === 'courier' ? 'staff-shell staff-shell-courier' : role === 'pharmacy' ? 'staff-shell staff-shell-pharmacy' : 'staff-shell'}>
      <header className="staff-header">
        <div className="staff-brand"><strong>Vatan</strong><span>{role === 'courier' ? 'Доставка' : 'Аптека'}</span></div>
        <nav className="staff-nav" aria-label="Разделы кабинета">
          {role === 'courier' && courierTabs.map((tab) => <Link key={tab.href} href={tab.href}
            className={tab.active ? 'active' : ''} aria-current={tab.active ? 'page' : undefined}>
            <Icon path={tab.icon} /><span>{tab.label}</span></Link>)}
          {role === 'pharmacy' && <Link className={pathname === '/staff/orders' ? 'active' : ''} href="/staff/orders">Заказы на сборку</Link>}
          {role === 'pharmacy' && <Link className={pathname.startsWith('/staff/medicines') ? 'active' : ''} href="/staff/medicines">Каталог</Link>}
        </nav>
        <button type="button" className="staff-logout" onClick={logout}>Выйти</button>
      </header>
      <main className="staff-main">{children}</main>
      <NewOrderAlerts load={loadWebsiteOrders} enabled={role === 'courier'} />
      <PharmacyOrderAlerts enabled={role === 'pharmacy'} intensive={accountId === 1} />
    </div>
  );
}
