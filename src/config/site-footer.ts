export const SITE_FOOTER = {
  pharmacyName: 'Аптека Ватан',
  description: 'Лекарства и товары для здоровья в одном месте.',
  address: 'Душанбе, ул. Айни 29',
  phones: [
    { label: '+992 44 625 00 77', href: 'tel:+992446250077' },
    { label: '+992 71 050 05 00', href: 'tel:+992710500500' },
    { label: '+992 71 550 05 00', href: 'tel:+992715500500' },
  ],
  workingDays: 'Ежедневно',
  workingHours: '07:00–01:00',
  instagram: 'https://www.instagram.com/aptekavatan/',
  menu: [
    { label: 'Главная', href: '/' },
    { label: 'Каталог', href: '/catalog' },
    { label: 'Корзина', href: '/cart' },
    { label: 'Мои заказы', href: '/tracking' },
  ],
} as const;
