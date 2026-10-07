'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { COLLECTION_PATH_PREFIX, readUtm, saveAttributionSource } from '@/lib/collections';

/**
 * Keeps UTM labels from the latest tracked link on any public page, so an order placed
 * after a story link straight to a product is still attributed. Collection pages store their own
 * source (with the collection slug) once they know the collection exists.
 */
export default function AttributionTracker() {
  const pathname = usePathname();
  useEffect(() => {
    if (pathname.startsWith('/admin') || pathname.startsWith('/staff')) return;
    if (pathname.startsWith(COLLECTION_PATH_PREFIX)) return;
    saveAttributionSource(null, readUtm(window.location.search));
  }, [pathname]);
  return null;
}
