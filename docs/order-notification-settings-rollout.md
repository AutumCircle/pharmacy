# Order notification settings rollout

Not deployed by the implementation change. Keep the public site on its current
version until the server-side gates are active.

1. Capture an RDS snapshot and save current code packages/configuration for
   `pharmacy-heartbeat-handler`, `pharmacy-query-handler`, and
   `pharmacy-telegram-order-notifier`. Do not log environment values.
2. Apply `db/migrations/0021_order_notification_settings.sql` once through the
   approved VPC Lambda migration path. Check the singleton row and empty claim
   table using read-only queries. The migration is additive and repeatable.
3. Generate a new random 32+ character `NOTIFICATION_CLAIM_TOKEN` outside the
   repository. Set the same value on Admin Lambda and notifier. On notifier,
   also set `NOTIFICATION_CLAIM_API_URL` to the existing API Gateway prod URL for
   `/v1/admin/order-notification-deliveries/claim`, and
   `NOTIFICATION_CLAIM_API_KEY` to the existing server-only Gateway key.
   `TELEGRAM_PHARMACY_CHAT_ID` is optional; absent means no pharmacy Telegram
   message. No values belong in Vercel browser variables or Git.
4. Build with `python scripts/build_lambda_packages.py`. Deploy
   `admin-api-v1.zip` to `pharmacy-heartbeat-handler`, then
   `telegram-order-notifier.zip` to `pharmacy-telegram-order-notifier`, then
   `public-api-v1.zip` to `pharmacy-query-handler`. Wait for each update and
   compare CodeSha256 to the local package. Confirm handlers unchanged.
5. Confirm the notifier can claim against the Admin API with the narrow token,
   without creating or sending a real order. Do not invoke a production
   notification as a test. Only then publish the Next.js commit to Vercel.
6. Verify the settings page is readable as admin and denied without admin auth;
   verify the pharmacy web response follows the saved policy. Do not mutate
   production orders for verification.

Job 014 (pharmacy alarm): no migration. The admin settings payload gains a
required `pharmacy_alarm` object `{ringtone, duration_seconds, interval_seconds}`
(`classic|bell|pulse|melody`, 5–120 s, 30–600 s, duration ≤ interval), stored
under the reserved key `pharmacy_alarm` of the existing `policies` JSONB. A row
without the key reads as classic / 60 s / 60 s. The pharmacy queue returns it as
top-level `alarm`. Deploy the Admin Lambda and the notifier (`unavailable_both`
line) before Vercel; the old settings page cannot save against the new Lambda
until Vercel is updated (missing `pharmacy_alarm` → `VALIDATION_ERROR`).
Rollback: an old Admin Lambda saving the settings rewrites `policies` without
`pharmacy_alarm`, so the pharmacies fall back to the defaults — acceptable.

Default field policy: owner sees all listed fields; courier sees contact,
address, items, quantities and client total, but not base cost or profit;
pharmacy Telegram sees reference, items, quantities, comment and base total;
pharmacy web sees reference, time, items, quantities, comment and status (no
client identity or address). Courier Telegram is enabled by default. No
pharmacy Telegram message is sent until its own chat ID is configured; the
owner chat is never used as a fallback. Courier-created orders still notify
only the owner; if a pharmacy employee can create orders in the future, those
go to owner and courier. Website orders go to owner, courier, and the pharmacy
Telegram chat if configured; pharmacy web remains the preparation queue.

Rollback: Prefer restoring the previous site first. Keep the additive tables
intact. If server rollback is needed, coordinate Admin and notifier together:
the new notifier must not run without the claim endpoint. Restoring the old
notifier also removes its courier switch enforcement, so warn the owner before
that step, especially if courier notifications are off. The RDS snapshot is a
last resort; do not restore it over live orders. Delivery claims are at-most-
once: an uncertain Telegram failure is not retried automatically to avoid
duplicate messages; investigate its logs and order state manually.
