VERDICT: CHANGES

Flow checked: unreacted order -> toast + banner + title (N) + optional chime -> reaction removes them within one poll; permission panel states; old Lambda degrades to nothing. Copy is Russian, calm, matches spec. No customer data in toast/title/notification. Courier path untouched. Product rules (§2) are not affected.

## Blocking

1. Sound control can dead-end: `src/components/PharmacyOrderAlerts.tsx:154-159`. With the preference on and the context not running, a tap calls `unlock()`. If it returns null (no AudioContext, or the constructor throws), or the context stays suspended, nothing changes. The label stays «Нажмите, чтобы включить звук» and the pharmacist cannot turn the sound off or see why. Fix: in the `!unlocked` branch, if `unlock()` returns null, set the preference to off (`setSound(false); writeSoundPreference(false)`). Better, also show a short note, e.g. «Звук недоступен в этом браузере. Сигнал на экране работает». If the context exists but is not running after the tap, a second tap should switch the sound off.

2. Touch target too small: `src/app/staff/staff.css` `.pa-toast button` is `min-width/min-height: 32px`. On a 390 px phone the × is below the usual 44 px target and sits next to the link that navigates. Fix: raise to 44x44 (the toast padding can absorb it). Also give `.pa-banner button` and `.pa-permission-row button` `min-height: 44px` (currently ~36 px at 14 px font + 9 px padding).

## Non-blocking notes

- `PharmacyOrderAlerts.tsx:177` puts `role="alert"` on the whole stack, and the toast minutes are rewritten every 30 s poll. Screen readers may re-announce all toasts every poll. Consider `role="status"` for the stack, or announce only newly due toasts.
- `PharmacyOrderAlerts.tsx:174` uses `aria-pressed` on a button whose visible label also changes («Включить звук» / «Звук включён»). The label and the state are announced twice. Keep a fixed label, or drop `aria-pressed`.
- The `title` tooltip on the sound button says «Нажмите, чтобы выключить звук», which is good; there is no equivalent on touch devices. Fine.
- The fixed toast stack (top, z 70) covers the staff header and nav on mobile until dismissed. It is acceptable, but with 4 toasts it takes much of the 390 px screen. «Ещё заказов: N» is a good fallback.
- The banner «Показать» only refreshes the list and gives no visible feedback. Consider a brief disabled state or a scroll to the list.
- AC7 (manual check on real Ватан 1 / Ватан 2 devices: Android Chrome, iPhone Safari tab and home-screen app, screen lock) is not done. It is a required human check before approval.
- Orders beyond the first 20 of the queue are not counted (noted in build.md). Acceptable.
