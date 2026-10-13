'use client';

import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';

const icons = {
  orders: 'M4 5h16v2H4V5Zm0 6h16v2H4v-2Zm0 6h10v2H4v-2Z',
  add: 'M11 4h2v7h7v2h-7v7h-2v-7H4v-2h7V4Z',
  wallet: 'M4 6a2 2 0 0 1 2-2h12v3H6v10h14v-7H15a3 3 0 0 0 0 6h5v3H6a2 2 0 0 1-2-2V6Zm11 7a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z',
};

function Icon({ path }: { path: string }) {
  return <svg aria-hidden="true" viewBox="0 0 24 24"><path d={path} /></svg>;
}

export default function StaffShell({ children, role }: { children: React.ReactNode; role: 'pharmacy' | 'courier' | null }) {
  const pathname = usePathname();
  const router = useRouter();
  if (pathname === '/staff/login') return <>{children}</>;

  async function logout() {
    await fetch('/api/staff/logout', { method: 'POST' });
    router.replace('/staff/login');
    router.refresh();
  }

  const courierTabs = [
    { href: '/staff/orders', label: 'Заказы', icon: icons.orders, active: pathname === '/staff/orders' },
    { href: '/staff/orders/new', label: 'Новый заказ', icon: icons.add, active: pathname.startsWith('/staff/orders/new') },
    { href: '/staff/earnings', label: 'Заработок', icon: icons.wallet, active: pathname.startsWith('/staff/earnings') },
  ];

  return (
    <div className={role === 'courier' ? 'staff-shell staff-shell-courier' : 'staff-shell'}>
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
    </div>
  );
}
