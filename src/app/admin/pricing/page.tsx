import { requireAdminSession } from '@/lib/admin-auth';
import { getAdminPricingSettings } from '@/lib/api-v1/admin-server';
import PricingSettingsClient from './PricingSettingsClient';

export const dynamic = 'force-dynamic';

export default async function AdminPricingPage() {
  await requireAdminSession();
  let settings = null;
  try {
    const response = await getAdminPricingSettings();
    settings = response.data;
  } catch (error) {
    console.error('Failed to load pricing settings', error);
  }
  if (settings) return <PricingSettingsClient initialSettings={settings} />;
  return (
    <div style={{ background: 'white', border: '1px solid #f2c7c7', borderRadius: 12, padding: 24 }}>
      <h1 style={{ marginTop: 0 }}>Настройки цен пока недоступны</h1>
      <p style={{ marginBottom: 0, color: '#666' }}>Сначала примените миграцию 0007 и разверните обновлённую Admin Lambda.</p>
    </div>
  );
}
