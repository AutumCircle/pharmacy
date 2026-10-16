VERDICT: PASS

Security review: job 012-pharmacy-order-alerts, round 2 (diff `main...factory/012-pharmacy-order-alerts`, commits 88d2bdd and 73aa8d5).

The round-2 commit 73aa8d5 touches only frontend presentation: `src/components/PharmacyOrderAlerts.tsx`, `src/app/staff/orders/PharmacyAlertBanner.tsx`, `src/lib/pharmacy-alerts.ts`, `src/app/staff/staff.css` and `tests/pharmacy-alerts.test.ts`. The backend and SQL are the same as in round 1, which passed.

## Findings
None of them block.

- **Boundary.** This round adds no new fetches, routes or SQL. The Lambda change from round 1 is still one read-only aggregate inside the existing LATERAL, bound to the session `pharmacy_id`.
- **Secrets.** The full diff has no `.env*`, credential, token, `API_KEY` or `NEXT_PUBLIC_*` additions.
- **AuthZ.** Nothing changed. The alert fields only drive client-side signalling, and no server action trusts them.
- **XSS / privacy.**
  - The new sr-only live region (`src/components/PharmacyOrderAlerts.tsx`, `setAnnouncement`) joins `alertText(...).title` values. Those hold only the order reference or the id fallback, and React renders them as text.
  - `SOUND_UNAVAILABLE` and `SOUND_BLOCKED` are static strings.
  - The diff has no `dangerouslySetInnerHTML`.
  - The toast link still targets the fixed `/staff/orders`.
- **Abuse.** The banner's `router.refresh()` is now wrapped in `useTransition`, and the button is disabled while the refresh runs, so repeat taps cannot stack refreshes. The 30 s poll and its `busy` guard did not change.
- **Destructive endpoints.** None.

## Notes
- Carried over from round 1, not required: a slimmer alerts-only queue view would avoid re-fetching policy-enabled client fields every 30 s.
- For 012b: keep the VAPID private key server-only. Bind push subscriptions to the server-side staff session. Keep push payloads to the order reference and the minutes only.
