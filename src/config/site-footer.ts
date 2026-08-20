export const SITE_FOOTER = {
  pharmacyName: 'Аптека Ватан',
  description: 'Лекарства и товары для здоровья в одном месте.',
  highlights: [
    'Большой ассортимент лекарств',
    'БАДы и дермокосметика',
  ],
  address: 'г. Душанбе, ул. Айни, 29',
  phones: [
    { label: '+992 44 625 00 77', href: 'tel:+992446250077' },
    { label: '+992 71 050 05 00', href: 'tel:+992710500500' },
    { label: '+992 71 550 05 00', href: 'tel:+992715500500' },
  ],
  workingDays: 'Ежедневно',
  workingHours: '07:00–01:00',
  socialLinks: [
    { label: 'Instagram', href: 'https://www.instagram.com/aptekavatan/' },
  ],
  usefulLinks: [
    { label: 'Главная', href: '/' },
    { label: 'Каталог', href: '/catalog' },
    { label: 'Корзина', href: '/cart' },
    { label: 'Мои заказы', href: '/tracking' },
  ],
  disclaimer: 'Информация на сайте не заменяет консультацию врача. Перед применением лекарственных средств проконсультируйтесь со специалистом.',
} as const;
