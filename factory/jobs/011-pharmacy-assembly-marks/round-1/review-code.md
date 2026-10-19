VERDICT: PASS

Commands (in .factory-worktrees/011-pharmacy-assembly-marks):
- npm run test:frontend -> 110/110 pass (tests/pharmacy-assembly.test.ts is listed in package.json)
- python3 -m unittest discover -s backend/tests -t . -> 335 tests; only the 2 known main failures
  (test_banner_title_can_be_empty_for_image_only_banner, test_quantity_on_delivered_order_recalculates_total_and_audits)
- npm run lint -> clean

Findings: none blocking. Checked against the spec:
- Migration 0025: additive, BEGIN/COMMIT, type read from catalogue, FK cascade, all CHECKs and the PK. Matches AC1.
- mark_pharmacy_assembly: pharmacy id from the session only, body exactly {"state"}, order locked FOR UPDATE,
  404 / 409 ordering as specified, forward-only transitions, an idempotent repeat writes nothing, one audit row
  with no PII, orders and order_status_history untouched.
- Pharmacy queue fields are ungated. The courier LATERAL is a single query, excludes pharmacies whose items are
  all unavailable, and returns [] for non-website orders.
- UI tolerates an old Lambda (no buttons, no marks, no warning); the warning does not block «Выехал».
- Tests cover every AC in the spec.

Notes:
- Pharmacy card status label for confirmed changed «Собирается» -> «Согласован». This is a reasonable
  disambiguation, but it is a visible copy change beyond the spec; mention it at handover.
- "Нечего собирать" uses the code NOTHING_TO_ASSEMBLE (the spec gave no code); fine.
- Escalation still required: apply 0025, then deploy the Lambda, then Vercel.
