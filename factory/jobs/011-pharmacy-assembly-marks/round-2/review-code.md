VERDICT: PASS

Commands (in .factory-worktrees/011-pharmacy-assembly-marks):
- npm run test:frontend -> 116/116 pass (tests/pharmacy-assembly.test.ts is listed in package.json)
- python3 -m unittest discover -s backend/tests -t . -> 354 tests; only the 2 known main failures
  (test_banner_title_can_be_empty_for_image_only_banner, test_quantity_on_delivered_order_recalculates_total_and_audits)
- npm run lint -> clean
- npm run build not rerun (builder reported success).

Checked against spec + rework-1.md (reading of the diff):
- Migration 0025: still additive, BEGIN/COMMIT, id types read from the catalogue, FK cascade, CHECKs, PKs. New
  order_item_assembly table follows the same pattern. No DROP/UPDATE/DELETE/ALTER.
- Assembly allowed while pending or confirmed; pharmacy id from the session only; order row FOR UPDATE; forward-only
  transitions; repeat is a no-op with no audit; no write to orders.status / order_status_history by pharmacy endpoints.
- "Сборка сделана" on a pending order auto-writes "available" for unanswered items (ON CONFLICT DO NOTHING, audited under
  answered_available). Matches the builder's stated decision.
- Pharmacy 2 price change: pharmacy 1 gets 403, only with "available", validated with validate_unit_price (Decimal, no
  floats). Client price recomputed in SQL with vatan_selling_unit_price, line and order totals recomputed, one audit row,
  no client totals trusted. Runs inside the same locked transaction.
- Per-item collect (/assembly/items): ownership check on effective pharmacy, requires "available", idempotent, status
  limited to pending/confirmed, part mark synced forward-only in one statement.
- Courier gate: pending -> confirmed on website orders returns 409 ASSEMBLY_NOT_COMPLETE inside the FOR UPDATE
  transaction; courier-created orders and orders with nothing to assemble are not blocked. UI mirrors it (disabled button
  with reason) and tolerates an old Lambda.
- Colours: orange "В аптеке 2", red "Нет в наличии в обеих аптеках" via staff.css tokens; routed_away follows the
  items/quantity policy and carries no client data.
- New test files are in test:frontend; the backend tests are discovered by unittest. Contract docs updated.

Findings: none blocking.

Notes:
- Operational risk to state at handover (already in build.md): after deploy the courier cannot confirm existing pending
  website orders until each pharmacy presses "Сборка сделана". If a pharmacy is slow or offline there is no courier
  bypass (admin status changes are not gated). Consider an owner-approved override in a follow-up.
- Pharmacy reprice has no order-total overflow guard (price capped at 999999.99 per unit); acceptable.
- Pharmacy "Сборка сделана" on a pending order marks never-answered items "available" without a per-item check; this is
  the owner's flow but worth confirming with the pharmacists.
- Escalation still required: apply 0025, then deploy the Lambda, then Vercel. Not part of this job.
