import type { HomepageBannerSlot } from '@/lib/api-v1/types';
import { bannerDimensions } from '@/lib/banner-image';

export const bannerSlotNames: Record<HomepageBannerSlot, string> = {
  left: 'Левый баннер',
  center: 'Центральный баннер',
  right_top: 'Правый верхний баннер',
  right_bottom: 'Правый нижний баннер',
  mobile: 'Баннер для смартфонов',
};

export const bannerRecommendedDimensions = Object.fromEntries(
  Object.entries(bannerDimensions).map(([slot, size]) => [slot, `${size.width} × ${size.height} px`]),
) as Record<HomepageBannerSlot, string>;

export const bannerSlots = Object.keys(bannerSlotNames) as HomepageBannerSlot[];
