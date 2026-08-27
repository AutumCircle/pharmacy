import Link from 'next/link';
import type { AdminHomepageBanner } from '@/lib/api-v1/admin-types';
import BannerAdminPreview from './BannerAdminPreview';
import { bannerSlotNames } from './banner-config';

function formatUpdatedAt(value: string): string {
  return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

export default function BannersClient({ banners }: { banners: AdminHomepageBanner[] }) {
  return (
    <div>
      <div className="admin-banner-page-heading">
        <div>
          <h1>Баннеры главной страницы</h1>
          <p>Выберите баннер, чтобы открыть большой preview и настройки изображения, текста и overlay.</p>
        </div>
      </div>
      <div className="admin-banner-card-list">
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
      </div>
    </div>
  );
}
