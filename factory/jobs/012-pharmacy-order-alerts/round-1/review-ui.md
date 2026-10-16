VERDICT: PASS

Visual change: pharmacy sound control, toasts, banner, permission panel (src/app/staff/staff.css:437-471, PharmacyOrderAlerts.tsx, PharmacyAlertBanner.tsx, NotificationPermission.tsx). Static review only (no browser run).

Checks
- Tokens: uses the same hex palette as the rest of staff.css (#187a3c, #b54708, #14201a, #e3e8e4, #66706a); no new colours except red #c4161c for urgent toasts/banner (acceptable for "needs reaction").
- Layout: banner and panel sit above the list with 14-16px margins, 12px radius like neighbouring cards. Wrapping (flex-wrap, overflow-wrap:anywhere, max-width calc(100vw - 24px)) and the <=420px full-width buttons prevent horizontal scroll at 390px. Extra main bottom padding keeps the fixed sound button off card buttons.
- Contrast: white on #c4161c and #ffe3e3 on #c4161c are readable; orange on #fff0e3 is readable.
- Reduced motion handled.

Notes (non-blocking)
- staff.css:451 toast uses a 3x box-shadow pulse plus slide-in. Brief and tied to a real missed-order alert, but it is the one decorative-looking animation; consider dropping pa-pulse for a calmer tone.
- staff.css:453, 461 toast close button is 32px and banner/permission buttons ~36px tall; on phones raise to min-height 44px.
- No explicit :hover/:focus-visible styles for .pa-sound, .pa-banner button, .pa-permission-row button, .pa-toast button (browser default focus ring only). Add a visible focus-visible outline matching other staff buttons.
- Disabled state of the permission button is only opacity .6; fine, but add cursor/contrast check if desired.
- Toast stack (top-right, z 70) can cover the sticky header nav on 390px while visible; acceptable since it is dismissible.
