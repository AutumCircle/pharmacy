'use client';

import { usePathname, useRouter } from 'next/navigation';

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
        <div><strong>Vatan Pharmacy</strong><span>Каталог для работников</span></div>
        <button type="button" onClick={logout}>Выйти</button>
      </header>
      <main className="staff-main">{children}</main>
    </div>
  );
}
