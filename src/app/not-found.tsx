import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="container" style={{ padding: '80px 0', textAlign: 'center', minHeight: '60vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
      <h1 style={{ fontSize: '4rem', color: 'var(--primary)', margin: '0 0 20px 0' }}>404</h1>
      <h2 style={{ marginBottom: '15px' }}>Страница не найдена</h2>
      <p style={{ color: '#666', marginBottom: '30px' }}>
        Возможно, она была удалена или вы перешли по неверной ссылке.
      </p>
      <Link 
        href="/" 
        className="pagination button" 
        style={{ padding: '12px 30px', background: 'var(--primary)', color: 'white', borderRadius: '8px' }}
      >
        Вернуться на главную
      </Link>
    </div>
  );
}
