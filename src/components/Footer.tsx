import Image from 'next/image';
import Link from 'next/link';
import { SITE_FOOTER } from '@/config/site-footer';

export default function Footer() {
  return (
    <footer className="site-footer">
      <div className="container footer-compact-grid">
        <section className="footer-compact-section footer-brand-section">
          <Link href="/" className="footer-brand-logo" aria-label="Аптека Ватан — главная">
            <Image className="footer-brand-mark" src="/brand/vatan-apteka-logo.png" alt="" width={34} height={34} />
            <Image className="footer-brand-name" src="/brand/vatan-apteka-name.png" alt="Аптека Ватан" width={104} height={36} />
          </Link>
          <p>{SITE_FOOTER.description}</p>
        </section>

        <section className="footer-compact-section">
          <h2>Меню</h2>
          <nav className="footer-menu" aria-label="Меню в подвале">
            {SITE_FOOTER.menu.map((item) => <Link key={item.href} href={item.href}>{item.label}</Link>)}
          </nav>
        </section>

        <section className="footer-compact-section">
          <h2>Контакты</h2>
          <p className="footer-address">{SITE_FOOTER.address}</p>
          <div className="footer-phone-list">
            {SITE_FOOTER.phones.map((phone) => (
              <a className="footer-contact-link" href={phone.href} key={phone.href}>{phone.label}</a>
            ))}
          </div>
        </section>

        <section className="footer-compact-section">
          <h2>Режим работы</h2>
          <p>{SITE_FOOTER.workingDays}</p>
          <p><strong>{SITE_FOOTER.workingHours}</strong></p>
        </section>

        <section className="footer-compact-section footer-social-section">
          <h2>Мы в соцсетях</h2>
          <a className="footer-instagram" href={SITE_FOOTER.instagram} target="_blank" rel="noopener noreferrer" aria-label="Instagram аптеки Ватан">
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="18" height="18" rx="5" />
              <circle cx="12" cy="12" r="4" />
              <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
            </svg>
            Instagram
          </a>
        </section>
      </div>
      <div className="footer-bottom">
        <div className="container">© {new Date().getFullYear()} {SITE_FOOTER.pharmacyName}. Все права защищены.</div>
      </div>
    </footer>
  );
}
