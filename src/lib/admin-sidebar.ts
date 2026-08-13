export const ADMIN_SIDEBAR_STORAGE_KEY = 'vatan.admin.sidebar.collapsed';

type SidebarStorage = Pick<Storage, 'getItem' | 'setItem'>;

export function readSidebarCollapsed(storage: SidebarStorage): boolean {
  try {
    return storage.getItem(ADMIN_SIDEBAR_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function writeSidebarCollapsed(storage: SidebarStorage, collapsed: boolean): void {
  try {
    storage.setItem(ADMIN_SIDEBAR_STORAGE_KEY, String(collapsed));
  } catch {
    // The UI still works when storage is unavailable (private/locked browser).
  }
}
