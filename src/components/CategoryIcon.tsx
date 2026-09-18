'use client';

import { useSyncExternalStore } from 'react';
import { readLocalIcon, subscribeLocalIcons } from '@/lib/category-icon-preview';

export default function CategoryIcon({ id, icon, size = 24 }: { id: number; icon: string | null; size?: number }) {
  const local = useSyncExternalStore(subscribeLocalIcons, () => readLocalIcon(id), () => null);
  const value = local ?? icon;
  const image = value?.startsWith('https://') || value?.startsWith('data:image/png;base64,') || value?.startsWith('data:image/webp;base64,');
  return <span aria-hidden="true" style={{ display: 'inline-flex', width: size, height: size, flexShrink: 0, alignItems: 'center', justifyContent: 'center', verticalAlign: 'middle' }}>
    {image ? /* eslint-disable-next-line @next/next/no-img-element */
      <img src={value!} alt="" width={size} height={size} style={{ objectFit: 'contain', width: '100%', height: '100%' }} /> : value || null}
  </span>;
}
