'use client';

import { useState } from 'react';
import { parseOrderQuantity, shiftOrderQuantity } from '@/lib/order-quantity';
import { quantityLabel } from '../format';

export default function QuantityStepper({ value, onChange, disabled = false }: {
  value: number; onChange: (value: number) => void; disabled?: boolean;
}) {
  const [draft, setDraft] = useState(String(value));
  const [invalid, setInvalid] = useState(false);
  const [previousValue, setPreviousValue] = useState(value);
  if (value !== previousValue) {
    setPreviousValue(value);
    setDraft(String(value));
  }

  function commit() {
    const parsed = parseOrderQuantity(draft);
    if (parsed === null) { setDraft(String(value)); setInvalid(true); return; }
    setInvalid(false);
    setDraft(String(parsed));
    if (parsed !== value) onChange(parsed);
  }

  function step(direction: -1 | 1) {
    const next = shiftOrderQuantity(value, direction);
    setInvalid(false);
    setDraft(String(next));
    onChange(next);
  }

  return <div className="mp-stepper" role="group" aria-label="Количество">
    <button type="button" aria-label="Меньше на 0,1" disabled={disabled || value <= 0.1} onClick={() => step(-1)}>−</button>
    <input aria-label="Количество, шаг кнопок 0,1" aria-invalid={invalid} title="От 0,1 до 99, до двух знаков после запятой"
      inputMode="decimal" value={draft} disabled={disabled} onChange={(event) => {
        const input = event.target.value;
        setDraft(input);
        setInvalid(false);
        const parsed = parseOrderQuantity(input);
        if (parsed !== null && parsed !== value) onChange(parsed);
      }}
      onBlur={commit} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }} />
    <button type="button" aria-label="Больше на 0,1" disabled={disabled || value >= 99} onClick={() => step(1)}>+</button>
    <span className="sr-only" aria-live="polite">{invalid ? 'Введите количество от 0,1 до 99, до двух знаков после запятой' : quantityLabel(value)}</span>
  </div>;
}
