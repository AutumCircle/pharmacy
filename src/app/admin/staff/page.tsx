import { requireAdminSession } from '@/lib/admin-auth';
import { listStaffAccounts } from '@/lib/api-v1/admin-server';
import StaffAccounts from './StaffAccounts';

export const dynamic = 'force-dynamic';

export default async function StaffAccountsPage() {
  await requireAdminSession();
  const { data } = await listStaffAccounts();
  return <div><h1>Сотрудники</h1><p>Аккаунты двух аптек и доставщика. Изменение логина или пароля завершит текущие сеансы этого сотрудника.</p><StaffAccounts accounts={data} /></div>;
}
