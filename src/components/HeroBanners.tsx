import type { CSSProperties } from 'react';
import BannerRenderer from '@/components/BannerRenderer';
import { bannerCompositionDefaults, withBannerCompositionDefaults } from '@/lib/banner-layout';
import type { HomepageBanner, HomepageBannerSlot } from '@/lib/api-v1/types';

const basePresentation = {
  image_url: null, link_url: null, cta_text: null, alt_text: null,
  fit_mode: 'cover' as const, object_position_x: 50, object_position_y: 50,
  image_width: null, image_height: null, overlay_enabled: true, overlay_color: '#FFFFFF',
  overlay_opacity: 94, overlay_type: 'gradient' as const, overlay_direction: 'to_right' as const,
  text_color: '#333333', text_align: 'left' as const, content_vertical: 'top' as const,
  title_size: 26, subtitle_size: 16, content_max_width: 75,
  ...bannerCompositionDefaults,
};

const defaults: Record<HomepageBannerSlot, HomepageBanner> = {
  left: { ...basePresentation, slot: 'left', title: 'Витамины, минералы и добавки', subtitle: null },
  center: { ...basePresentation, slot: 'center', title: 'Скидка на все виды лекарств', subtitle: 'Без выходных · Работаем днём и ночью · Доставим быстро' },
  right_top: { ...basePresentation, slot: 'right_top', title: 'Лучшие цены на лекарства', subtitle: null, title_size: 20 },
  right_bottom: { ...basePresentation, slot: 'right_bottom', title: 'Бонус к чеку', subtitle: null, title_size: 20 },
};

function PublicBanner({ banner, className }: { banner: HomepageBanner; className: string }) {
  const content = <BannerRenderer banner={banner} viewport="auto" className={className} />;
  const hasCta = Boolean(banner.cta_text?.trim() && banner.link_url);
  if (banner.link_url && !hasCta) return <a className="banner-public-link" href={banner.link_url}>{content}</a>;
  return content;
}

export default function HeroBanners({ banners }: { banners?: HomepageBanner[] }) {
  const usingFallback = banners === undefined;
  const bySlot = new Map((banners || []).map((banner) => [banner.slot, withBannerCompositionDefaults({ ...basePresentation, ...banner })]));
  const banner = (slot: HomepageBannerSlot) => {
    const value = bySlot.get(slot) || (usingFallback ? defaults[slot] : null);
    return value && (value.image_url || value.title?.trim() || value.subtitle?.trim()) ? value : null;
  };
  const left = banner('left'); const center = banner('center');
  const rightTop = banner('right_top'); const rightBottom = banner('right_bottom');
  const hasRightColumn = Boolean(rightTop || rightBottom);
  const columns = [left && '1fr', center && '1.5fr', hasRightColumn && '1fr'].filter(Boolean).join(' ');
  if (!left && !center && !hasRightColumn) return null;
  return (
    <section className="hero-grid" style={{ '--hero-columns': columns } as CSSProperties}>
      {left && <PublicBanner banner={left} className="left-banner" />}
      {center && <PublicBanner banner={center} className="center-banner" />}
      {hasRightColumn && <div className="right-banners">
        {rightTop && <PublicBanner banner={rightTop} className="right-top-banner" />}
        {rightBottom && <PublicBanner banner={rightBottom} className="right-bottom-banner" />}
      </div>}
    </section>
  );
}
