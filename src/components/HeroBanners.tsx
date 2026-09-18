import BannerRenderer from '@/components/BannerRenderer';
import { bannerCompositionDefaults, withBannerCompositionDefaults } from '@/lib/banner-layout';
import type { HomepageBanner, HomepageBannerSlot } from '@/lib/api-v1/types';

const basePresentation = {
  image_url: null, link_url: null, cta_text: null, alt_text: null,
  fit_mode: 'contain' as const, object_position_x: 50, object_position_y: 50,
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
  mobile: { ...basePresentation, slot: 'mobile', title: null, subtitle: null },
};

function PublicBanner({ banner, className, cellClassName = '' }: { banner: HomepageBanner; className: string; cellClassName?: string }) {
  const content = <BannerRenderer banner={banner} viewport="auto" className={className} />;
  const hasCta = Boolean(banner.cta_text?.trim() && banner.link_url);
  return (
    <div className={`hero-banner-cell ${cellClassName}`.trim()}>
      {banner.link_url && !hasCta ? <a className="banner-public-link" href={banner.link_url}>{content}</a> : content}
    </div>
  );
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
  const sideBanners = [left, rightTop, rightBottom].filter((value): value is HomepageBanner => Boolean(value));
  const mobile = banner('mobile');
  if (!center && sideBanners.length === 0 && !mobile) return null;
  return (
    <section className="hero-grid" aria-label="Баннеры аптеки">
      <div className="hero-desktop-layout">
        {left && <PublicBanner banner={left} className="left-banner" cellClassName="hero-desktop-left" />}
        {center && <PublicBanner banner={center} className="center-banner" cellClassName="hero-desktop-center" />}
        {(rightTop || rightBottom) && <div className="right-banners">
          {rightTop && <PublicBanner banner={rightTop} className="right-top-banner" />}
          {rightBottom && <PublicBanner banner={rightBottom} className="right-bottom-banner" />}
        </div>}
      </div>

      {mobile && <div className="hero-mobile-layout">
        <PublicBanner banner={mobile} className="mobile-banner" />
      </div>}
    </section>
  );
}
