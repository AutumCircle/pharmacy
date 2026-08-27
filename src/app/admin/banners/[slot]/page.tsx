import { notFound } from 'next/navigation';
import { requireAdminSession } from '@/lib/admin-auth';
import { listAdminHomepageBanners } from '@/lib/api-v1/admin-server';
import type { HomepageBannerSlot } from '@/lib/api-v1/types';
import BannerEditorClient from './BannerEditorClient';
import { bannerSlots } from '../banner-config';

export const dynamic = 'force-dynamic';

export default async function AdminBannerEditorPage({ params }: { params: Promise<{ slot: string }> }) {
  await requireAdminSession();
  const { slot } = await params;
  if (!bannerSlots.includes(slot as HomepageBannerSlot)) notFound();
  const response = await listAdminHomepageBanners();
  const banner = response.data.find((item) => item.slot === slot);
  if (!banner) notFound();
  return <BannerEditorClient initialBanner={banner} />;
}
