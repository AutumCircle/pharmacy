import { requireStaffSession } from '@/lib/staff-auth';

export const dynamic = 'force-dynamic';

export default async function NoAccessPage() {
  await requireStaffSession();
  return <section><h1>Доступ пока не предоставлен</h1><p>Вы вошли в аккаунт сотрудника. Обратитесь к администратору аптеки.</p></section>;
}
