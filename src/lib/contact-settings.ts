import type { SiteContactSettings } from '@/lib/api-v1/types';

export function formatTajikPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '').replace(/^992/, '');
  if (digits.length !== 9) return phone;
  return `+992 ${digits.slice(0, 2)} ${digits.slice(2, 5)} ${digits.slice(5, 7)} ${digits.slice(7, 9)}`;
}

export async function loadSiteContactSettings(): Promise<SiteContactSettings> {
  const response = await fetch('/api/site-settings', { cache: 'no-store' });
  if (!response.ok) throw new Error('Contact settings are unavailable');
  return response.json() as Promise<SiteContactSettings>;
}
