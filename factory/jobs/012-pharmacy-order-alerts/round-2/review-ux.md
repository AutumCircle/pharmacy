VERDICT: PASS

Both round-1 blocking findings are fixed. Flow rechecked: unreacted order -> toast, banner, title (N), optional chime -> reaction removes them within one poll; permission panel states; old Lambda shows nothing.

## Verified
- Sound dead-end fixed (`src/components/PharmacyOrderAlerts.tsx:154-190`, `src/lib/pharmacy-alerts.ts:146`).
  - If there is no AudioContext or the constructor throws, the preference is set off and the note «Звук недоступен в этом браузере. Сигнал на экране работает.» shows.
  - If the context does not reach `running`, the note «Браузер не дал включить звук. Нажмите ещё раз, чтобы выключить звук…» shows, and the next tap disables the sound (`soundClickAction` returns 'disable' when `unlockFailed`).
  - The note is a `role="status"` box, in calm Russian, and says what to do next.
- Touch targets are 44 px on mobile.
  - Toast × is 44x44 (`staff.css:452`, negative margin keeps the toast height).
  - `.pa-banner button`, `.pa-permission-row button` and `.pa-sound` all have `min-height: 44px` (`staff.css:460, 469, 473`).
  - At 420 px and below the banner and panel buttons go full width.
- Accessibility.
  - The toast stack is no longer `role="alert"`; a polite sr-only region announces only newly due titles.
  - `aria-pressed` is removed, so there is no double announcement.
  - Hover and focus-visible styles are present on all new buttons and the toast link.
  - The banner «Показать» shows a disabled «Обновляю…» state.
  - The sound note does not overlap the sound button (66 px above the bottom edge).
  - Reduced motion is respected.
- Privacy and product rules (§2) are unchanged: only the reference and waiting minutes are shown, and no totals or delivery are touched.

## Notes (non-blocking)
- The sound note has no dismiss and no timeout. It clears on the next successful tap or when the sound is disabled. This is fine.
- AC7 (manual check on the real «Ватан 1» and «Ватан 2» devices: Android Chrome, iPhone Safari tab and home-screen app, screen lock) is still open. It is a required human check before approval, after the Lambda deploy.
- The toast stack can still cover the header on a 390 px screen (max 4 plus «Ещё заказов: N»). This is acceptable.
