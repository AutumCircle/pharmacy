ESCALATE
All four round-1 reviews (code, security, UI, UX) say VERDICT: PASS, and build.md verifies all 7 acceptance criteria. Tests: frontend 178/178, lint clean, build OK. The only backend failures are pre-existing and unrelated to this job. There is no migration, no new dependency or env var, and no change to local-agent/agent.py.
It is still not safe to merge without a human. The change edits two Lambdas, `backend/v1/admin_api/lambda_function.py` (adds `none -> assembled`, a 409 after «Собран» and a new `assembled:req_…` claim key) and `backend/v1/telegram_notifier/lambda_function.py` (adds the `pharmacy_order_assembled` kind). The new Vercel UI only posts `{state:'assembled'}` from no state, which the live Lambda rejects. So the code must be deployed in this order: admin Lambda, then notifier Lambda, then Vercel. Deploying Vercel first breaks «Собран» for both pharmacies.
Before `/factory approve`, a human must schedule and run those deploys in that order (or merge and deploy right away), and then do one live «Собран» to check that the courier and owner get «Заказ собран».
Product points for the owner to accept or send back with `/factory rework`:
(1) If «Ватан 2» marks its last item «Нет в наличии» after «Ватан 1» already pressed «Собран», no «Заказ собран» message is sent.
(2) The pharmacy cannot undo «Нет в наличии» or «Собран»; the owner corrects mistakes.
(3) The «Сборка сделана» wording stays in the courier block message and the admin alarm settings (needs a follow-up).
