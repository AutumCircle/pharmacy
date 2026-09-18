import 'server-only';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { HomepageBanner } from '@/lib/api-v1/types';
import type { AdminHomepageBanner } from '@/lib/api-v1/admin-types';
import { bannerCompositionDefaults } from '@/lib/banner-layout';

const slots = ['left', 'center', 'right_top', 'right_bottom', 'mobile'] as const;
const directory = join(process.cwd(), '.local-banners');

function emptyBanner(slot: AdminHomepageBanner['slot']): AdminHomepageBanner {
  return {
  ...bannerCompositionDefaults, slot, title: null, subtitle: null,
  image_url: null, link_url: null, cta_text: null, alt_text: null,
  is_active: false, updated_at: '2026-09-13T00:00:00Z',
  fit_mode: 'contain', object_position_x: 50, object_position_y: 50,
  image_width: null, image_height: null, overlay_enabled: false,
  overlay_color: '#FFFFFF', overlay_opacity: 0, overlay_type: 'solid', overlay_direction: 'to_right',
  text_color: '#333333', text_align: 'left', content_vertical: 'top',
  title_size: 26, subtitle_size: 16, content_max_width: 75,
  };
}

export async function withLocalBanners<T extends HomepageBanner>(banners: T[]): Promise<T[]> {
  if (process.env.NODE_ENV !== 'development') return banners;
  const merged = new Map<string, HomepageBanner>(banners.map(banner => [banner.slot, banner]));
  for (const slot of slots) {
    if (!merged.has(slot)) merged.set(slot, emptyBanner(slot));
  }
  for (const slot of slots) {
    try { merged.set(slot, JSON.parse(await readFile(join(directory, `${slot}.json`), 'utf8'))); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  return [...merged.values()] as T[];
}

export async function listLocalAdminBanners(banners: HomepageBanner[] = []): Promise<AdminHomepageBanner[]> {
  const adminBanners = banners.map((banner) => ({
    ...banner,
    is_active: true,
    updated_at: '2026-09-13T00:00:00Z',
  }));
  return withLocalBanners(adminBanners);
}

export async function saveLocalBanner(banner: Omit<AdminHomepageBanner, 'updated_at'>): Promise<AdminHomepageBanner> {
  if (process.env.NODE_ENV !== 'development' || !slots.includes(banner.slot)) throw new Error('Local banner mode unavailable');
  const saved = { ...banner, updated_at: new Date().toISOString() };
  await mkdir(directory, { recursive: true });
  const temporary = join(directory, `${randomUUID()}.tmp`);
  await writeFile(temporary, JSON.stringify(saved), 'utf8');
  await rename(temporary, join(directory, `${banner.slot}.json`));
  return saved;
}
