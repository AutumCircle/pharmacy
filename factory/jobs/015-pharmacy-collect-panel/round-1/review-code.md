VERDICT: PASS

## Commands (in .factory-worktrees/015-pharmacy-collect-panel)
- `npm run test:frontend` -> 178 pass, 0 fail.
- `python3 -m unittest discover -s backend/tests -t .` -> 437 tests, 1 failure + 2 errors: the two known main failures
  (`test_banner_title_can_be_empty_for_image_only_banner` errored, `test_quantity_on_delivered_order_recalculates_total_and_audits` failed)
  plus `test_has_more_and_cursor_round_trip_for_delivered` (cursor/date, file untouched by this job; builder reports it fails on clean main too). No new failures.
- `npm run lint` -> clean.
- `rg` for "Начать сборку|Сборка сделана|ROW_ACTION_LABELS.available|.collect" in src/app/staff -> only a code comment in CourierOrderDetail.tsx:332 (job 016 file, out of scope).

## Findings
All acceptance criteria 1-6 verified against the diff and covered by tests. No blocking issues.
- Lambda: `(None,"assembled")` added; 409 after «Собран» is checked under the existing order lock before any write; notification computed in the same transaction from `_ORDER_ASSEMBLY_PARTS_SQL`, only when all parts are assembled; payload has no PII; event key per request; claim regex limited to owner/courier by existing `_CHANGE_EVENT_RECIPIENTS`.
- Notifier: new branch, key check, owner+courier only, courier gets only «📦 Открыть заказ», «Сумма» gated by `client_total`.
- Next.js route: `_notification` stripped, sent in `after()`, failures only logged. No new test files, so package.json is unchanged and correct. No new dependencies.

## Notes
- Known gap (build.md open question 3): if Ватан 1 already pressed «Собран» and Ватан 2 then marks its last item «Нет в наличии», assembly is complete but no «Заказ собран» message is sent. Acceptable edge case; mention to owner.
- User-visible «Сборка сделана» remains in courier 409 text (`ASSEMBLY_NOT_COMPLETE`) and `PharmacyAlarmSettings.tsx`; rename in a follow-up (job 016 or later).
- Deploy order: admin Lambda, notifier Lambda, then Vercel.
