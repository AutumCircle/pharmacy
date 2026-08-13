const benefits = [
  {
    title: 'Широкий ассортимент',
    text: 'Более 10 000 товаров для здоровья в актуальном каталоге.',
    icon: '✚',
  },
  {
    title: 'Доставка на дом',
    text: 'Быстрая и надёжная доставка по всему Душанбе до порога.',
    icon: '●',
  },
  {
    title: 'Выгодные цены',
    text: 'Качественные лекарства по доступным ценам для каждого.',
    icon: '★',
  },
];

export default function StoreBenefits() {
  return (
    <section className="store-benefits" aria-label="Преимущества аптеки">
      {benefits.map((benefit) => (
        <article className="store-benefit-card" key={benefit.title}>
          <span className="store-benefit-icon" aria-hidden="true">{benefit.icon}</span>
          <div>
            <h2>{benefit.title}</h2>
            <p>{benefit.text}</p>
          </div>
        </article>
      ))}
    </section>
  );
}
