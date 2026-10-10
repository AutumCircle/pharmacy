'use client';

import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';

export default function StaffShell({ children, role }: { children: React.ReactNode; role: 'pharmacy' | 'courier' | null }) {
  const pathname = usePathname();
  const router = useRouter();
  if (pathname === '/staff/login') return <>{children}</>;

  async function logout() {
    await fetch('/api/staff/logout', { method: 'POST' });
    router.replace('/staff/login');
    router.refresh();
  }

  return (
    <div className="staff-shell">
      <header className="staff-header">
        <div><strong>Vatan Pharmacy</strong><span>{role === 'courier' ? 'Кабинет доставщика' : 'Кабинет сотрудника'}</span></div>
        <nav className="staff-nav" aria-label="Разделы кабинета">
          {role === 'courier' && <Link className={pathname.startsWith('/staff/orders/new') ? 'active' : ''} href="/staff/orders/new">Новый заказ</Link>}
          {role === 'courier' && <Link className={pathname === '/staff/orders' ? 'active' : ''} href="/staff/orders">Все заказы</Link>}
          {role === 'pharmacy' && <Link className={pathname === '/staff/orders' ? 'active' : ''} href="/staff/orders">Заказы на сборку</Link>}
          {role === 'pharmacy' && <Link className={pathname.startsWith('/staff/medicines') ? 'active' : ''} href="/staff/medicines">Каталог</Link>}
        </nav>
        <button type="button" onClick={logout}>Выйти</button>
      </header>
      <main className="staff-main">{children}</main>
    </div>
  );
}
