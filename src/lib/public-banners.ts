/** Public banner projection for native clients. Never spread an upstream row. */
import type { HomepageBanner } from './api-v1/types';

const BANNER_KEYS = [
  'slot', 'title', 'subtitle', 'image_url', 'link_url', 'cta_text', 'alt_text',
  'fit_mode', 'object_position_x', 'object_position_y', 'image_width', 'image_height',
  'overlay_enabled', 'overlay_color', 'overlay_opacity', 'overlay_type',
  'overlay_direction', 'text_color', 'text_align', 'content_vertical',
  'title_size', 'subtitle_size', 'content_max_width', 'image_scale',
  'contain_background', 'contain_background_color',
  'title_x', 'title_y', 'title_width', 'title_scale',
  'subtitle_x', 'subtitle_y', 'subtitle_width', 'subtitle_scale',
  'cta_x', 'cta_y', 'cta_width', 'cta_scale',
  'mobile_override', 'mobile_image_x', 'mobile_image_y', 'mobile_image_scale',
  'mobile_title_x', 'mobile_title_y', 'mobile_title_width', 'mobile_title_scale',
  'mobile_subtitle_x', 'mobile_subtitle_y', 'mobile_subtitle_width',
  'mobile_subtitle_scale', 'mobile_cta_x', 'mobile_cta_y',
  'mobile_cta_width', 'mobile_cta_scale',
] as const satisfies readonly (keyof HomepageBanner)[];

export type PublicBannerDto = Pick<HomepageBanner, typeof BANNER_KEYS[number]>;
export interface PublicBannersPayload { banners: PublicBannerDto[] }

export function toPublicBannersPayload(banners: HomepageBanner[] | null | undefined): PublicBannersPayload {
  return {
    banners: (banners ?? [])
      .filter((banner) =>
        !('is_active' in banner) || banner.is_active !== false)
      .filter((banner) => Boolean(banner.image_url || banner.title?.trim() || banner.subtitle?.trim()))
      .map((banner) => Object.fromEntries(BANNER_KEYS.map((key) => [key, banner[key]])) as PublicBannerDto),
  };
}
