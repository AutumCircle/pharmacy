export type PaginationItem = number | 'ellipsis-left' | 'ellipsis-right';

/**
 * Desktop: first three and last two pages plus neighbours of the current one,
 * e.g. 1 2 3 … 19 20 or 1 2 … 7 8 9 … 19 20.
 * Compact (phones): 1 … 8 … 20.
 */
export function getPaginationItems(current: number, total: number, compact = false): PaginationItem[] {
  if (total <= 0) return [];
  const pages = new Set<number>(compact ? [1, current, total] : [1, 2, 3, current - 1, current, current + 1, total - 1, total]);
  const sorted = [...pages].filter((page) => page >= 1 && page <= total).sort((a, b) => a - b);
  const items: PaginationItem[] = [];
  sorted.forEach((page, index) => {
    if (index > 0 && page - sorted[index - 1] > 1) {
      items.push(items.includes('ellipsis-left') ? 'ellipsis-right' : 'ellipsis-left');
    }
    items.push(page);
  });
  return items;
}
