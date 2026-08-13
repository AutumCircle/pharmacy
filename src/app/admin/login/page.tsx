'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function AdminLogin() {
  const [username, setUsername] = useState('');
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
        credentials: 'same-origin',
        body: JSON.stringify({ username, password })
      });

      if (res.ok) {
        router.replace('/admin');
        router.refresh();
      } else {
        const data = await res.json();
        setError(data.error || 'Ошибка входа');
      }
    } catch {
      setError('Ошибка сети');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="admin-login-page">
      <div className="admin-login-card">
        <div style={{ textAlign: 'center', marginBottom: '30px' }}>
          <h1 style={{ fontSize: '24px', fontWeight: 'bold', color: '#111', marginBottom: '10px' }}>Панель управления</h1>
          <p style={{ color: '#666', fontSize: '14px' }}>Введите логин и пароль администратора</p>
        </div>
        
        <form onSubmit={handleLogin}>
          <div style={{ marginBottom: '15px' }}>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Логин"
              autoComplete="username"
              required
              style={{ width: '100%', padding: '15px', borderRadius: '12px', border: '1px solid #e0e0e0', outline: 'none', fontSize: '16px' }}
            />
          </div>
          <div style={{ marginBottom: '20px' }}>
            <input 
              type="password" 
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Пароль" 
              autoComplete="current-password"
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
