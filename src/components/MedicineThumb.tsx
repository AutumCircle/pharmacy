'use client';

import { useState } from 'react';

/** Product photo for cart, checkout and order screens, with a neutral box icon when there is none. */
export default function MedicineThumb({ url, name, className }: { url: string | null | undefined; name: string; className?: string }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const showImage = Boolean(url) && failedUrl !== url;
  return (
    <span className={`medicine-thumb${className ? ` ${className}` : ''}`}>
      {showImage ? (
        // Admin-managed product images are served from the configured HTTPS media domain.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url as string} alt={name} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailedUrl(url as string)} />
      ) : (
        <svg viewBox="0 0 32 32" fill="none" role="img" aria-label={name}>
          <rect x="7" y="9" width="18" height="17" rx="2.5" fill="#FFFFFF" stroke="#B9B9B9" strokeWidth="1.5" />
          <rect x="7" y="13" width="18" height="6" fill="#B9B9B9" opacity="0.3" />
          <rect x="10" y="5" width="12" height="4" rx="1.5" fill="#B9B9B9" />
        </svg>
      )}
    </span>
  );
}
