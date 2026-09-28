'use client';

import { useState } from 'react';
import type { StaffAccount } from '@/lib/api-v1/staff-types';
import { saveStaffAccount } from './actions';

function AccountForm({ account }: { account: StaffAccount }) {
  const [username, setUsername] = useState(account.username);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      const result = await saveStaffAccount(account.account_id, username, password || undefined);
      setMessage(result.error || 'Изменения сохранены. Сотруднику нужно войти снова.');
    } catch {
      setMessage('Не удалось сохранить изменения. Повторите попытку.');
    } finally {
      setPassword('');
      setBusy(false);
    }
  }
  return <form onSubmit={submit} style={{ maxWidth: 560, background: 'white', padding: 24, borderRadius: 12, marginBottom: 20, display: 'grid', gap: 12 }}>
    <h2>Сотрудник {account.account_id}</h2>
    <p>{account.catalog_access ? 'Каталог аптеки — только просмотр' : 'Доступ пока не предоставлен'}</p>
    <label htmlFor={`login-${account.account_id}`}>Логин</label>
    <input id={`login-${account.account_id}`} value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" pattern="[A-Za-z0-9_.\-]{3,64}" minLength={3} maxLength={64} required disabled={busy} />
    <p aria-label="Пароль установлен">•••••••• — пароль установлен</p>
    <label htmlFor={`password-${account.account_id}`}>Новый пароль (оставьте пустым, чтобы сохранить текущий)</label>
    <input id={`password-${account.account_id}`} type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={14} maxLength={128} disabled={busy} />
    <small>14–128 символов: строчная и заглавная латинские буквы, цифра и специальный символ.</small>
    <button type="submit" disabled={busy}>{busy ? 'Сохранение…' : 'Сохранить'}</button>
    <p role="status">{message}</p>
  </form>;
}

export default function StaffAccounts({ accounts }: { accounts: StaffAccount[] }) {
  return <>{accounts.map((account) => <AccountForm key={account.account_id} account={account} />)}</>;
}
