const benefits = [
  {
    title: 'Более 11 000 лекарств',
    text: 'Один из крупнейших актуальных ассортиментов лекарств в Душанбе.',
    icon: 'assortment',
  },
  {
    title: 'БАДы и дермокосметика',
    text: 'Один из самых больших ассортиментов БАДов и дермокосметики в Душанбе.',
    icon: 'care',
  },
  {
    title: 'Выгодные цены',
    text: 'Хорошие цены на лекарства и товары для здоровья без лишней переплаты.',
    icon: 'price',
  },
] as const;

function BenefitIcon({ type }: { type: typeof benefits[number]['icon'] }) {
  if (type === 'assortment') {
    return (
      <svg width="50" height="50" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true">
        <circle cx="24" cy="24" r="18" />
        <path d="m15.5 24 5.5 5.5L33.5 17" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (type === 'care') {
    return (
      <svg width="50" height="50" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true">
        <rect x="14" y="8" width="20" height="32" rx="5" />
        <path d="M20 8V5h8v3M24 18v12M18 24h12" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg width="50" height="50" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true">
      <path d="M7 22V10h12l21 21-9 9L10 19V7" strokeLinejoin="round" />
      <circle cx="14" cy="14" r="2.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

export default function StoreBenefits() {
  return (
    <section className="store-benefits" aria-label="Преимущества аптеки">
      {benefits.map((benefit) => (
        <article className="store-benefit-card" key={benefit.title}>
          <span className="store-benefit-icon"><BenefitIcon type={benefit.icon} /></span>
          <div>
            <h2>{benefit.title}</h2>
            <p>{benefit.text}</p>
          </div>
        </article>
      ))}
    </section>
  );
}
