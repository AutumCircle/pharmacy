import Link from 'next/link';
import { requireStaffSession } from '@/lib/staff-auth';

export const dynamic = 'force-dynamic';

export default async function NoAccessPage() {
  await requireStaffSession();
  return <section><h1>Каталог недоступен</h1><p>Вы можете смотреть заказы на сборку.</p><Link href="/staff/orders">Заказы на сборку</Link></section>;
}
