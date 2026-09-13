import type { HomepageBannerSlot } from '@/lib/api-v1/types';

export const bannerSlotNames: Record<HomepageBannerSlot, string> = {
  left: 'Левый баннер',
  center: 'Центральный баннер',
  right_top: 'Правый верхний баннер',
  right_bottom: 'Правый нижний баннер',
};

export const bannerRecommendedDimensions: Record<HomepageBannerSlot, string> = {
  left: '1000 × 1400 px',
  center: '1500 × 1000 px',
  right_top: '1600 × 900 px',
  right_bottom: '1600 × 900 px',
};

export const bannerSlots = Object.keys(bannerSlotNames) as HomepageBannerSlot[];
