import React from 'react';

export default function HeroBanners() {
  const bannerLogo = (
    <div style={{ position: 'absolute', top: '15px', left: '15px', background: 'white', borderRadius: '50%', width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--primary)', boxShadow: '0 2px 5px rgba(0,0,0,0.1)' }}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"></path></svg>
    </div>
  );

  return (
    <section className="hero-grid">
      <div className="banner left-banner" style={{ paddingTop: '60px' }}>
        {bannerLogo}
        <div className="banner-content">
          <h2 style={{ fontSize: '24px', fontWeight: '500', color: '#444' }}>Витамины, минералы и добавки</h2>
          <div className="banner-image" style={{ marginTop: 'auto' }}>
             <div style={{ width: '100%', height: '160px', backgroundColor: '#e0e0e0', borderRadius: '8px', marginTop: '20px' }}></div>
          </div>
        </div>
      </div>
      
      <div className="banner center-banner" style={{ paddingTop: '60px' }}>
        {bannerLogo}
        <div className="banner-content" style={{ display: 'flex' }}>
          <div style={{ flex: 1 }}>
            <h2 style={{ fontSize: '24px', fontWeight: 'bold' }}>Скидка на все виды<br/>лекарств</h2>
            <ul style={{ marginTop: '20px' }}>
              <li>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                Без выходных
              </li>
              <li>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
                Работаем днем и ночью
              </li>
              <li>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"></circle><path d="M8 14s1.5 2 4 2 4-2 4-2"></path><line x1="9" y1="9" x2="9.01" y2="9"></line><line x1="15" y1="9" x2="15.01" y2="9"></line></svg>
                Доставим быстро
              </li>
            </ul>
          </div>
           <div className="banner-image" style={{ width: '140px' }}>
              <div style={{ width: '100%', height: '180px', backgroundColor: '#D32F2F', borderRadius: '8px', boxShadow: '-10px 10px 20px rgba(0,0,0,0.2)' }}></div>
           </div>
        </div>
      </div>

      <div className="right-banners">
        <div className="banner right-top-banner" style={{ paddingTop: '50px' }}>
           {bannerLogo}
           <h3 style={{ fontSize: '20px', fontWeight: 'bold', color: '#333' }}>Лучшие цены на<br/>лекарства</h3>
        </div>
        <div className="banner right-bottom-banner" style={{ paddingTop: '50px', display: 'flex', alignItems: 'flex-end', justifyContent: 'flex-end' }}>
           {bannerLogo}
           <h3 style={{ fontSize: '20px', fontWeight: 'bold', color: '#333', position: 'absolute', right: '20px', bottom: '20px', margin: 0 }}>Бонус<br/>к чеку</h3>
        </div>
      </div>
    </section>
  );
}
