import type { HomepageBannerSlot } from '@/lib/api-v1/types';

export const bannerSlotNames: Record<HomepageBannerSlot, string> = {
  left: 'Левый баннер',
  center: 'Центральный баннер',
  right_top: 'Правый верхний баннер',
  right_bottom: 'Правый нижний баннер',
};

export const bannerRecommendedDimensions: Record<HomepageBannerSlot, string> = {
  left: '1200 × 900 px',
  center: '1600 × 900 px',
  right_top: '1200 × 500 px',
  right_bottom: '1200 × 500 px',
};

export const bannerSlots = Object.keys(bannerSlotNames) as HomepageBannerSlot[];
