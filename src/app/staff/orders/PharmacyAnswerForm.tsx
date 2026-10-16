'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import type { PharmacyAnswer } from '@/lib/api-v1/staff-types';
import {
  PHARMACY_ANSWER_LABELS, PHARMACY_PROBLEM_MAX, normalizeProblem, validatePharmacyAnswersRequest,
} from '@/lib/pharmacy-answers';

export type AnswerItem = { orderItemId: number; name: string; myAnswer: PharmacyAnswer | null; myProblem: string | null };

type Choice = { answer: PharmacyAnswer | ''; problem: string };

const choiceLabels: Record<PharmacyAnswer, string> = {
  available: 'В наличии',
  unavailable: PHARMACY_ANSWER_LABELS.unavailable,
  price_differs: PHARMACY_ANSWER_LABELS.price_differs,
};

/**
 * Pharmacist actions on a «Новый» order card (job 010). Step 1: «В наличии, цена верна» answers every
 * still-unanswered item of this pharmacy, or «Нет в наличии / цена отличается» opens a per-item choice.
 * The browser sends only item ids, answers and problem text; Lambda decides routing and amounts.
 */
export default function PharmacyAnswerForm({ orderId, items, pharmacyId }: {
  orderId: string; items: AnswerItem[]; pharmacyId?: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [choices, setChoices] = useState<Record<number, Choice>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const unanswered = items.filter((item) => item.myAnswer === null);
  const errorRef = useRef<HTMLParagraphElement>(null);

  // Move focus to a new error so keyboard and screen-reader users land on it.
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);

  function startProblems() {
    setChoices(Object.fromEntries(items.map((item) => [item.orderItemId,
      { answer: item.myAnswer ?? '', problem: item.myProblem ?? '' }])));
    setError('');
    setOpen(true);
  }

  async function submit(answers: Array<{ order_item_id: number; answer: PharmacyAnswer; problem?: string }>) {
    const checked = validatePharmacyAnswersRequest({ answers });
    if (!checked.ok) { setError(checked.error); return; }
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/staff/orders/${encodeURIComponent(orderId)}/pharmacy-answers`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(checked.value),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) {
        const fallback = response.status === 409 ? 'Заказ уже не новый — ответ не нужен.'
          : response.status === 403 ? 'Эта позиция уже передана другой аптеке.'
          : response.status === 404 ? 'Заказ или позиция не найдены.'
          : 'Не удалось отправить ответ. Повторите попытку.';
        setError(result?.error?.message || fallback);
        if ([403, 404, 409].includes(response.status)) router.refresh();
        return;
      }
      setOpen(false);
      router.refresh();
    } catch {
      setError('Нет связи. Повторите попытку.');
    } finally {
      setBusy(false);
    }
  }

  function sendAllAvailable() {
    void submit(unanswered.map((item) => ({ order_item_id: item.orderItemId, answer: 'available' as const })));
  }

  function sendChoices() {
    const answers: Array<{ order_item_id: number; answer: PharmacyAnswer; problem?: string }> = [];
    for (const item of items) {
      const choice = choices[item.orderItemId];
      if (!choice || !choice.answer) continue;
      const problem = choice.answer === 'available' ? '' : normalizeProblem(choice.problem);
      const unchanged = choice.answer === item.myAnswer && (problem || null) === (item.myProblem || null);
      if (unchanged) continue;
      answers.push({ order_item_id: item.orderItemId, answer: choice.answer, ...(problem ? { problem } : {}) });
    }
    if (!answers.length) { setError('Выберите ответ хотя бы по одной позиции.'); return; }
    const missing = answers.find((entry) => entry.answer === 'price_differs' && !entry.problem);
    if (missing) {
      const name = items.find((item) => item.orderItemId === missing.order_item_id)?.name ?? '';
      setError(`Опишите, чем отличается цена: ${name}`);
      return;
    }
    void submit(answers);
  }

  const setChoice = (id: number, patch: Partial<Choice>) =>
    setChoices((current) => ({ ...current, [id]: { ...(current[id] ?? { answer: '', problem: '' }), ...patch } }));

  if (!open) {
    return <div className="pa-actions">
      {unanswered.length > 0 && <button type="button" className="pa-btn pa-btn-ok" disabled={busy} onClick={sendAllAvailable}>
        {busy ? 'Отправляем…' : PHARMACY_ANSWER_LABELS.available}
        {unanswered.length < items.length && <small> · {unanswered.length} поз.</small>}
      </button>}
      <button type="button" className="pa-btn pa-btn-problem" disabled={busy} onClick={startProblems}>
        {unanswered.length > 0 ? 'Нет в наличии / цена отличается' : 'Изменить ответ'}
      </button>
      {error && <p className="pa-error" role="alert" tabIndex={-1} ref={errorRef}>{error}</p>}
    </div>;
  }

  return <div className="pa-panel">
    <p className="pa-panel-title">Ответ по каждой позиции</p>
    <ul className="pa-items">{items.map((item) => {
      const choice = choices[item.orderItemId] ?? { answer: '', problem: '' };
      const group = `pa-${orderId}-${item.orderItemId}`;
      return <li key={item.orderItemId} className="pa-item">
        <span className="pa-item-name">{item.name}</span>
        <div className="pa-options" role="radiogroup" aria-label={`Ответ: ${item.name}`}>
          {(['available', 'unavailable', 'price_differs'] as const).map((value) =>
            <label key={value} className={`pa-option pa-option-${value}${choice.answer === value ? ' selected' : ''}`}>
              <input type="radio" name={group} value={value} checked={choice.answer === value} disabled={busy}
                onChange={() => setChoice(item.orderItemId, { answer: value })} />
              {choiceLabels[value]}
            </label>)}
        </div>
        {choice.answer === 'unavailable' && pharmacyId === 1 &&
          <p className="pa-hint">Позиция автоматически уйдёт в «Ватан 2».</p>}
        {(choice.answer === 'unavailable' || choice.answer === 'price_differs') &&
          <label className="pa-problem">
            <span>{choice.answer === 'price_differs' ? 'Чем отличается цена?' : 'Комментарий (необязательно)'}</span>
            <input value={choice.problem} maxLength={PHARMACY_PROBLEM_MAX} disabled={busy} autoComplete="off"
              placeholder={choice.answer === 'price_differs' ? 'Например: цена 45 сом вместо 40' : 'Например: закончился'}
              onChange={(event) => setChoice(item.orderItemId, { problem: event.target.value })} />
          </label>}
      </li>;
    })}</ul>
    {error && <p className="pa-error" role="alert" tabIndex={-1} ref={errorRef}>{error}</p>}
    <div className="pa-actions">
      <button type="button" className="pa-btn pa-btn-ok" disabled={busy} onClick={sendChoices}>
        {busy ? 'Отправляем…' : 'Отправить ответ'}</button>
      <button type="button" className="pa-btn pa-btn-ghost" disabled={busy} onClick={() => { setOpen(false); setError(''); }}>
        Отмена</button>
    </div>
  </div>;
}
