export function toggleSelection(current: ReadonlySet<number>, id: number): Set<number> {
  const next = new Set(current);
  if (next.has(id)) next.delete(id); else next.add(id);
  return next;
}

export function selectPage(ids: number[], unavailable: ReadonlySet<number> = new Set()): Set<number> {
  return new Set(ids.filter((id) => !unavailable.has(id)));
}
