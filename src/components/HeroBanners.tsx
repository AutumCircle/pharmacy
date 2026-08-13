import type { HomepageBanner, HomepageBannerSlot } from '@/lib/api-v1/types';
import type { CSSProperties } from 'react';

const defaults: Record<HomepageBannerSlot, HomepageBanner> = {
  left: { slot: 'left', title: 'Витамины, минералы и добавки', subtitle: null, image_url: null, link_url: null },
  center: { slot: 'center', title: 'Скидка на все виды лекарств', subtitle: 'Без выходных · Работаем днём и ночью · Доставим быстро', image_url: null, link_url: null },
  right_top: { slot: 'right_top', title: 'Лучшие цены на лекарства', subtitle: null, image_url: null, link_url: null },
  right_bottom: { slot: 'right_bottom', title: 'Бонус к чеку', subtitle: null, image_url: null, link_url: null },
};

function Banner({ banner, className }: { banner: HomepageBanner; className: string }) {
  const style = {
    position: 'relative' as const,
    overflow: 'hidden',
    padding: 24,
    minHeight: className.startsWith('right') ? 150 : 330,
    color: 'inherit',
    textDecoration: 'none',
  };
  const content = (
    <>
      {banner.image_url && (
        // URLs are validated as HTTPS by the admin Lambda. Images live outside Vercel's ephemeral filesystem.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={banner.image_url} alt="" referrerPolicy="no-referrer" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
      )}
      <div style={{ position: 'absolute', inset: 0, background: banner.image_url ? 'linear-gradient(90deg, rgba(255,255,255,.94), rgba(255,255,255,.18))' : 'transparent' }} />
      <div style={{ position: 'relative', zIndex: 1, maxWidth: '75%' }}>
        <h2 style={{ margin: 0, fontSize: className.startsWith('right') ? 20 : 26, color: '#333' }}>{banner.title}</h2>
        {banner.subtitle && <p style={{ marginTop: 14, color: '#555', lineHeight: 1.5 }}>{banner.subtitle}</p>}
      </div>
    </>
  );
  return banner.link_url
    ? <a href={banner.link_url} className={`banner ${className}`} style={style}>{content}</a>
    : <div className={`banner ${className}`} style={style}>{content}</div>;
}

export default function HeroBanners({ banners }: { banners?: HomepageBanner[] }) {
  const usingFallback = banners === undefined;
  const bySlot = new Map((banners || []).map((banner) => [banner.slot, banner]));
  const banner = (slot: HomepageBannerSlot) => bySlot.get(slot) || (usingFallback ? defaults[slot] : null);
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
