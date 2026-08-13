'use client';

import type { ResolveMedicinesResponse, TrackOrdersResponse } from './types';

interface CachedRead<T> {
  expiresAt: number;
  promise: Promise<T>;
}

const reads = new Map<string, CachedRead<unknown>>();
const SHORT_DEDUPE_MS = 2_000;

async function post<T>(path: string, body: unknown, force = false): Promise<T> {
  const key = `${path}:${JSON.stringify(body)}`;
  const current = reads.get(key) as CachedRead<T> | undefined;
  if (!force && current && current.expiresAt > Date.now()) return current.promise;

  const entry: CachedRead<T> = {
    expiresAt: Number.POSITIVE_INFINITY,
    promise: Promise.resolve(null as T),
  };
  entry.promise = fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then(async (response) => {
    if (!response.ok) throw new Error(`Public read failed with ${response.status}`);
    const payload = await response.json() as T;
    entry.expiresAt = Date.now() + SHORT_DEDUPE_MS;
    return payload;
  }).catch((error: unknown) => {
    if (reads.get(key) === entry) reads.delete(key);
    throw error;
  });

  reads.set(key, entry as CachedRead<unknown>);
  return entry.promise;
}

export function resolveMedicinesClient(medicineIds: number[]): Promise<ResolveMedicinesResponse> {
  const uniqueIds = [...new Set(medicineIds)].sort((left, right) => left - right);
  return post('/api/medicines/resolve', { medicine_ids: uniqueIds });
}

export function trackOrdersClient(phone: string, force = false): Promise<TrackOrdersResponse> {
  return post('/api/tracking', { phone }, force);
}

export function invalidateTrackedOrders(phone: string): void {
  reads.delete(`/api/tracking:${JSON.stringify({ phone })}`);
}
