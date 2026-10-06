import Link from 'next/link';

export default function CollectionNotFound() {
  return (
    <div className="container" style={{ padding: '80px 0', textAlign: 'center', minHeight: '60vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
      <h1 style={{ fontSize: '4rem', color: 'var(--primary)', margin: '0 0 20px 0' }}>404</h1>
      <h2 style={{ marginBottom: '15px' }}>Подборка не найдена</h2>
      <p style={{ color: '#666', marginBottom: '30px' }}>
        Возможно, она уже закончилась или ссылка введена неверно. Весь ассортимент доступен в каталоге.
      </p>
      <Link href="/catalog" style={{ padding: '12px 30px', background: 'var(--primary)', color: 'white', borderRadius: '24px', fontWeight: 600 }}>
        В каталог
      </Link>
    </div>
  );
}
