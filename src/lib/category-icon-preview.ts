const eventName = 'vatan-category-icon-preview';
const key = (id: number) => `vatan-local-category-icon:${id}`;
export const localIconPreview = process.env.NODE_ENV === 'development';

export function readLocalIcon(id: number): string | null {
  if (!localIconPreview) return null;
  try { return localStorage.getItem(key(id)); } catch { return null; }
}

export function saveLocalIcon(id: number, value: string | null) {
  if (!localIconPreview) throw new Error('Локальный предпросмотр отключён');
  if (value === null) localStorage.removeItem(key(id));
  else localStorage.setItem(key(id), value);
  window.dispatchEvent(new Event(eventName));
}

export function subscribeLocalIcons(callback: () => void) {
  window.addEventListener(eventName, callback);
  window.addEventListener('storage', callback);
  return () => { window.removeEventListener(eventName, callback); window.removeEventListener('storage', callback); };
}
