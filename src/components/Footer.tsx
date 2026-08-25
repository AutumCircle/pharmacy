import { SITE_FOOTER } from '@/config/site-footer';

export default function Footer() {
  return (
    <footer className="site-footer">
      <div className="container footer-compact-grid">
        <section className="footer-compact-section">
          <h2>Адрес</h2>
          <p className="footer-address">{SITE_FOOTER.address}</p>
        </section>

        <section className="footer-compact-section">
          <h2>Телефоны</h2>
          <div className="footer-phone-list">
            {SITE_FOOTER.phones.map((phone) => (
              <a className="footer-contact-link" href={phone.href} key={phone.href}>{phone.label}</a>
            ))}
          </div>
        </section>

        <section className="footer-compact-section">
          <h2>Режим работы</h2>
          <p><strong>{SITE_FOOTER.workingHours}</strong></p>
        </section>

        <section className="footer-compact-section">
          <h2>Социальная сеть</h2>
          <a className="footer-instagram" href={SITE_FOOTER.instagram} target="_blank" rel="noopener noreferrer" aria-label="Instagram аптеки Ватан">
            <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
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
