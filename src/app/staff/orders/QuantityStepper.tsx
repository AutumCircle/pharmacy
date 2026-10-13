'use client';

import { quantityLabel } from '../format';

export function stepDown(quantity: number) { return quantity > 1 ? quantity - 1 : 0.5; }
export function stepUp(quantity: number) { return quantity < 1 ? 1 : Math.min(99, quantity + 1); }

export default function QuantityStepper({ value, onChange, disabled = false }: {
  value: number; onChange: (value: number) => void; disabled?: boolean;
}) {
  return <div className="mp-stepper" role="group" aria-label="Количество">
    <button type="button" aria-label="Меньше" disabled={disabled || value <= 0.5} onClick={() => onChange(stepDown(value))}>−</button>
    <output aria-live="polite">{quantityLabel(value)}</output>
    <button type="button" aria-label="Больше" disabled={disabled || value >= 99} onClick={() => onChange(stepUp(value))}>+</button>
  </div>;
}
