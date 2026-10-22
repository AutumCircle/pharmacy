'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useTransition } from 'react';
export default function Refresh() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') startTransition(() => router.refresh());
    }, 60_000);
    return () => clearInterval(timer);
  }, [router]);
  return (
    <button
      type="button"
      onClick={() => startTransition(() => router.refresh())}
      disabled={pending}
      aria-live="polite"
    >
      {pending ? 'Обновление…' : 'Обновить данные'}
    </button>
  );
}
