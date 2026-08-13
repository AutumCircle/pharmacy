import Image from 'next/image';
import Link from 'next/link';
import { SITE_FOOTER } from '@/config/site-footer';

export default function Footer() {
  return (
    <footer className="site-footer">
      <div className="container footer-grid">
        <div className="footer-brand">
          <Link href="/" className="footer-logo" aria-label="Аптека Ватан — главная">
            <Image src="/brand/vatan-apteka-logo.png" alt="" width={52} height={52} />
            <Image src="/brand/vatan-apteka-name.png" alt="Аптека Ватан" width={145} height={50} />
          </Link>
          <p>{SITE_FOOTER.description}</p>
        </div>

        <div className="footer-column">
          <h2>Контакты</h2>
          <p>{SITE_FOOTER.address}</p>
          <a className="footer-contact-link" href={SITE_FOOTER.phoneHref}>{SITE_FOOTER.phoneLabel}</a>
          <a className="footer-contact-link" href={`mailto:${SITE_FOOTER.email}`}>{SITE_FOOTER.email}</a>
        </div>

        <div className="footer-column">
          <h2>Режим работы</h2>
          <p>{SITE_FOOTER.workingDays}</p>
          <p><strong>{SITE_FOOTER.workingHours}</strong></p>
        </div>

        <div className="footer-column">
          <h2>Полезные ссылки</h2>
          {SITE_FOOTER.usefulLinks.map((item) => <Link key={item.href} href={item.href}>{item.label}</Link>)}
        </div>

        <div className="footer-column">
          <h2>Мы в социальных сетях</h2>
          <div className="footer-socials">
            {SITE_FOOTER.socialLinks.map((item) => (
              <a key={item.label} href={item.href} target="_blank" rel="noopener noreferrer">{item.label}</a>
            ))}
          </div>
        </div>
      </div>
      <div className="footer-bottom">
        <div className="container footer-bottom-content">
          <span>© {new Date().getFullYear()} {SITE_FOOTER.pharmacyName}. Все права защищены.</span>
          <span>{SITE_FOOTER.disclaimer}</span>
        </div>
      </div>
    </footer>
  );
}
