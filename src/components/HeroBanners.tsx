import type { HomepageBanner, HomepageBannerSlot } from '@/lib/api-v1/types';
import type { CSSProperties } from 'react';

const basePresentation = {
  image_url: null,
  link_url: null,
  cta_text: null,
  alt_text: null,
  fit_mode: 'cover' as const,
  object_position_x: 50,
  object_position_y: 50,
  image_width: null,
  image_height: null,
  overlay_enabled: true,
  overlay_color: '#FFFFFF',
  overlay_opacity: 94,
  overlay_type: 'gradient' as const,
  overlay_direction: 'to_right' as const,
  text_color: '#333333',
  text_align: 'left' as const,
  content_vertical: 'top' as const,
  title_size: 26,
  subtitle_size: 16,
  content_max_width: 75,
};

const defaults: Record<HomepageBannerSlot, HomepageBanner> = {
  left: { ...basePresentation, slot: 'left', title: 'Витамины, минералы и добавки', subtitle: null },
  center: { ...basePresentation, slot: 'center', title: 'Скидка на все виды лекарств', subtitle: 'Без выходных · Работаем днём и ночью · Доставим быстро' },
  right_top: { ...basePresentation, slot: 'right_top', title: 'Лучшие цены на лекарства', subtitle: null, title_size: 20 },
  right_bottom: { ...basePresentation, slot: 'right_bottom', title: 'Бонус к чеку', subtitle: null, title_size: 20 },
};

function hexToRgba(hex: string, opacity: number): string {
  const clean = hex.replace('#', '');
  const red = Number.parseInt(clean.slice(0, 2), 16);
  const green = Number.parseInt(clean.slice(2, 4), 16);
  const blue = Number.parseInt(clean.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${Math.max(0, Math.min(100, opacity)) / 100})`;
}

function overlayBackground(banner: HomepageBanner): string {
  const start = hexToRgba(banner.overlay_color, banner.overlay_opacity);
  if (banner.overlay_type === 'solid') return start;
  const directions = { to_right: '90deg', to_left: '270deg', to_bottom: '180deg', to_top: '0deg' };
  const end = hexToRgba(banner.overlay_color, Math.round(banner.overlay_opacity * 0.2));
  return `linear-gradient(${directions[banner.overlay_direction]}, ${start}, ${end})`;
}

function Banner({ banner, className }: { banner: HomepageBanner; className: string }) {
  const title = banner.title?.trim() || '';
  const subtitle = banner.subtitle?.trim() || '';
  const ctaText = banner.cta_text?.trim() || '';
  const hasCta = Boolean(ctaText && banner.link_url);
  const hasCopy = Boolean(title || subtitle || hasCta);
  const imageOnly = Boolean(banner.image_url && !hasCopy);
  const horizontal = banner.text_align === 'center' ? 'center' : banner.text_align === 'right' ? 'flex-end' : 'flex-start';
  const vertical = banner.content_vertical === 'center' ? 'center' : banner.content_vertical === 'bottom' ? 'flex-end' : 'flex-start';
  const style = {
    position: 'relative' as const,
    overflow: 'hidden',
    minHeight: className.startsWith('right') ? 150 : 330,
    color: banner.text_color,
    textDecoration: 'none',
    justifyContent: vertical,
    '--banner-padding': imageOnly ? '0px' : '24px',
  } as CSSProperties;
  const content = (
    <>
      {banner.image_url && (
        // URLs are validated as HTTPS by the Admin Lambda and served from the configured media origin.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          className="banner-background-image"
          src={banner.image_url}
          alt={banner.alt_text || ''}
          referrerPolicy="no-referrer"
          style={{ objectFit: banner.fit_mode, objectPosition: `${banner.object_position_x}% ${banner.object_position_y}%` }}
        />
      )}
      {hasCopy && banner.image_url && banner.overlay_enabled && (
        <div className="banner-image-overlay" style={{ background: overlayBackground(banner) }} />
      )}
      {hasCopy && (
        <div
          className="banner-copy"
          style={{ maxWidth: `${banner.content_max_width}%`, textAlign: banner.text_align, alignSelf: horizontal }}
        >
          {title && <h2 style={{ color: banner.text_color, fontSize: `${banner.title_size}px` }}>{title}</h2>}
          {subtitle && <p style={{ color: banner.text_color, fontSize: `${banner.subtitle_size}px` }}>{subtitle}</p>}
          {hasCta && <a className="banner-cta" href={banner.link_url || '#'}>{ctaText}</a>}
        </div>
      )}
    </>
  );

  if (banner.link_url && !hasCta) {
    return <a href={banner.link_url} className={`banner ${className}`} style={style}>{content}</a>;
  }
  return <div className={`banner ${className}`} style={style}>{content}</div>;
}

export default function HeroBanners({ banners }: { banners?: HomepageBanner[] }) {
  const usingFallback = banners === undefined;
  const bySlot = new Map((banners || []).map((banner) => [banner.slot, banner]));
  const banner = (slot: HomepageBannerSlot) => {
    const value = bySlot.get(slot) || (usingFallback ? defaults[slot] : null);
    return value && (value.image_url || value.title?.trim() || value.subtitle?.trim()) ? value : null;
  };
  const left = banner('left');
  const center = banner('center');
  const rightTop = banner('right_top');
  const rightBottom = banner('right_bottom');
  const hasRightColumn = Boolean(rightTop || rightBottom);
  const columns = [left && '1fr', center && '1.5fr', hasRightColumn && '1fr'].filter(Boolean).join(' ');

  if (!left && !center && !hasRightColumn) return null;

  return (
    <section className="hero-grid" style={{ '--hero-columns': columns } as CSSProperties}>
      {left && <Banner banner={left} className="left-banner" />}
      {center && <Banner banner={center} className="center-banner" />}
      {hasRightColumn && <div className="right-banners">
        {rightTop && <Banner banner={rightTop} className="right-top-banner" />}
        {rightBottom && <Banner banner={rightBottom} className="right-bottom-banner" />}
      </div>}
    </section>
  );
}
