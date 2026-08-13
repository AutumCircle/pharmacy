'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { deleteOrder } from './actions';

export default function OrderDeleteButton({
  orderId,
  orderReference,
  onDeleted,
  redirectTo,
}: {
  orderId: string;
  orderReference: string;
  onDeleted?: () => void;
  redirectTo?: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remove = async () => {
    if (!window.confirm(`Удалить заказ ${orderReference}?\n\nОн исчезнет из рабочих списков, но история и состав заказа сохранятся.`)) return;
    setPending(true);
    setError(null);
    const result = await deleteOrder(orderId);
    if (result.success) {
      onDeleted?.();
      if (redirectTo) router.push(redirectTo);
      router.refresh();
    } else {
      setError(result.error || 'Не удалось удалить заказ');
    }
    setPending(false);
  };

  return (
    <span className="admin-delete-action">
      <button className="admin-danger-button" type="button" disabled={pending} onClick={remove}>
        {pending ? 'Удаление…' : 'Удалить заказ'}
      </button>
      {error && <span className="admin-inline-error" role="alert">{error}</span>}
    </span>
  );
}
