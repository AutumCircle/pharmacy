# 012-pharmacy-order-alerts: on-screen signal, sound and 3-minute reminders for pharmacies; notification permission check

## Owner request (verbatim)
Source: `factory/requests/2026-10-16-pharmacy.md`.

> Оповещения: при новом заказе показать уведомление аптеке. Пока фармацевт не отреагировал на заказ, повторять напоминание примерно каждые 3 минуты; после ответа прекратить повторы. Для приложения, установленного с сайта на главный экран, предусмотреть push-уведомления и проверку разрешения на них. В открытом приложении можно добавить заметный экранный сигнал и звук. Проверить это на конкретных устройствах аптек: браузер и настройки устройства могут ограничивать автоматическое воспроизведение звука и показ уведомлений.

The owner's latest flow, from `factory/jobs/011-pharmacy-assembly-marks/rework-1.md` (excerpt): «Когда клиент оформил заказ, уведомление приходит и аптеке. vata_1 должна зайти на сайт нажать начать сборку…». Items that «Ватан 1» marks «нет в наличии» go to «Ватан 2» automatically.

This job is built on top of job 011 (branch `factory/011-pharmacy-assembly-marks`, which merges first).

## Goal
Today only the courier gets the new-order toast and chime (`src/components/NewOrderAlerts.tsx`,
`enabled={role === 'courier'}` in `src/app/staff/StaffShell.tsx`). A pharmacist with `/staff/orders`
open gets no signal at all. After this job, «Ватан 1» and «Ватан 2» each get, while the staff page is
open:
- a noticeable on-screen signal;
- an optional sound;
- a reminder about roughly every 3 minutes for every order **this pharmacy has not reacted to yet**.

The reminders stop as soon as the pharmacy reacts. A notification-permission check also shows
whether this device can get system notifications and what to do if it cannot. Real Web Push
delivery while the app is closed (installed PWA) needs VAPID secrets, a migration and a sender. It
is split into follow-up **012b** (see Risks).

### Interpretation (decisions pinned by this spec)
- **"Not reacted" (per order and pharmacy).** The order is in this pharmacy's queue (live website
  order, `pending`/`confirmed`, at least one item effectively assigned to this pharmacy). It is
  unreacted while both of these hold:
  - the pharmacy has no 011 assembly mark (pressed neither «Начать сборку» nor «Собран»);
  - it has answered none of its assigned items (010 answers).

  Any of those actions counts as a reaction and stops the reminders for that order.
- **When the clock starts.**
  - «Ватан 1»: the order's `created_at`.
  - «Ватан 2»: the earliest `pharmacy_assigned_at` (010) among the items routed to it. An order
    routed to «Ватан 2» is therefore a *new* order for «Ватан 2» at routing time.
- **Lambda computes it.** `list_pharmacy_preparation_orders` adds two ungated fields with no client
  data and no migration:
  - `needs_attention: boolean`;
  - `attention_since: ISO | null`, which is non-null only when `needs_attention` is true.

  The frontend never derives reaction from policy-gated item data.
- **How the page learns about orders.** Reuse the existing `GET /api/staff/orders`. For a pharmacy
  session, Lambda already returns the pharmacy queue. Poll every 30 s, plus an immediate poll on
  `visibilitychange` back to visible. No new endpoint.
- **Repeat.** `REMIND_MS = 180_000`. On each poll, an order with `needs_attention` alerts in either
  case:
  - it is new to this page;
  - at least `REMIND_MS` has passed since its last alert on this page.

  The last-alert times live in memory (a ref), so a reload re-alerts once, which is acceptable. When
  `needs_attention` becomes false, or the order leaves the queue, that order's toast is removed and
  it never alerts again.
- **The signal.**
  - A toast per order, linking to `/staff/orders`.
  - The title counter `(N)` = the number of orders with `needs_attention`.
  - A persistent banner at the top of `/staff/orders`: «Новых заказов без ответа: N».
- **The sound.**
  - The explicit control is «Включить звук» / «Звук включён». The preference is saved in
    `localStorage`, under a key separate from the courier/admin key: `vatan-pharmacy-sound`.
  - Browsers need a user gesture before audio can play. So after a reload with the preference on,
    the page creates the AudioContext on the first tap or keypress. Until then the control reads
    «Нажмите, чтобы включить звук».
  - If the sound fails to play, the on-screen signal is still shown.
- **Permission check.** A small panel on `/staff/orders` for pharmacies shows one of these states:
  - «Уведомления разрешены»;
  - «Уведомления запрещены — включите их в настройках браузера»;
  - «Не запрошено» with a button «Разрешить уведомления» that calls `Notification.requestPermission()`
    from the tap;
  - «Этот браузер не поддерживает уведомления».

  It also says whether the app runs installed (`display-mode: standalone` / `navigator.standalone`).
  On iOS when not installed, it shows the hint «На iPhone уведомления работают только для приложения,
  добавленного на экран „Домой“ (iOS 16.4+)».
- **In-page system notification.** When the permission is granted and the tab is hidden, a
  system notification is attempted, guarded by try/catch. `new Notification` throws on Android
  Chrome without a service worker. That is accepted in 012; reliable delivery comes in 012b.

## Scope
- `backend/v1/admin_api/lambda_function.py` → `list_pharmacy_preparation_orders`:
  - add `needs_attention` and `attention_since` as defined above, from the existing LATERAL/EXISTS
    data (011 assembly table, 010 answers and `pharmacy_assigned_at`), with no N+1 queries;
  - the fields are not gated by `pharmacy_web`.
- `src/lib/api-v1/staff-types.ts`: optional `needs_attention?` and `attention_since?` on the pharmacy order type.
- New pure helper `src/lib/pharmacy-alerts.ts`:
  - `REMIND_MS`;
  - `dueAlerts(orders, lastAlerted, now)`, which returns the order ids to alert now and the updated map;
  - `alertText(order)`, which returns the title «Новый заказ № {order_reference}» (fallback: the last
    6 characters of `order_id`) and the body «Ожидает ответа N мин»;
  - `permissionView(...)`, which maps permission, support and installed state to Russian copy.
- `src/components/NewOrderAlerts.tsx`: generalize it, or add a sibling `PharmacyOrderAlerts.tsx`.
  The courier/admin behaviour must stay byte-for-byte equivalent: 30 s polling, the
  `vatan-order-sound` key, and alerts only for new ids.
- `src/app/staff/StaffShell.tsx`: mount the pharmacy alerts for `role === 'pharmacy'`.
- `src/app/staff/orders/page.tsx` (pharmacy branch): the banner and the permission panel, as a new
  client component, e.g. `src/app/staff/orders/NotificationPermission.tsx`.
- `src/app/staff/staff.css`: styles readable at 360 px.
- `package.json`: add `tests/pharmacy-alerts.test.ts` to `test:frontend`.
- `API_CONTRACT.md` (pharmacy queue section): the two fields and their rules.
- **Out of scope:**
  - the Web App Manifest, service worker, VAPID keys, push subscription storage, a push sender and
    any migration (all of this is follow-up 012b);
  - Telegram messages to «Ватан 2» on routing (follow-up, see Risks);
  - customer statuses and `/tracking`;
  - courier and admin alert behaviour;
  - 010/011 answer, routing and assembly logic;
  - `backend/local-agent/agent.py`;
  - API Gateway.

## Acceptance criteria
1. **Lambda fields.** For pharmacy N, `GET /v1/staff/orders` returns `needs_attention` and
   `attention_since` on every order. The behaviour is:
   - `needs_attention` is true for an order with no answer from N and no assembly mark from N;
   - one answered item, or an `assembling`/`assembled` mark, makes it false and `attention_since` null;
   - for «Ватан 2» on a routed order, `attention_since` equals the earliest `pharmacy_assigned_at`
     of the items routed to it; for «Ватан 1» it is `created_at`;
   - both fields are present under an all-off `pharmacy_web` policy;
   - no new SQL writes and no new migration.
2. **Repeat logic (pure).** `dueAlerts` behaves as follows:
   - it alerts an order the first time it is seen with `needs_attention`;
   - it does not alert again before 180 s;
   - it alerts again at ≥ 180 s;
   - it never alerts an order with `needs_attention: false`, or one absent from the list;
   - it alerts nothing when the field is missing (old Lambda).
3. **On-screen signal.** With a pharmacy session and an unreacted order:
   - a toast and the banner «Новых заказов без ответа: N» appear within one poll (≤ 30 s);
   - the title shows `(N)`;
   - after the pharmacist answers or presses «Начать сборку», the toast, the banner count and the
     reminders for that order disappear within one poll.
4. **Sound.**
   - «Включить звук» plays the chime at once (the tap is the gesture) and saves `vatan-pharmacy-sound=1`.
   - After a reload, the control reads «Нажмите, чтобы включить звук» until the first tap. After
     that, reminders chime.
   - Turning sound off stops the chimes. The courier's `vatan-order-sound` is unaffected.
5. **Permission panel.** It shows the correct Russian state for granted, denied, default and
   unsupported. «Разрешить уведомления» requests permission only from a tap. The iOS non-installed
   hint shows only on iOS outside standalone mode.
6. **Privacy.** Toast, notification and title text contain only the order reference and the waiting
   minutes. They contain no name, phone, address, landmark, comment or amounts, whatever the
   `pharmacy_web` policy is.
7. **Manual device check (required before approval).** On the real pharmacy devices («Ватан 1» and
   «Ватан 2»; record the model and browser), check:
   - Android Chrome: the toast, the chime after a tap, and a reminder after ~3 min;
   - iPhone Safari in the tab and as a home-screen app: the same;
   - the permission panel state on each device;
   - the screen lock and battery-saver behaviour, with a note on what stops when the screen is off.
8. **Gates:** `npm run lint`, `npm run build`, `npm run test:frontend` and
   `python -m unittest discover -s backend/tests -t .` pass, apart from failures already known on main.

## Tests
- `tests/pharmacy-alerts.test.ts` (new):
  - every AC2 case for `dueAlerts`;
  - the `alertText` fallback and no PII, even when the order object carries `customer_name`,
    `phone` and `address`;
  - `permissionView` for every state, plus the iOS/standalone hint.
- `backend/tests/test_staff_accounts.py` (extend, mocked cursor):
  - `needs_attention` / `attention_since` for an unreacted order, an answered order, an order with
    an assembly mark, and a «Ватан 2» routed order (since = assigned time);
  - both fields survive an all-off `pharmacy_web` policy.
- `backend/tests/test_pharmacy_answers.py` / the 011 assembly tests: unchanged and still passing.

## Risks
- **ESCALATE: Lambda deploy.** The admin Lambda changes (`admin-api-v1.zip`), with no migration. The
  deploy must come after 011's 0025 and Lambda. The UI must tolerate an old Lambda: with no
  `needs_attention`, there are no reminders and nothing breaks. The deploy is not part of this job.
- **ESCALATE: follow-up 012b Web Push.** This is the part that works while the app is closed or
  installed. It needs:
  - a Web App Manifest and service worker (there is none today: no `manifest`, no `sw.js` in
    `src/app` or `public/`). Adding a manifest makes the whole public site installable, so its
    scope and start URL need an owner decision;
  - VAPID keys. The private key is a server-only Lambda secret. Only the public key may be
    `NEXT_PUBLIC_*`;
  - a new migration for `push_subscriptions` (per staff account and device);
  - a Lambda endpoint to save and delete subscriptions;
  - a sender (an extension of the notifier Lambda, or a new one) triggered on order creation and
    routing, with the 3-minute repeat done server-side (a scheduler such as EventBridge);
  - a Python `pywebpush`/`cryptography` dependency in the Lambda bundle.

  That means infra, secrets, a migration, a new dependency and live AWS changes. Owner approval is
  needed before 012b is specced.
- **Follow-up: Telegram to «Ватан 2».** `backend/v1/telegram_notifier` has a single
  `TELEGRAM_PHARMACY_CHAT_ID` («Аптека 1»), and the notifier is only invoked at order creation.
  Notifying «Ватан 2» at routing time needs a new chat id env var, an invocation from the admin
  Lambda on the 010 answer path, and a policy channel. This is infra plus a Lambda env change, so it
  is not part of this job; it is proposed as a separate follow-up.
- **Platform limits.**
  - Without push (012b), alerts work only while the page is open and in the foreground. Mobile
    browsers throttle or stop timers in background tabs and when the screen is locked.
  - iOS Safari supports Web Push only for home-screen apps (iOS 16.4+).
  - Autoplay rules can block sound until a tap.

  Hence the manual check in AC7.
- **Privacy.** Notification text can show on a lock screen. It is fixed to the reference and minutes
  only, because `pharmacy_web` hides client data by default.
- **Windows 7 agent:** not affected. `backend/local-agent/agent.py` must not change.
- **Russian copy:** all new labels are in Russian and use the names «Ватан 1» / «Ватан 2».
