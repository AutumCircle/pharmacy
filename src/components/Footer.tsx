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
          <ul className="footer-highlights">
            {SITE_FOOTER.highlights.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </div>

        <div className="footer-column">
          <h2>Контакты</h2>
          <p className="footer-address">{SITE_FOOTER.address}</p>
          <div className="footer-phone-list">
            {SITE_FOOTER.phones.map((phone) => (
              <a className="footer-contact-link" href={phone.href} key={phone.href}>{phone.label}</a>
            ))}
          </div>
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
              <a key={item.label} href={item.href} target="_blank" rel="noopener noreferrer" aria-label="Instagram аптеки Ватан">
                <svg aria-hidden="true" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="3" width="18" height="18" rx="5" />
                  <circle cx="12" cy="12" r="4" />
                  <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
                </svg>
                {item.label}
              </a>
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
