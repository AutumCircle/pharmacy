/**
 * Shares the live «needs attention» count between the pharmacy alerts (mounted in StaffShell) and the
 * banner on /staff/orders. `null` = no poll has finished yet (the banner then uses the server count).
 */
let count: number | null = null;
const listeners = new Set<() => void>();

export function setAttentionCount(value: number | null) {
  if (value === count) return;
  count = value;
  listeners.forEach((listener) => listener());
}

export function getAttentionCount(): number | null {
  return count;
}

export function getServerAttentionCount(): number | null {
  return null;
}

export function subscribeAttentionCount(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
