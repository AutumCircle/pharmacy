VERDICT: PASS

## Commands run (in .factory-worktrees/008-pharmacy-order-screen)
- `npm run test:frontend` -> 78 pass, 0 fail (tests/pharmacy-order.test.ts is listed in package.json).
- `npm run lint` -> clean.
- `python3 -m unittest discover -s backend/tests -t .` -> 273 tests, 1 failure + 1 error. These are the two known main failures (`test_quantity_on_delivered_order_recalculates_total_and_audits` and the banner `KeyError: 'title_x'`). No new failures.
- I did not rerun `npm run build`. I relied on the build log in build.md.

## Findings
No blocking issues. Acceptance criteria 1-7 are met and covered.
- The SQL filter, the `account_id` taken from the session, and the query validation are unchanged. The new test covers pharmacy 2.
- `base_unit_price` and `base_line_total` are cast `::text` in SQL, so money stays a decimal string and is not computed with floats in JS.
- `waiting_since` and `awaiting_response` are read before policy fields are popped, so they do not depend on the `status` policy.
- `item_base_total` gates `base_unit_price` as well as `base_line_total`.
- The card is built from the `pharmacyOrderView` allowlist. Client identity, address, client total, profit and creator never reach the DOM.
- It degrades cleanly on an old Lambda response: no badge and no price columns.
- There are no new dependencies, no migrations, and `agent.py` is untouched.

## Notes (non-blocking)
- `API_CONTRACT.md` section 8.1.2a is added. Lambda deploy (`admin-api-v1.zip`) is still required, and the approver should escalate that to the owner.
- Privacy decision: the UI hides pharmacy_web phone/address regardless of policy. The approver should confirm this with the owner.
- If `base_total` is shown but the item prices are hidden, the total sits in the second column (colSpan 1). That renders acceptably.
