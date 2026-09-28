'use client';

import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';

export default function StaffShell({ children }: { children: React.ReactNode }) {
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
        <div><strong>Vatan Pharmacy</strong><span>Кабинет сотрудника</span></div>
        <nav className="staff-nav" aria-label="Разделы кабинета">
          <Link className={pathname.startsWith('/staff/orders') ? 'active' : ''} href="/staff/orders/new">Новый заказ</Link>
          <Link className={pathname.startsWith('/staff/medicines') ? 'active' : ''} href="/staff/medicines">Каталог</Link>
        </nav>
        <button type="button" onClick={logout}>Выйти</button>
      </header>
      <main className="staff-main">{children}</main>
    </div>
  );
}
