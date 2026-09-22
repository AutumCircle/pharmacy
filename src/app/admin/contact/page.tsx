import { requireAdminSession } from '@/lib/admin-auth';
import { getAdminContactSettings } from '@/lib/api-v1/admin-server';
import ContactSettingsClient from './ContactSettingsClient';

export const dynamic = 'force-dynamic';

export default async function AdminContactPage() {
  await requireAdminSession();
  try {
    const response = await getAdminContactSettings();
    return <ContactSettingsClient initialSettings={response.data} />;
  } catch (error) {
    console.error('Failed to load contact settings', error);
    return <div style={{ background: 'white', border: '1px solid #f2c7c7', borderRadius: 12, padding: 24 }}><h1 style={{ marginTop: 0 }}>Настройки контакта пока недоступны</h1><p style={{ marginBottom: 0, color: '#666' }}>Повторите попытку через несколько секунд.</p></div>;
  }
}
