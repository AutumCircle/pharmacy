'use client';

import type { AdminHomepageBanner } from '@/lib/api-v1/admin-types';

function hexToRgba(hex: string, opacity: number): string {
  const clean = hex.replace('#', '');
  const channels = [0, 2, 4].map((index) => Number.parseInt(clean.slice(index, index + 2), 16));
  return `rgba(${channels.join(', ')}, ${opacity / 100})`;
}

function overlayBackground(banner: AdminHomepageBanner): string {
  const start = hexToRgba(banner.overlay_color, banner.overlay_opacity);
  if (banner.overlay_type === 'solid') return start;
  const directions = { to_right: '90deg', to_left: '270deg', to_bottom: '180deg', to_top: '0deg' };
  return `linear-gradient(${directions[banner.overlay_direction]}, ${start}, ${hexToRgba(banner.overlay_color, Math.round(banner.overlay_opacity * 0.2))})`;
}

export default function BannerAdminPreview({
  banner,
  mode = 'desktop',
  compact = false,
  showSafeRegion = false,
}: {
  banner: AdminHomepageBanner;
  mode?: 'desktop' | 'mobile';
  compact?: boolean;
  showSafeRegion?: boolean;
}) {
  const title = banner.title?.trim() || '';
  const subtitle = banner.subtitle?.trim() || '';
  const hasCta = Boolean(banner.cta_text?.trim() && banner.link_url);
  const hasCopy = Boolean(title || subtitle || hasCta);
  const horizontal = banner.text_align === 'center' ? 'center' : banner.text_align === 'right' ? 'flex-end' : 'flex-start';
  const vertical = banner.content_vertical === 'center' ? 'center' : banner.content_vertical === 'bottom' ? 'flex-end' : 'flex-start';
  return (
    <div className={`admin-banner-live-preview admin-banner-live-preview--${banner.slot} admin-banner-live-preview--${mode}${compact ? ' is-compact' : ''}`} style={{ justifyContent: vertical }}>
      {banner.image_url ? (
        // The Admin Lambda only accepts HTTPS image URLs.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={banner.image_url} alt={banner.alt_text || 'Предпросмотр баннера'} referrerPolicy="no-referrer" style={{ objectFit: banner.fit_mode, objectPosition: `${banner.object_position_x}% ${banner.object_position_y}%` }} />
      ) : <div className="admin-banner-preview-empty">Изображение не задано</div>}
      {hasCopy && banner.image_url && banner.overlay_enabled && <div className="admin-banner-live-overlay" style={{ background: overlayBackground(banner) }} />}
      {hasCopy && <div className="admin-banner-live-copy" style={{ maxWidth: `${banner.content_max_width}%`, textAlign: banner.text_align, alignSelf: horizontal, color: banner.text_color }}>
        {title && <strong style={{ fontSize: compact ? undefined : `${banner.title_size}px` }}>{title}</strong>}
        {subtitle && <span style={{ fontSize: compact ? undefined : `${banner.subtitle_size}px` }}>{subtitle}</span>}
        {hasCta && <span className="admin-banner-live-cta">{banner.cta_text}</span>}
      </div>}
      {showSafeRegion && <div className="admin-banner-safe-region"><span>Безопасная зона</span></div>}
      {!hasCopy && banner.image_url && <span className="admin-banner-image-only-badge">Только изображение</span>}
    </div>
  );
}
