'use client';

import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import type { HomepageBanner } from '@/lib/api-v1/types';
import { elementLayout, imageLayout, type BannerEditableElement, type BannerViewport } from '@/lib/banner-layout';

type EditAction = 'move' | 'resize';

function hexToRgba(hex: string, opacity: number): string {
  const clean = hex.replace('#', '');
  const channels = [0, 2, 4].map((index) => Number.parseInt(clean.slice(index, index + 2), 16));
  return `rgba(${channels.join(', ')}, ${opacity / 100})`;
}

function overlayBackground(banner: HomepageBanner): string {
  const start = hexToRgba(banner.overlay_color, banner.overlay_opacity);
  if (banner.overlay_type === 'solid') return start;
  const directions = { to_right: '90deg', to_left: '270deg', to_bottom: '180deg', to_top: '0deg' };
  return `linear-gradient(${directions[banner.overlay_direction]}, ${start}, ${hexToRgba(banner.overlay_color, Math.round(banner.overlay_opacity * 0.2))})`;
}

function variables(banner: HomepageBanner): CSSProperties {
  const desktopImage = imageLayout(banner, 'desktop');
  const mobileImage = imageLayout(banner, 'mobile');
  const style: Record<string, string | number> = {
    '--banner-bg': banner.contain_background_color,
    '--image-x': `${desktopImage.x}%`, '--image-y': `${desktopImage.y}%`, '--image-scale': desktopImage.scale / 100,
    '--mobile-image-x': `${mobileImage.x}%`, '--mobile-image-y': `${mobileImage.y}%`, '--mobile-image-scale': mobileImage.scale / 100,
  };
  for (const element of ['title', 'subtitle', 'cta'] as const) {
    const desktop = elementLayout(banner, element, 'desktop');
    const mobile = elementLayout(banner, element, 'mobile');
    style[`--${element}-x`] = `${desktop.x}%`; style[`--${element}-y`] = `${desktop.y}%`;
    style[`--${element}-width`] = `${desktop.width}%`; style[`--${element}-scale`] = desktop.scale / 100;
    style[`--mobile-${element}-x`] = `${mobile.x}%`; style[`--mobile-${element}-y`] = `${mobile.y}%`;
    style[`--mobile-${element}-width`] = `${mobile.width}%`; style[`--mobile-${element}-scale`] = mobile.scale / 100;
  }
  return style as CSSProperties;
}

export default function BannerRenderer({ banner, viewport = 'auto', className = '', selected = null, onEditPointerDown, onSelect, showSafeRegion = false }: {
  banner: HomepageBanner;
  viewport?: BannerViewport | 'auto';
  className?: string;
  selected?: BannerEditableElement | null;
  onEditPointerDown?: (element: BannerEditableElement, action: EditAction, event: ReactPointerEvent<HTMLElement>) => void;
  onSelect?: (element: BannerEditableElement) => void;
  showSafeRegion?: boolean;
}) {
  const editable = Boolean(onEditPointerDown && onSelect);
  const title = banner.title?.trim() || '';
  const subtitle = banner.subtitle?.trim() || '';
  const cta = banner.cta_text?.trim() || '';
  const hasCta = Boolean(cta && banner.link_url);
  const hasCopy = Boolean(title || subtitle || hasCta);
  const editProps = (element: BannerEditableElement) => editable ? {
    'data-edit-element': element,
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
      event.preventDefault(); event.stopPropagation(); onSelect?.(element); onEditPointerDown?.(element, 'move', event);
    },
  } : {};
  const handles = (element: BannerEditableElement) => editable && selected === element ? ['nw', 'ne', 'sw', 'se'].map((corner) => (
    <button key={corner} type="button" aria-label={`Изменить размер: ${corner}`} className={`banner-edit-handle is-${corner}`}
      onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); onEditPointerDown?.(element, 'resize', event); }} />
  )) : null;
  const selectedClass = (element: BannerEditableElement) => `${selected === element ? ' is-selected' : ''}${editable ? ' is-editable' : ''}`;
  return (
    <div className={`banner-renderer banner-renderer--${banner.slot} banner-renderer--${viewport} ${className}`.trim()} style={variables(banner)}>
      <div className={`banner-renderer-image${selectedClass('image')}`} {...editProps('image')}>
        {banner.image_url && banner.fit_mode === 'contain' && banner.contain_background === 'blur' && (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="banner-renderer-blur" src={banner.image_url} alt="" aria-hidden="true" referrerPolicy="no-referrer" />
        )}
        {banner.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className={`banner-renderer-photo is-${banner.fit_mode}`} src={banner.image_url} alt={banner.alt_text || ''} referrerPolicy="no-referrer" />
        ) : <div className="banner-renderer-empty">Изображение не задано</div>}
        {handles('image')}
      </div>
      {hasCopy && banner.image_url && banner.overlay_enabled && <div className="banner-renderer-overlay" style={{ background: overlayBackground(banner) }} />}
      {title && <div className={`banner-renderer-element banner-renderer-title${selectedClass('title')}`} {...editProps('title')}><h2 style={{ color: banner.text_color, textAlign: banner.text_align, fontSize: `${banner.title_size}px` }}>{title}</h2>{handles('title')}</div>}
      {subtitle && <div className={`banner-renderer-element banner-renderer-subtitle${selectedClass('subtitle')}`} {...editProps('subtitle')}><p style={{ color: banner.text_color, textAlign: banner.text_align, fontSize: `${banner.subtitle_size}px` }}>{subtitle}</p>{handles('subtitle')}</div>}
      {hasCta && <div className={`banner-renderer-element banner-renderer-cta-wrap${selectedClass('cta')}`} {...editProps('cta')}>{editable ? <span className="banner-renderer-cta">{cta}</span> : <a className="banner-renderer-cta" href={banner.link_url || '#'}>{cta}</a>}{handles('cta')}</div>}
      {showSafeRegion && <div className="banner-renderer-safe-region"><span>Безопасная зона</span></div>}
    </div>
  );
}
