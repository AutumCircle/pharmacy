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
      <svg viewBox="0 0 48 48" aria-hidden="true">
        <path fill="currentColor" d="M17 8h14v5h3.5A4.5 4.5 0 0 1 39 17.5v21a4.5 4.5 0 0 1-4.5 4.5h-21A4.5 4.5 0 0 1 9 38.5v-21a4.5 4.5 0 0 1 4.5-4.5H17V8Zm4 8h6v-4h-6v4Z" />
        <path fill="#fff" d="M21 21h6v5h5v6h-5v5h-6v-5h-5v-6h5v-5Z" />
      </svg>
    );
  }
  if (type === 'care') {
    return (
      <svg viewBox="0 0 48 48" aria-hidden="true">
        <path fill="currentColor" d="M24 4C18 13 10 20 10 29a14 14 0 0 0 28 0c0-9-8-16-14-25Z" />
        <path fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" d="M17.5 29.5c1.2 4.2 4.2 6.5 8.5 7" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true">
      <path fill="currentColor" d="M5 8a3 3 0 0 1 3-3h15.6c1.6 0 3.1.6 4.2 1.8l14.4 14.4a4 4 0 0 1 0 5.6L26.8 42.2a4 4 0 0 1-5.6 0L6.8 27.8A6 6 0 0 1 5 23.6V8Z" />
      <circle cx="15" cy="15" r="3.2" fill="#fff" />
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
