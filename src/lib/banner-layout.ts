import type { HomepageBanner } from '@/lib/api-v1/types';

export type BannerViewport = 'desktop' | 'mobile';
export type BannerEditableElement = 'image' | 'title' | 'subtitle' | 'cta';

export const bannerCompositionDefaults = {
  image_scale: 100, contain_background: 'color' as const, contain_background_color: '#F5F5F5',
  title_x: 8, title_y: 12, title_width: 75, title_scale: 100,
  subtitle_x: 8, subtitle_y: 38, subtitle_width: 75, subtitle_scale: 100,
  cta_x: 8, cta_y: 65, cta_width: 35, cta_scale: 100,
  mobile_override: false, mobile_image_x: 50, mobile_image_y: 50, mobile_image_scale: 100,
  mobile_title_x: 8, mobile_title_y: 12, mobile_title_width: 84, mobile_title_scale: 100,
  mobile_subtitle_x: 8, mobile_subtitle_y: 38, mobile_subtitle_width: 84, mobile_subtitle_scale: 100,
  mobile_cta_x: 8, mobile_cta_y: 68, mobile_cta_width: 55, mobile_cta_scale: 100,
};

export function withBannerCompositionDefaults<T extends HomepageBanner>(banner: T): T {
  return { ...bannerCompositionDefaults, ...banner };
}

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.round(Math.max(minimum, Math.min(maximum, value)));
}

export function usesMobileComposition(banner: HomepageBanner, viewport: BannerViewport): boolean {
  return viewport === 'mobile' && banner.mobile_override;
}

export function elementLayout(banner: HomepageBanner, element: Exclude<BannerEditableElement, 'image'>, viewport: BannerViewport) {
  const prefix = usesMobileComposition(banner, viewport) ? `mobile_${element}` : element;
  return {
    x: Number(banner[`${prefix}_x` as keyof HomepageBanner]),
    y: Number(banner[`${prefix}_y` as keyof HomepageBanner]),
    width: Number(banner[`${prefix}_width` as keyof HomepageBanner]),
    scale: Number(banner[`${prefix}_scale` as keyof HomepageBanner]),
  };
}

export function imageLayout(banner: HomepageBanner, viewport: BannerViewport) {
  return usesMobileComposition(banner, viewport)
    ? { x: banner.mobile_image_x, y: banner.mobile_image_y, scale: banner.mobile_image_scale }
    : { x: banner.object_position_x, y: banner.object_position_y, scale: banner.image_scale };
}

export function compositionField(element: BannerEditableElement, property: 'x' | 'y' | 'width' | 'scale', viewport: BannerViewport, mobileOverride: boolean): keyof HomepageBanner {
  if (element === 'image') {
    if (property === 'width') throw new Error('Image width is represented by scale');
    if (viewport === 'mobile' && mobileOverride) return `mobile_image_${property}` as keyof HomepageBanner;
    return property === 'x' ? 'object_position_x' : property === 'y' ? 'object_position_y' : 'image_scale';
  }
  return `${viewport === 'mobile' && mobileOverride ? 'mobile_' : ''}${element}_${property}` as keyof HomepageBanner;
}
