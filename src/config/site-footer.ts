export const SITE_FOOTER = {
  pharmacyName: 'Аптека Ватан',
  description: 'Лекарства и товары для здоровья в одном месте.',
  address: 'г. Душанбе, проспект Рудаки, 00',
  phoneLabel: '+992 00 000 00 00',
  phoneHref: 'tel:+992000000000',
  email: 'info@vatan.tj',
  workingDays: 'Понедельник–воскресенье',
  workingHours: '08:00–22:00',
  socialLinks: [
    { label: 'Instagram', href: 'https://instagram.com/' },
    { label: 'Facebook', href: 'https://facebook.com/' },
    { label: 'Telegram', href: 'https://t.me/' },
  ],
  usefulLinks: [
    { label: 'Главная', href: '/' },
    { label: 'Каталог', href: '/catalog' },
    { label: 'Корзина', href: '/cart' },
    { label: 'Мои заказы', href: '/tracking' },
  ],
  disclaimer: 'Информация на сайте не заменяет консультацию врача. Перед применением лекарственных средств проконсультируйтесь со специалистом.',
} as const;
