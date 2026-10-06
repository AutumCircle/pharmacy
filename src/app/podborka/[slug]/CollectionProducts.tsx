'use client';

import { useEffect, useRef } from 'react';
import ProductCard from '@/components/ProductCard';
import type { PublicMedicine } from '@/lib/api-v1/types';
import { readUtm, saveFirstTouchSource, sendCollectionEvent } from '@/lib/collections';

/**
 * Product grid of a marketing collection. Statistics are sent from the browser only, after the
 * page is really loaded, so link-preview crawlers and server-side prefetches are never counted.
 */
export default function CollectionProducts({
  slug,
  medicines,
  phone,
}: {
  slug: string;
  medicines: PublicMedicine[];
  phone: string | null;
}) {
  const viewed = useRef(false);

  useEffect(() => {
    if (viewed.current) return;
    viewed.current = true;
    const track = () => {
      saveFirstTouchSource(slug, readUtm(window.location.search));
      sendCollectionEvent(slug, 'view');
    };
    // A page that Chrome pre-renders in the background has not been opened by the visitor yet.
    if ((document as Document & { prerendering?: boolean }).prerendering) {
      document.addEventListener('prerenderingchange', track, { once: true });
    } else {
      track();
    }
  }, [slug]);

  return (
    <div className="medicine-grid">
      {medicines.map((medicine) => (
        <ProductCard
          key={medicine.medicine_id}
          item={medicine}
          outOfStockPhone={phone}
          onOpen={(item) => sendCollectionEvent(slug, 'product_open', item.medicine_id)}
          onAddToCart={(item) => sendCollectionEvent(slug, 'add_to_cart', item.medicine_id)}
        />
      ))}
    </div>
  );
}
