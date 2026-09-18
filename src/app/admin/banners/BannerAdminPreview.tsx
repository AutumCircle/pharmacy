'use client';

import type { PointerEvent as ReactPointerEvent } from 'react';
import BannerRenderer from '@/components/BannerRenderer';
import type { AdminHomepageBanner } from '@/lib/api-v1/admin-types';
import type { BannerEditableElement, BannerViewport } from '@/lib/banner-layout';

export default function BannerAdminPreview({
  banner,
  mode = 'desktop',
  compact = false,
  selected,
  onSelect,
  onEditPointerDown,
}: {
  banner: AdminHomepageBanner;
  mode?: BannerViewport;
  compact?: boolean;
  selected?: BannerEditableElement | null;
  onSelect?: (element: BannerEditableElement) => void;
  onEditPointerDown?: (element: BannerEditableElement, action: 'move' | 'resize', event: ReactPointerEvent<HTMLElement>) => void;
}) {
  return <BannerRenderer banner={banner} viewport={mode} className={compact ? 'is-compact' : ''}
    selected={selected} onSelect={onSelect} onEditPointerDown={onEditPointerDown} />;
}
