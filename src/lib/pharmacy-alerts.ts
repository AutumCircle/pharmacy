import { parseOrderTime } from './order-time.ts';
import {
  ALARM_DURATION_MAX, ALARM_DURATION_MIN, ALARM_INTERVAL_MAX, ALARM_INTERVAL_MIN, DEFAULT_ALARM_INTERVAL_SECONDS,
  DEFAULT_ALARM_SECONDS, DEFAULT_RINGTONE, isRingtone, type RingtoneId,
} from './pharmacy-alarm.ts';

/**
 * Job 014: one reminder interval for «Ватан 1» and «Ватан 2» (was 60 s / 180 s in job 013). This is the
 * default; the owner's `alarm.interval_seconds` from the queue replaces it.
 */
export const REMIND_MS = DEFAULT_ALARM_INTERVAL_SECONDS * 1000;

/** The pharmacy alarm the queue response carries (`alarm`), parsed and clamped. */
export type PharmacyAlarmConfig = { ringtone: RingtoneId; durationSeconds: number; intervalSeconds: number };

export const DEFAULT_ALARM_CONFIG: PharmacyAlarmConfig = {
  ringtone: DEFAULT_RINGTONE, durationSeconds: DEFAULT_ALARM_SECONDS, intervalSeconds: DEFAULT_ALARM_INTERVAL_SECONDS,
};

function clampSeconds(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

/**
 * Reads `alarm` of the pharmacy queue response. A missing or invalid object (older Lambda) gives the
 * defaults (classic, 60 s every 60 s); an unknown ringtone gives «Классический»; numbers are rounded and
 * clamped to 5–120 s and 30–600 s, and the duration never exceeds the interval (alarms never overlap).
 */
export function parseAlarmConfig(raw: unknown): PharmacyAlarmConfig {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...DEFAULT_ALARM_CONFIG };
  const value = raw as Record<string, unknown>;
  const intervalSeconds = clampSeconds(value.interval_seconds, ALARM_INTERVAL_MIN, ALARM_INTERVAL_MAX,
    DEFAULT_ALARM_INTERVAL_SECONDS);
  const durationSeconds = Math.min(intervalSeconds,
    clampSeconds(value.duration_seconds, ALARM_DURATION_MIN, ALARM_DURATION_MAX, DEFAULT_ALARM_SECONDS));
  return { ringtone: isRingtone(value.ringtone) ? value.ringtone : DEFAULT_RINGTONE, durationSeconds, intervalSeconds };
}

/** Reminder interval in ms: the same for both pharmacies, from the owner's alarm settings. */
export function remindIntervalMs(config: PharmacyAlarmConfig = DEFAULT_ALARM_CONFIG): number {
  return parseAlarmConfig({ interval_seconds: config.intervalSeconds }).intervalSeconds * 1000;
}

/** Poll interval of the pharmacy queue while the staff page is open. */
export const POLL_MS = 30_000;

/** localStorage key of the pharmacy sound preference (separate from the courier `vatan-order-sound`). */
export const PHARMACY_SOUND_KEY = 'vatan-pharmacy-sound';

/**
 * Job 014: sound is always on («Звук всегда должен быть включенным»). A missing value, '1' and the old
 * '0' (switched off before job 014) all count as on; there is no way to switch it off any more.
 */
export function soundPreference(stored: string | null | undefined): boolean {
  void stored;
  return true;
}

/**
 * The only keys the alerts read. `needs_attention` and `attention_since` are computed by the Lambda
 * and are not policy-gated; the client never derives them from item data. Job 013: an order needs
 * attention until this pharmacy presses «Сборка сделана» (answers and «Начать сборку» do not stop it).
 */
export type AlertQueueOrder = {
  order_id: string;
  order_reference?: string | null;
  needs_attention?: boolean;
  attention_since?: string | null;
};

/**
 * Which orders alert now. An order alerts when it needs attention and either was never alerted on
 * this page or was last alerted at least `intervalMs` ago (the owner's interval, default REMIND_MS). The returned map keeps only orders that
 * still need attention, so an order that was answered or left the queue never alerts again.
 * A missing `needs_attention` (older Lambda) never alerts.
 */
export function dueAlerts(
  orders: readonly AlertQueueOrder[], lastAlerted: ReadonlyMap<string, number>, now: number,
  intervalMs: number = REMIND_MS,
): { due: string[]; lastAlerted: Map<string, number> } {
  const next = new Map<string, number>();
  const due: string[] = [];
  for (const order of orders) {
    if (order.needs_attention !== true || typeof order.order_id !== 'string' || !order.order_id) continue;
    if (next.has(order.order_id)) continue;
    const previous = lastAlerted.get(order.order_id);
    if (previous === undefined || now - previous >= intervalMs) {
      due.push(order.order_id);
      next.set(order.order_id, now);
    } else {
      next.set(order.order_id, previous);
    }
  }
  return { due, lastAlerted: next };
}

/** Number of orders in the list that still wait for this pharmacy's «Сборка сделана». */
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
    title: `Заказ № ${reference}`,
    body: `Ждёт сборки ${attentionMinutes(order, now)} мин`,
  };
}

/** Banner at the top of the pharmacy queue (null when no order waits). */
export function attentionBannerText(count: number): string | null {
  return count > 0 ? `Заказов ждут «Сборка сделана»: ${count}` : null;
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

export type SoundLabel = 'Звук включён' | 'Звук включён — коснитесь экрана';

/**
 * Sound status copy (job 014: an indicator, not a switch). «Звук включён» while the AudioContext runs;
 * while the browser still blocks audio (an ordinary tab after a reload), any touch on the page unlocks it.
 */
export function soundLabel(running: boolean): SoundLabel {
  return running ? 'Звук включён' : 'Звук включён — коснитесь экрана';
}

export const SOUND_UNAVAILABLE = 'Звук недоступен в этом браузере. Сигнал на экране и системное уведомление работают.';
export const SOUND_HINT = 'Чтобы звук работал сразу, установите приложение или разрешите звук для сайта в настройках браузера';

/** Window events that count as the user's first interaction and unlock audio (autoplay rules). */
export const UNLOCK_EVENTS = ['pointerdown', 'keydown', 'touchstart'] as const;

/**
 * The system notification of one due alert (job 014: always, whether the page is visible or hidden,
 * when permission is granted). Text from `alertText` only, so no client data reaches the lock screen;
 * one notification per order (`tag`) that sounds again on each repeat (`renotify`).
 */
export function systemNotification(order: AlertQueueOrder, now: number = Date.now()):
  { title: string; options: { body: string; tag: string; renotify: true } } {
  const text = alertText(order, now);
  return { title: text.title, options: { body: text.body, tag: `pharmacy-${order.order_id}`, renotify: true } };
}
