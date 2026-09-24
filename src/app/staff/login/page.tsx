'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function StaffLoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/staff/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ username, password }),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        setError(result.error || 'Ошибка входа');
        return;
      }
      router.replace('/staff/medicines');
      router.refresh();
    } catch {
      setError('Ошибка сети');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="staff-login-page">
      <div className="staff-login-card">
        <div className="staff-login-heading">
          <div className="staff-logo">V</div>
          <h1>Vatan Pharmacy</h1>
          <p>Каталог для работников аптеки</p>
        </div>
        <form onSubmit={handleSubmit}>
          <label>Логин<input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" required /></label>
          <label>Пароль<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required /></label>
          {error && <div className="staff-login-error">{error}</div>}
          <button type="submit" disabled={loading}>{loading ? 'Вход…' : 'Войти'}</button>
        </form>
      </div>
    </div>
  );
}
