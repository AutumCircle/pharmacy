VERDICT: PASS

## Commands run (in .factory-worktrees/012-pharmacy-order-alerts)
- `npm run test:frontend` -> 130 tests, 130 pass (includes tests/pharmacy-alerts.test.ts, which is listed in package.json).
- `npm run lint` -> clean.
- `python3 -m unittest discover -s backend/tests -t .` -> 361 tests, failures=1, errors=1. These are the two known main failures (test_quantity_on_delivered_order_recalculates_total_and_audits and the banner title test). No new failures.
- `npm run build` not rerun. build.md reports success.

## Review
- AC1: the Lambda adds `needs_attention` and `attention_since` from the existing items LATERAL. It adds one aggregate (`reacted_count`) and reuses the existing routed-away and assembly data. There is no new query, write or migration. The fields are outside the `pharmacy_web` gating. The 7 new mocked-cursor tests cover unreacted, answered, routed-away, assembly mark, «Ватан 2» routed order and all-off policy.
- Reaction logic: counting routed-away answers (an «Нет в наличии» from «Ватан 1» moves the item to «Ватан 2») and per-item «Собрано» as reactions is sound and beyond the spec. It is documented in build.md.
- AC2: `dueAlerts` is pure and tested for first sight, <180 s, >=180 s, reacted, absent from the list and a missing field.
- AC3: polling is every 30 s with an immediate poll on visibilitychange. A toast, the `(N)` title and the banner appear, and the toast disappears when `needs_attention` is false or the order leaves the queue.
- AC4: the sound key is `vatan-pharmacy-sound`, separate from the courier key. The unlock-on-first-gesture flow matches the spec. A chime failure is caught, so the on-screen signal still shows.
- AC5: `permissionView` has the four states and the iOS hint only outside standalone. The permission request is made from the button handler only.
- AC6: `alertText` carries only the reference (or the last 6 characters of `order_id`) and the minutes. It has a PII test.
- Courier/admin `NewOrderAlerts` only gained an `export` on `chime`, so its behaviour is unchanged. Old-Lambda tolerance is handled: with no field there are no reminders.
- No new dependencies. agent.py is untouched. There is no dead code.

## Findings
None blocking.

## Notes
- AC7 (manual check on real devices) is not done. The owner must do it before approval, and it needs the Lambda deploy after 011's 0025.
- Only the first page of the queue (20 orders) is polled, so orders beyond it are not counted. This is already noted in build.md and is acceptable.
