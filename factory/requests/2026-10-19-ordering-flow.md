# Запрос владельца 2026-10-19 (дословно)

listen the ordering here what to need to do and how , first of all the check box of the courier i should see as admin, order that goes to vatan_1 the list of medicines the button В наличии should be in that table , also vatan_1 if they want to change the price they also need to make in that table if there no that medicine there and it sended to vatan_2 it should be vatan_2 and about notification notification should be coming till the pharmacy not press button collected and if vatan_1 press button collected it nothing happend in status of the order in courier or admin or client , also if the price is changed or there is no in vatan_1 and it sended to vatan_2 it also shold come notififcation to me and courier, also sound like i installed this web-site staff/login : vatan_1  as app in win 11 but when they closed it there no any notification and make the notification sound 10 second long that they understand that there a new order

## Ответы владельца на уточнения (2026-10-19)
- «Сборка сделана» должна менять статус заказа.
- Уведомления владельцу и курьеру об изменении цены / передаче во «Ватан 2»: «И то, и другое» — Telegram сейчас, push — когда будет Web Push.
- Про статусы (дословно): «listen maybe remove some status but look to my idea when new order comes it should be firstly collected by pharmacy and marked as collected if it collected then we can go on , after collecting we call to customer ask for money say about price of the delivery when we deliver if it is accually the medincines are collected, so accoring this idea need to make status what idea you have»
- Владелец ответил «да» на предложенную схему:
  1. Заказ пришёл, аптеки собирают → клиент видит «Собирается» (DB: pending, сборка не завершена).
  2. Все аптеки нажали «Сборка сделана» → автоматически «Собран» (DB: pending + все аптеки собрали; вычисляется из отметок, без новой колонки статуса).
  3. Курьер позвонил (сумма лекарств и доставки, оплата, время) и нажал «Согласовано» → «Подтверждён» (DB: confirmed).
  4. «В пути» (DB: delivering). 5. «Доставлен» (DB: delivered).
  Статус «В обработке» для клиента убирается. Миграция статусов не нужна.
- План: задача 013 = админ видит чек-лист курьера и отметки сборки; «Ватан 1» — «В наличии»/«Нет в наличии»/изменение цены прямо в таблице лекарств, ушедшие позиции видны как «Ватан 2»; напоминания аптеке до «Сборка сделана», звук ~10 секунд; новые статусы (выше) у клиента, курьера и админа; Telegram владельцу и курьеру об изменении цены и передаче во «Ватан 2». Задача 014 = Web Push только для /staff (установленное приложение, включая Windows 11), уведомления при закрытом приложении аптекам, владельцу и курьеру.
