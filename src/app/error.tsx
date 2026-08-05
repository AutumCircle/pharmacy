'use client';

import { useEffect } from 'react';
import Link from 'next/link';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('App Error:', error);
  }, [error]);

  return (
    <div className="container" style={{ padding: '60px 0', textAlign: 'center', minHeight: '60vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ color: '#E31E24', marginBottom: '20px' }}>
        <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
      </div>
      <h2 style={{ marginBottom: '10px' }}>Произошла ошибка при загрузке</h2>
      <p style={{ color: '#666', marginBottom: '30px', maxWidth: '500px' }}>
        {error.message.includes('timeout') || error.message.includes('fetch') 
          ? 'Не удалось связаться с сервером. Пожалуйста, проверьте подключение или подождите немного.' 
          : 'Что-то пошло не так. Мы уже работаем над исправлением этой ошибки.'}
      </p>
      <div style={{ display: 'flex', gap: '15px' }}>
        <button 
          onClick={() => reset()} 
          className="pagination button" 
          style={{ padding: '12px 24px', background: 'var(--primary)', color: 'white' }}
        >
          Попробовать снова
        </button>
        <Link 
          href="/" 
          className="pagination button" 
          style={{ padding: '12px 24px' }}
        >
          На главную
        </Link>
      </div>
    </div>
  );
}
