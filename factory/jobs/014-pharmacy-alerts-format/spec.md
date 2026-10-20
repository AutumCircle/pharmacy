# 014-pharmacy-alerts-format: sound always on, minute-long repeating alarm with admin ringtones, «Ватан 2» alerts after routing, one compact order format for both pharmacies

## Owner request (verbatim)
Source: `factory/requests/2026-10-20-alerts-and-format.md` (voice input, 2026-10-20).

> Сейчас проблема первая. Когда заходишь на сайт и даешь разрешение уведомлению, уведомление приходит, но когда ты обновляешь страничку, кнопка «Звук включен» переходит в режим. Нажмите, чтобы включить звук. Или ты закрываешь приложение и открываешь, и нужно нажать эту кнопку. Но у фармацевтов нет времени. То есть, не... вот это, когда ты разрешаешь, оно всегда должно быть включенным. Зачем тут кнопка, чтобы разрешить, не разрешить? Звук всегда должен быть включенным. И пусть будет эта кнопка, просто показывающая, что звук есть. Чтобы нажать на нее, чтобы был звук. Но при обновлении, почему он переходит в режим «включите звук»? Вторая проблема – это длительность уведомления. Длительность уведомления. Здесь 7 секунд. Интервал 50 или 1 минута. Длительность уведомления должна быть минута. И каждую минуту это уведомление должно повторяться. В админ панели в уведомления заказов должно быть несколько рингтонов длиной минуту, из которых я мог выбрать. И также я сам смог указать длину уведомления и частость повторения уведомлений. Третье уведомление на аптеку Ватан 2 не приходит. Например, я говорю, что нет в наличии и утверждаю, что этот заказ уходит в аптеку Ватан 2. И после того, как он ушел в апте Также мне не нравится формат заказа, как который приходит в аптеку Ватан и в аптеку 2. Смотри, у них они должны быть идентичный формат, как и в аптеке 1, как и в аптеке 2. Так, и они не должны большие кнопки, просто возле суммы должна быть кнопка в наличии или не в наличии. Или если они хотят изменить цену, они просто над ценой должны нажать и изменить цену. И мне пусть приходит от этого уведомление, мне приходит уведомление. Нужно вот это добавить. ке Ватан 2, нет вот таких уведомлений, каждую минуту длительность по минуте.

> **Пояснение оркестратора владельцу (2026-10-20):** Браузер запрещает автоматический звук до первого действия пользователя на странице; полностью обойти нельзя. Предложено: звук включается от любого касания страницы (не только от кнопки); в установленном приложении (Chrome/Edge на Windows) пробовать играть сразу; системное уведомление Windows даёт свой звук; кнопка остаётся индикатором «Звук включён». Уведомления при закрытом приложении — отдельная задача Web Push (backlog).

## Interpretation (owner can correct)
1. **Sound is always on. There is no on/off switch.**
   - The pharmacy sound preference defaults to ON. It is stored in `localStorage` (`vatan-pharmacy-sound`), and a missing value or `'0'` counts as ON.
   - The pharmacy can no longer switch sound off from the control. The owner said «Звук всегда должен быть включенным».
   - On mount, the component creates the `AudioContext` straight away and tries `resume()`.
     - Chrome and Edge allow sound without a tap for an installed desktop PWA, or when the site's sound/autoplay permission is «Разрешить».
     - If the context is not `running`, it unlocks silently on the first `pointerdown` / `keydown` / `touchstart` anywhere on the page.
   - The control is a status indicator:
     - «Звук включён» when audio is running;
     - «Звук включён — коснитесь экрана» while the browser still blocks it. Tapping the control is just one such touch.
   - The text «Включить звук» / «Нажмите, чтобы включить звук» disappears.
   - **What browsers forbid (honest limit):** in an ordinary browser tab after a reload, no page can play Web Audio before the first user interaction. So the following always fire as well, and play the OS sound with no gesture:
     - the on-screen toast;
     - the title counter;
     - a system `Notification`, when permission is granted. It fires on every due alert whether the page is visible or hidden, with `tag: pharmacy-<id>` and `renotify: true`.
   - The staff page shows a one-line hint: «Чтобы звук работал сразу, установите приложение или разрешите звук для сайта в настройках браузера».
2. **Alarm: 60 s long, repeated every 60 s, for both «Ватан 1» and «Ватан 2»,** until that pharmacy presses «Сборка сделана». The Lambda `needs_attention` is unchanged.
   - The per-pharmacy split goes away: `REMIND_MS` and `PHARMACY_ONE_REMIND_MS` become one configurable interval.
   - The owner configures these on the admin page «Уведомления заказов»:
     - a **ringtone**: one of 4 Web Audio tones generated in code, with no audio files or copyrighted material. Ids are `classic` «Классический», `bell` «Колокол», `pulse` «Пульс», `melody` «Мелодия». Each is a short pattern repeated to fill the duration;
     - a «Прослушать» preview button that plays 5 s and has a stop button;
     - **duration** in seconds: integer 5–120, default 60;
     - **repeat interval** in seconds: integer 30–600, default 60;
     - the rule duration ≤ interval, so alarms never overlap.
   - A new due alert stops the previous alarm. The alarm stops at once when no order needs attention.
   - The client clamps values to these bounds. It also falls back to the defaults if the Lambda is old or the values are missing or invalid.
3. **No alert at «Ватан 2» after routing.** The code shows a real backend cause, and the client makes things worse.
   - **Backend (proven by reading the code):**
     - `order_pharmacy_assembly` is forward-only. `_sync_item_assembly` only goes `assembling`→`assembled`, and the routing `UPDATE order_items SET fulfillment_pharmacy_id = 2` in `answer_pharmacy_order_items` does not touch «Ватан 2»'s part.
     - Example: «Ватан 2» finishes one routed item, so its part is `assembled`. Then «Ватан 1» routes a second item. «Ватан 2»'s `needs_attention` stays `false`: no alert, no banner, no counter.
     - The same stale mark also makes the order stage «Собран» and lets the courier's «Согласовано» through (`_require_assembly_complete`) while the new item is still uncollected.
     - **Fix:** in the same transaction as the routing, reopen «Ватан 2»'s part: `UPDATE order_pharmacy_assembly SET state = 'assembling', assembled_at = NULL WHERE order_id = %s AND pharmacy_id = 2 AND state = 'assembled'`. Write one audit row `pharmacy.order.assembly_reopened`. Items already collected keep their «Собрано».
   - **Client:**
     - «Ватан 2» repeats only every 180 s, with a 10 s chime;
     - after a reload, sound is locked until someone taps the «Нажмите…» button;
     - the system notification fires only when the tab is hidden.

     For a visible «Ватан 2» screen that adds up to "nothing rings". Points 1–2 fix this.
   - **The builder must also confirm** two more things:
     - account 2 → `pharmacyId` 2 → Lambda `pharmacy_id` 2 in the queue;
     - the routed order appears on the first page of «Ватан 2»'s `/api/staff/orders` with `needs_attention: true`.

     If another cause turns up, fix it and record it in `build.md`. Orders created by the courier («Новый заказ», `created_by_staff_account_id` set) are excluded from pharmacy queues by design. This job does not change that.
4. **One order format for «Ватан 1» and «Ватан 2».**
   - Both pharmacies get the same card and the same table. «Ватан 2»'s routed items move out of the footer list (`PharmacyRoutedItems`) into the table rows.
   - In each own row of a `pending` order:
     - small compact buttons «В наличии» / «Нет в наличии» sit right next to the line sum, in the same cell or an adjacent narrow cell. There is no separate full-width action row and there are no big buttons;
     - tapping the price itself turns it into an inline input. Enter or «✓» saves; Esc or «×» cancels. The pharmacy (base) unit price is sent as `available` + `base_unit_price`.
   - «Собрано» for «Ватан 2» stays as a small per-row control in the same place.
   - **«Нет в наличии»:**
     - at «Ватан 1» it keeps its inline confirmation, then routes the item to «Ватан 2»;
     - at «Ватан 2» it gets the same confirmation, and the chip becomes «Нет в наличии в обеих аптеках».
   - Rows routed away from «Ватан 1» stay read-only with their chip, as in 013. «Начать сборку» / «Сборка сделана» stay in the footer.
5. **The owner is told about every change.**
   - Job 013 already sends owner and courier Telegram for a price change by either pharmacy and for routing. This job verifies that with tests along the full path:
     - Lambda `_notification`;
     - the `pharmacy-answers` route `after()`;
     - the notifier `pharmacy_item_change` branch;
     - the claim regex.
   - It also adds the missing case: a «Нет в наличии» from «Ватан 2» sends `kind: "unavailable_both"`, with the line «— нет в наличии в обеих аптеках».
   - If verification finds the inline price edit going through any route other than `pharmacy-answers`, route it through `pharmacy-answers`.
   - Push notifications while the app is closed stay out of scope (Web Push backlog).

## Goal
Pharmacists at «Ватан 1» and «Ватан 2» no longer need a tap to get sound. The sound tries to start by itself and unlocks on any first touch. The OS notification always sounds. Every order that waits for «Сборка сделана» rings with the owner's chosen ringtone, for the owner's chosen duration and interval (default 60 s every 60 s). «Ватан 2» is alerted again when a new item is routed to it. Both pharmacies work in one compact table: buttons next to the sum, and tap the price to edit it. The owner gets a Telegram message for every price change, every routing, and every «нет в обеих».

## Scope
- **Backend:**
  - `backend/v1/shared/order_notification_settings.py`:
    - adds `pharmacy_alarm = {ringtone, duration_seconds, interval_seconds}` with defaults, bounds and an allowlist of ringtones;
    - `effective_settings` returns it;
    - `validate_update` accepts it as a required fourth payload key.
  - Storage: **no migration.** The value is kept inside the existing `policies` JSONB under the reserved key `pharmacy_alarm`. `effective_settings` still iterates `CHANNELS` only, and the update merges the key in. If the builder finds this unworkable, the fallback is the additive `db/migrations/0027_pharmacy_alarm_settings.sql` (`ADD COLUMN IF NOT EXISTS pharmacy_alarm JSONB NOT NULL DEFAULT '{}'`), and must flag it.
  - `backend/v1/admin_api/lambda_function.py`:
    - get/update/preview of the settings. The write stays admin-only (`require_admin_identity`), with audit details including `pharmacy_alarm`;
    - `list_pharmacy_preparation_orders` returns top-level `alarm` (ringtone, duration, interval). It already reads the settings row, so there is no new query and no new pharmacy endpoint;
    - the routing reopen of «Ватан 2»'s part;
    - `_notification` for «Ватан 2» `unavailable`.
  - `backend/v1/telegram_notifier/lambda_function.py`: the `unavailable_both` line in `format_pharmacy_change_message`.
- **Frontend:**
  - alarm and alerts:
    - `src/lib/pharmacy-alarm.ts`: ringtone patterns and `schedulePharmacyAlarm(context, ringtone, seconds)`;
    - `src/lib/pharmacy-alerts.ts`: one interval, labels, alarm config parsing/clamping;
    - `src/components/PharmacyOrderAlerts.tsx`: auto-unlock, always-on Notification, the alarm config from the queue response;
  - `src/app/staff/StaffShell.tsx` if the props change;
  - `src/app/admin/order-notifications/*`: ringtone select, preview, the two number fields with Russian validation messages;
  - the staff order table:
    - `src/app/staff/orders/PharmacyOrderCard.tsx`, `PharmacyRowActions.tsx`, `PharmacyRoutedItems.tsx` (merged into the row or removed);
    - `src/lib/pharmacy-order.ts`, `src/lib/pharmacy-answers.ts`;
    - staff CSS;
  - `src/lib/api-v1/staff-types.ts` and the admin settings types.
- **Docs:** `API_CONTRACT.md` (settings payload, queue `alarm`, `unavailable_both`), `docs/order-notification-settings-rollout.md`, and `docs/PROJECT_CONTEXT.md` (alert behaviour).
- **Out of scope:**
  - Web Push / service worker / closed-app notifications;
  - courier/admin `NewOrderAlerts`;
  - order stages and statuses;
  - `backend/local-agent/*`;
  - catalogue/pricing;
  - any deploy or live migration.

## Acceptance criteria
1. **Sound.** With no stored preference, and after a reload, the control never shows «Включить звук» or «Нажмите, чтобы включить звук». It shows «Звук включён» when the `AudioContext` is `running`, otherwise «Звук включён — коснитесь экрана». The first `pointerdown`/`keydown`/`touchstart` anywhere resumes audio with no extra confirmation. Pure helpers (`soundLabel`, preference parsing) are unit-tested. A manual check in installed Edge/Chrome on Windows records whether sound played without a tap.
2. **System notification.** When `Notification.permission === 'granted'`, every due alert creates a system notification, whether the page is visible or hidden. It has `tag` `pharmacy-<order_id>` and text from `alertText` only, so no client data appears.
3. **Alarm.**
   - `schedulePharmacyAlarm` schedules notes for each of the 4 ringtones. No note ends after `start + duration`.
   - Defaults are `classic` / 60 s / 60 s for both pharmacy ids. `remindIntervalMs` no longer depends on the pharmacy.
   - Invalid or missing config falls back to the defaults, and out-of-range values are clamped.
   - A new due alert stops the previous one.
4. **Admin settings.**
   - `GET /v1/admin/order-notification-settings` returns `pharmacy_alarm`.
   - `PATCH` accepts valid values and returns `VALIDATION_ERROR` for each of these:
     - an unknown ringtone;
     - a non-integer, `bool` or out-of-bounds duration or interval;
     - duration > interval;
     - missing or extra keys.
   - Existing rows without the key read as the defaults.
   - The channel policies are unchanged by the save. The audit row includes the previous and current `pharmacy_alarm`.
   - Non-admins get 401/403.
   - The admin page saves the values and plays the preview, with all copy in Russian.
5. **Pharmacy read.** The pharmacy queue response carries `alarm` for both pharmacy ids. `PharmacyOrderAlerts` uses it on the next poll.
6. **«Ватан 2» bug.** A backend test reproduces the bug and passes after the fix:
   - «Ватан 2» part `assembled`, then «Ватан 1» routes another item; «Ватан 2»'s `needs_attention` becomes `true`;
   - the reopen SQL runs in the same transaction as the routing, and only for `state = 'assembled'`;
   - the stage is no longer «Собран»;
   - `_require_assembly_complete` blocks «Согласовано».
7. **Format.**
   - Both pharmacies render the same table component.
   - Own pending rows show compact «В наличии» / «Нет в наличии» next to the sum, with no separate action row and no footer item list.
   - Tapping the price opens inline editing that posts `{answer: 'available', base_unit_price}`.
   - «Нет в наличии» asks for confirmation at both pharmacies.
   - Rows with `pharmacy_web` prices hidden show no price editor, as in 013.
   - `npm run lint`, `npx tsc --noEmit` and `npm run build` pass.
8. **Owner Telegram.**
   - Tests show `_notification` for each of these:
     - a «Ватан 1» price change;
     - a «Ватан 2» price change;
     - a «Ватан 1» routing;
     - a «Ватан 2» «Нет в наличии» (`unavailable_both`).
   - The claim accepts the key, the notifier formats each kind with no client data, and the Next route strips `_notification` and calls the notifier in `after()`.

## Tests
- `tests/pharmacy-alarm.test.ts`: every ringtone is bounded by duration; durations 5/60/120; the stop function stops all oscillators. Use a fake `AudioContext`.
- `tests/pharmacy-alerts.test.ts`: the new labels; preference defaults to on; the single interval; `dueAlerts` with a 60 s interval for both ids; alarm config parse/clamp/fallback.
- `tests/pharmacy-order.test.ts` and `tests/pharmacy-answers.test.ts`: the same row view for pharmacy 1 and 2; compact action flags; price-edit request; «Ватан 2» unavailable chip.
- `backend/tests/test_order_notification_settings.py`: `pharmacy_alarm` defaults, bounds, rejection of bad payloads, the round-trip in `effective_settings`, and that unknown JSON keys never leak into the channel policies.
- `backend/tests/test_staff_accounts.py`: the «Ватан 2» reopen reproduction (criterion 6); the queue `alarm` field; `_notification` for the four cases.
- `backend/tests/test_telegram_notifier.py`: the `unavailable_both` line; no client fields in any change message.
- How to run: `node --test tests/*.test.ts` and `python -m unittest discover backend/tests`.

## Risks
- **Deploys:** the admin Lambda (settings, queue `alarm`, reopen, `_notification`), the Telegram notifier Lambda (`unavailable_both`) and Vercel.
  - Deploy order: Lambdas first, then the frontend. The frontend tolerates a missing `alarm` and missing `pharmacy_alarm`.
  - The notifier must be deployed before or together with the admin Lambda. Otherwise `unavailable_both` lines are skipped; they are not an error.
  - The approver must escalate. Nothing is deployed by this job.
- **Migration:** none planned (JSONB key). If the fallback 0027 is used, it is additive and must not be run against live RDS without explicit approval.
- **Rollback:** an old admin Lambda saving the settings would drop `pharmacy_alarm`, and the defaults would then apply. This is acceptable and should be documented.
- **Annoyance and safety:**
  - a 60 s alarm every 60 s is close to continuous by design. The bounds (5–120 s, 30–600 s, duration ≤ interval) and a moderate gain (≤ 0.22) limit it;
  - the alarm stops the moment «Сборка сделана» clears `needs_attention`, on the next 30 s poll.
- **Browser limits:**
  - autoplay without a gesture is not guaranteed in an ordinary tab;
  - the OS notification sound depends on Windows Focus Assist and the site's notification setting;
  - iOS needs the installed app. Document this honestly in the UI hint.
- **Security:**
  - the alarm settings carry no client data;
  - only an admin can write them, and the Lambda validates them;
  - pharmacies only read them inside their existing session-scoped queue;
  - Telegram change messages keep 013's no-client-data rule;
  - only the Lambda runs SQL.
- **Lambda/RDS boundary:** unchanged. No Next.js DB access.
- **Windows 7 agent:** not touched (`backend/local-agent/agent.py` unchanged).
- **Copy:** all new UI text is Russian: «Звук включён», «Звук включён — коснитесь экрана», ringtone names, «Прослушать», «Длительность сигнала, сек», «Повторять каждые, сек», validation errors and «нет в наличии в обеих аптеках».
