'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function AdminLogin() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      });

      if (res.ok) {
        router.push('/admin');
        router.refresh();
      } else {
        const data = await res.json();
        setError(data.error || 'Ошибка входа');
      }
    } catch (err) {
      setError('Ошибка сети');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f5f5f7' }}>
      <div style={{ background: 'white', padding: '40px', borderRadius: '16px', boxShadow: '0 4px 20px rgba(0,0,0,0.05)', width: '100%', maxWidth: '400px' }}>
        <div style={{ textAlign: 'center', marginBottom: '30px' }}>
          <h1 style={{ fontSize: '24px', fontWeight: 'bold', color: '#111', marginBottom: '10px' }}>Панель управления</h1>
          <p style={{ color: '#666', fontSize: '14px' }}>Введите пароль администратора для доступа</p>
        </div>
        
        <form onSubmit={handleLogin}>
          <div style={{ marginBottom: '20px' }}>
            <input 
              type="password" 
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Пароль" 
              required
              style={{ width: '100%', padding: '15px', borderRadius: '12px', border: '1px solid #e0e0e0', outline: 'none', fontSize: '16px' }}
            />
          </div>
          
          {error && <div style={{ color: '#d32f2f', marginBottom: '20px', fontSize: '14px', textAlign: 'center' }}>{error}</div>}
          
          <button 
            type="submit" 
            disabled={loading}
            style={{ 
              width: '100%', 
              padding: '15px', 
              background: 'var(--primary)', 
              color: 'white', 
              border: 'none', 
              borderRadius: '12px', 
              fontSize: '16px', 
              fontWeight: 600, 
              cursor: loading ? 'not-allowed' : 'pointer'
            }}
          >
            {loading ? 'Вход...' : 'Войти'}
          </button>
        </form>
      </div>
    </div>
  );
}
