import Link from 'next/link';
import type { AdminHomepageBanner } from '@/lib/api-v1/admin-types';
import BannerAdminPreview from './BannerAdminPreview';
import { bannerSlotNames } from './banner-config';

function formatUpdatedAt(value: string): string {
  return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

export default function BannersClient({ banners }: { banners: AdminHomepageBanner[] }) {
  const preview = (slot: AdminHomepageBanner['slot']) => {
    const banner = banners.find(item => item.slot === slot);
    return banner ? <Link className="admin-banner-overview-link" href={`/admin/banners/${slot}`} aria-label={`Редактировать: ${bannerSlotNames[slot]}`}>
      <BannerAdminPreview banner={banner} mode={slot === 'mobile' ? 'mobile' : 'desktop'} />
      <span className="admin-banner-overview-label">{bannerSlotNames[slot]} · {banner.is_active ? 'Активен' : 'Черновик'}</span>
    </Link> : <Link href={`/admin/banners/${slot}`}>{bannerSlotNames[slot]} — добавить</Link>;
  };
  return (
    <div>
      <div className="admin-banner-page-heading">
        <div>
          <h1>Баннеры главной страницы</h1>
          <p>Четыре баннера для компьютера и один отдельный для смартфонов. Выберите баннер, загрузите изображение и проверьте предпросмотр. Заголовки необязательны.</p>
        </div>
      </div>
      <section className="admin-banner-overview">
        <h2>Предпросмотр для компьютера</h2>
        <p>Нажмите на изображение, чтобы открыть редактор. Черновики показаны здесь для редактирования; на сайте видны только активные баннеры.</p>
        <div className="hero-desktop-layout">
          <div className="hero-banner-cell hero-desktop-left">{preview('left')}</div>
          <div className="hero-banner-cell hero-desktop-center">{preview('center')}</div>
          <div className="right-banners"><div className="hero-banner-cell">{preview('right_top')}</div><div className="hero-banner-cell">{preview('right_bottom')}</div></div>
        </div>
      </section>
      <section className="admin-banner-overview">
        <h2>Предпросмотр для телефона</h2>
        <div className="admin-banner-phone-preview">{preview('mobile')}</div>
      </section>
      <details><summary>Список баннеров и даты обновления</summary><div className="admin-banner-card-list">
        {banners.map((banner) => (
          <article className="admin-banner-summary-card" key={banner.slot}>
            <div className="admin-banner-summary-preview"><BannerAdminPreview banner={banner} compact /></div>
            <div className="admin-banner-summary-body">
              <div className="admin-banner-summary-title-row">
                <div>
                  <span className="admin-banner-slot-code">{banner.slot}</span>
                  <h2>{bannerSlotNames[banner.slot]}</h2>
                </div>
                <span className={`admin-banner-status ${banner.is_active ? 'is-active' : 'is-draft'}`}>{banner.is_active ? 'Активен' : 'Черновик'}</span>
              </div>
              <p className="admin-banner-summary-meta">Обновлён: {formatUpdatedAt(banner.updated_at)}</p>
              <Link className="admin-banner-edit-link" href={`/admin/banners/${banner.slot}`}>Редактировать</Link>
            </div>
          </article>
        ))}
      </div></details>
    </div>
  );
}
