import { parseOrderTime } from './order-time.ts';

/** Job 012: a pharmacy is reminded about an unreacted order about every 3 minutes. */
export const REMIND_MS = 180_000;

/** Poll interval of the pharmacy queue while the staff page is open. */
export const POLL_MS = 30_000;

/** localStorage key of the pharmacy sound preference (separate from the courier `vatan-order-sound`). */
export const PHARMACY_SOUND_KEY = 'vatan-pharmacy-sound';

/**
 * The only keys the alerts read. `needs_attention` and `attention_since` are computed by the Lambda
 * and are not policy-gated; the client never derives reaction from item data.
 */
export type AlertQueueOrder = {
  order_id: string;
  order_reference?: string | null;
  needs_attention?: boolean;
  attention_since?: string | null;
};

/**
 * Which orders alert now. An order alerts when it needs attention and either was never alerted on
 * this page or was last alerted at least REMIND_MS ago. The returned map keeps only orders that
 * still need attention, so an order that was answered or left the queue never alerts again.
 * A missing `needs_attention` (older Lambda) never alerts.
 */
export function dueAlerts(
  orders: readonly AlertQueueOrder[], lastAlerted: ReadonlyMap<string, number>, now: number,
): { due: string[]; lastAlerted: Map<string, number> } {
  const next = new Map<string, number>();
  const due: string[] = [];
  for (const order of orders) {
    if (order.needs_attention !== true || typeof order.order_id !== 'string' || !order.order_id) continue;
    if (next.has(order.order_id)) continue;
    const previous = lastAlerted.get(order.order_id);
    if (previous === undefined || now - previous >= REMIND_MS) {
      due.push(order.order_id);
      next.set(order.order_id, now);
    } else {
      next.set(order.order_id, previous);
    }
  }
  return { due, lastAlerted: next };
}

/** Number of orders in the list that need this pharmacy's reaction. */
export function attentionCount(orders: readonly AlertQueueOrder[]): number {
  return orders.filter((order) => order.needs_attention === true).length;
}

/** Whole minutes the order has waited for this pharmacy (0 when the time is missing or invalid). */
export function attentionMinutes(order: AlertQueueOrder, now: number): number {
  if (!order.attention_since) return 0;
  try {
    return Math.max(0, Math.floor((now - parseOrderTime(order.attention_since).getTime()) / 60_000));
  } catch {
    return 0;
  }
}

/**
 * Toast / system-notification text. Only the order reference and the waiting minutes, never client
 * data, whatever the `pharmacy_web` policy returns (the text may show on a lock screen).
 */
export function alertText(order: AlertQueueOrder, now: number = Date.now()): { title: string; body: string } {
  const reference = typeof order.order_reference === 'string' && order.order_reference.trim()
    ? order.order_reference.trim() : String(order.order_id ?? '').slice(-6);
  return {
    title: `Новый заказ № ${reference}`,
    body: `Ожидает ответа ${attentionMinutes(order, now)} мин`,
  };
}

/** Title prefix «(N) » for N orders that need attention; strips an earlier prefix. */
export function titleWithCount(title: string, count: number): string {
  const base = title.replace(/^\(\d+\)\s*/, '');
  return count > 0 ? `(${count}) ${base}` : base;
}

export type PermissionState = 'granted' | 'denied' | 'default' | 'unsupported';

export type PermissionInput = {
  /** `'Notification' in window`. */
  supported: boolean;
  /** `Notification.permission`; ignored when unsupported. */
  permission?: string;
  /** `display-mode: standalone` or `navigator.standalone`. */
  standalone: boolean;
  /** iPhone / iPad (including iPadOS reporting as Mac with touch). */
  ios: boolean;
};

export type PermissionView = {
  state: PermissionState;
  text: string;
  /** Show «Разрешить уведомления» (calls Notification.requestPermission() from the tap). */
  canRequest: boolean;
  installed: string;
  iosHint: string | null;
};

export const IOS_HINT = 'На iPhone уведомления работают только для приложения, добавленного на экран „Домой“ (iOS 16.4+)';

const PERMISSION_TEXT: Record<PermissionState, string> = {
  granted: 'Уведомления разрешены',
  denied: 'Уведомления запрещены — включите их в настройках браузера',
  default: 'Не запрошено',
  unsupported: 'Этот браузер не поддерживает уведомления',
};

/** Maps notification support, permission and installed state to the Russian panel copy. */
export function permissionView(input: PermissionInput): PermissionView {
  let state: PermissionState = 'unsupported';
  if (input.supported) {
    state = input.permission === 'granted' || input.permission === 'denied' ? input.permission : 'default';
  }
  return {
    state,
    text: PERMISSION_TEXT[state],
    canRequest: state === 'default',
    installed: input.standalone ? 'Приложение установлено на экран „Домой“' : 'Открыто в браузере (не установлено)',
    iosHint: input.ios && !input.standalone ? IOS_HINT : null,
  };
}

export type SoundLabel = 'Включить звук' | 'Нажмите, чтобы включить звук' | 'Звук включён';

/** Sound control copy: preference off, on but waiting for the first tap (autoplay rules), or on. */
export function soundLabel(preference: boolean, unlocked: boolean): SoundLabel {
  if (!preference) return 'Включить звук';
  return unlocked ? 'Звук включён' : 'Нажмите, чтобы включить звук';
}

export const SOUND_UNAVAILABLE = 'Звук недоступен в этом браузере. Сигнал на экране работает.';
export const SOUND_BLOCKED = 'Браузер не дал включить звук. Нажмите ещё раз, чтобы выключить звук. Сигнал на экране работает.';

export type SoundClickAction = 'enable' | 'unlock' | 'disable';

/**
 * What a tap on the sound control does. With the preference on but no running audio, the first tap
 * tries to unlock; if an earlier tap on the control already failed to unlock, the tap switches the
 * sound off so the control never dead-ends on «Нажмите, чтобы включить звук».
 */
export function soundClickAction(preference: boolean, unlocked: boolean, unlockFailed: boolean): SoundClickAction {
  if (!preference) return 'enable';
  if (unlocked || unlockFailed) return 'disable';
  return 'unlock';
}
