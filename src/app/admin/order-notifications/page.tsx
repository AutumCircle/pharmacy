import { requireAdminSession } from '@/lib/admin-auth';
import { getAdminNotificationSettings } from '@/lib/api-v1/admin-server';
import NotificationSettingsClient from './NotificationSettingsClient';

export const dynamic = 'force-dynamic';

export default async function OrderNotificationSettingsPage() {
  await requireAdminSession();
  let settings = null;
  try {
    settings = (await getAdminNotificationSettings()).data;
  } catch {
    // The migration and both Lambda packages are deployed before this page.
  }
  if (settings) return <NotificationSettingsClient initialSettings={settings} />;
  return <section style={{ background: 'white', padding: 24, borderRadius: 12 }}>
      <h1>Настройки уведомлений пока недоступны</h1>
      <p>Для этого раздела нужны миграция 0021 и обновлённая Admin Lambda. Текущие уведомления не изменены.</p>
    </section>;
}
