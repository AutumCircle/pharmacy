# Factory backlog

`/factory next` takes the first unchecked item, runs it through the loop and ticks it off
as `- [x] … → <job-id>`. One feature per line; write it the way you'd brief a developer.

- [x] Rate-limit order tracking lookups: `/api/tracking` answers HTTP 429 with a Russian message after too many phone lookups from one client, so phone numbers can't be enumerated → 004-tracking-rate-limit
- [ ] Rate-limit `/api/checkout` per client so a script can't flood the pharmacy with fake orders; legitimate customers retrying once or twice must still succeed
- [ ] Экран заказа для аптек 1 и 2: номер и дата заказа, лекарства в читаемой таблице (название, количество, цена, сумма по позиции, итог), важные данные выделены цветом, каждая аптека видит только свои позиции, сколько минут заказ ждёт обработки. Дословный запрос и решения владельца: factory/requests/2026-10-15-courier-pharmacy.md
- [ ] Действия фармацевта: сначала «В наличии, цена верна» или «Нет в наличии / цена отличается» с указанием проблемы; после согласования «Начать сборку», затем «Собран»; курьер видит результат каждого действия. Статусы клиента не меняются. Дословный запрос и решения владельца: factory/requests/2026-10-15-courier-pharmacy.md
- [ ] Оповещения аптеки о новом заказе: уведомление, повтор примерно каждые 3 минуты до реакции фармацевта, экранный сигнал и звук в открытом приложении, push для приложения на главном экране с проверкой разрешения. Дословный запрос и решения владельца: factory/requests/2026-10-15-courier-pharmacy.md
