/**
 * Live screen refresh for the order screens (pharmacy queue, courier list/detail, admin orders/detail).
 * Without it a screen only showed another person's change (a new order, an item sent to «Ватан 2»,
 * «Собран») after F5. The browser re-renders the server page through `router.refresh()`; the data still
 * comes Next.js -> API Gateway -> Lambda, so nothing new is needed in AWS.
 */

/** Work screens: an order change shows up within about this time. */
export const LIVE_REFRESH_MS = 5_000;
/** Admin overview: its aggregates are heavier, so it refreshes less often. */
export const LIVE_REFRESH_OVERVIEW_MS = 15_000;

export type LiveRefreshState = {
  /** `document.visibilityState === 'visible'`: a hidden tab is not refreshed (it catches up on return). */
  visible: boolean;
  /** The previous refresh has not finished yet. */
  pending: boolean;
  /** Focus is in a field the person is typing into. */
  editing: boolean;
};

/** A refresh is skipped while hidden, while one is still running, and while someone types. */
export function shouldRefresh(state: LiveRefreshState): boolean {
  return state.visible && !state.pending && !state.editing;
}

type FocusedElement = { tagName?: string; isContentEditable?: boolean; type?: string; readOnly?: boolean; disabled?: boolean } | null;

const NON_TEXT_INPUTS = new Set(['button', 'submit', 'reset', 'checkbox', 'radio', 'hidden', 'image', 'range', 'color', 'file']);

/**
 * True when the focused element takes typed text. A refresh can remount an editor whose data changed and
 * drop what is being typed, so the refresh waits until focus leaves the field.
 */
export function isEditingElement(element: FocusedElement): boolean {
  if (!element) return false;
  if (element.isContentEditable) return true;
  const tag = (element.tagName || '').toUpperCase();
  if (element.disabled || element.readOnly) return false;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag !== 'INPUT') return false;
  return !NON_TEXT_INPUTS.has((element.type || 'text').toLowerCase());
}
