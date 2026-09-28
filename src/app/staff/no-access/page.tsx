import Link from 'next/link';
import { requireStaffSession } from '@/lib/staff-auth';

export const dynamic = 'force-dynamic';

export default async function NoAccessPage() {
  await requireStaffSession();
  return <section><h1>Каталог недоступен</h1><p>Для этого аккаунта доступен приём заказов.</p><Link href="/staff/orders/new">Оформить новый заказ</Link></section>;
}
