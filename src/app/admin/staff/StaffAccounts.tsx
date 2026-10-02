'use client';

import { useState } from 'react';
import type { StaffAccount } from '@/lib/api-v1/staff-types';

function AccountForm({ account }: { account: StaffAccount }) {
  const [username, setUsername] = useState(account.username);
  const [password, setPassword] = useState('');
  const [passwordSet, setPasswordSet] = useState(account.password_set);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch(`/api/admin/staff/${account.account_id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, ...(password ? { password } : {}) }),
      });
      const result: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const payload = result && typeof result === 'object' ? result as { error?: { message?: string } | string } : {};
        const error = typeof payload.error === 'string' ? payload.error : payload.error?.message;
        throw new Error(error || 'Не удалось сохранить изменения');
      }
      setMessage('Изменения сохранены. Сотруднику нужно войти снова.');
      if (password) setPasswordSet(true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Не удалось сохранить изменения. Повторите попытку.');
    } finally {
      setPassword('');
      setBusy(false);
    }
  }
  return <form onSubmit={submit} style={{ maxWidth: 560, background: 'white', padding: 24, borderRadius: 12, marginBottom: 20, display: 'grid', gap: 12 }}>
    <h2>{account.role === 'courier' ? 'Доставщик' : `Аптека ${account.account_id}`}</h2>
    <p>{account.role === 'courier' ? 'Только создание заказов, список и статусы доставки. Каталог и админ-панель закрыты.'
      : account.catalog_access ? 'Каталог аптеки — только просмотр' : 'Доступ к каталогу пока не предоставлен'}</p>
    <label htmlFor={`login-${account.account_id}`}>Логин</label>
    <input id={`login-${account.account_id}`} value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" pattern="[A-Za-z0-9_.\-]{3,64}" minLength={3} maxLength={64} required disabled={busy} />
    <p aria-label={passwordSet ? 'Пароль установлен' : 'Пароль не установлен'}>
      {passwordSet ? '•••••••• — пароль установлен' : 'Пароль не установлен. Задайте его, чтобы доставщик смог войти.'}
    </p>
    <label htmlFor={`password-${account.account_id}`}>Новый пароль (оставьте пустым, чтобы сохранить текущий)</label>
    <input id={`password-${account.account_id}`} type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={6} maxLength={128} required={!passwordSet} disabled={busy} />
    <small>От 6 до 128 символов.</small>
    <button type="submit" disabled={busy}>{busy ? 'Сохранение…' : 'Сохранить'}</button>
    <p role="status">{message}</p>
  </form>;
}

export default function StaffAccounts({ accounts }: { accounts: StaffAccount[] }) {
  return <>{accounts.map((account) => <AccountForm key={account.account_id} account={account} />)}</>;
}
