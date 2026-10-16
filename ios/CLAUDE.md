# Аптека «Ватан» — iOS-приложение (AptekaV): инструкции для Claude Code

Эти правила дополняют корневые [`../CLAUDE.md`](../CLAUDE.md), [`../AGENTS.md`](../AGENTS.md),
[`../API_CONTRACT.md`](../API_CONTRACT.md) и [`../UI_DESIGN_SPEC.md`](../UI_DESIGN_SPEC.md)
и действуют для всего каталога `ios/`. При конфликте приоритет у корневых правил безопасности.

Проект: `ios/AptekaV/AptekaV.xcodeproj`, target `AptekaV`, bundle id `com.vatan.AptekaV`.

## Toolchain — жёсткие ограничения

- **Xcode 14.3.1, Swift 5.8, минимальная iOS 16.** Код обязан собираться этим toolchain.
- Запрещены API iOS 17+ и Swift 5.9+:
  - `@Observable`, `@Bindable`, `Observation` framework, `@Environment(Model.self)`;
  - макрос `#Preview` и любые другие макросы;
  - `SwiftData`, `@Query`, `ContentUnavailableView`, `.onChange(of:) { old, new in }` (двухпараметровая
    форма), `.scrollPosition`, `.containerRelativeFrame`, `.sensoryFeedback`, `TipKit`;
  - `if`/`switch` как выражения, parameter packs (Swift 5.9).
- Использовать: `ObservableObject` + `@Published`, `@StateObject` / `@ObservedObject` /
  `@EnvironmentObject`, `NavigationStack` + `navigationDestination` (iOS 16), `async/await`,
  `PreviewProvider` для превью.
- Для API, доступных только с iOS 16.x (x > 0), использовать `if #available` или не использовать.
- Без сторонних зависимостей (SPM/CocoaPods), пока это явно не согласовано с владельцем.

## Безопасность и граница API

- **В приложении нет и не может быть API-ключей, секретов, AWS URL, токенов или паролей** —
  ни в коде, ни в `Info.plist`, ни в `.xcconfig`, ни в Assets. Всё, что лежит в IPA, считается публичным.
- Приложение обращается **только к публичным маршрутам `/api/*` сайта на Vercel** (HTTPS).
  Прямые вызовы API Gateway (`/v1/*`), Lambda или RDS запрещены.
- Разрешённые маршруты (только public):
  - `GET  /api/search?q=&limit=&cursor=`
  - `GET  /api/categories?limit=&cursor=`
  - `GET  /api/categories/{slug}/medicines?page=&limit=`
  - `GET  /api/medicines/{medicine_id}`
  - `POST /api/medicines/resolve` — `{ "medicine_ids": [..] }`, 1–50 уникальных ID
  - `POST /api/checkout` — заголовок `Idempotency-Key` (UUID) обязателен
  - `POST /api/tracking` — `{ "phone": "..." }`
  - `GET  /api/site-settings`
  - `GET  /api/homepage-banners`, `GET /api/product-carousels` — **ещё не существуют на сайте**
    (404). Приложение уже их вызывает; до появления маршрутов ряды товаров строятся из категорий,
    а баннеры показываются только в Debug как «демо».
- **Запрещено** вызывать `/api/admin/*`, `/api/staff/*`, логин/логаут и любые mutation-маршруты,
  кроме checkout. Админ- и курьерских функций в приложении нет.
- Базовый URL сайта — одна константа конфигурации (Debug/Release), только `https://`.
  Не отключать ATS и не добавлять исключения `NSAllowsArbitraryLoads`.
- Не логировать телефон, имя, адрес и тело заказа (`print`/`os_log` только без PII).
- Данные формы оформления (имя, телефон, адрес) можно хранить локально только как удобство
  для пользователя; не хранить их в `UserDefaults` вместе с чем-то, что уходит в аналитику.

## Бизнес-правила (из API_CONTRACT / UI_DESIGN_SPEC)

- Товар идентифицируется только по `medicine_id`; название — отображаемый snapshot.
- **Клиент никогда не отправляет цены и суммы.** В позиции заказа только `medicine_id` и `quantity`.
  Цены и итог в корзине — оценка; авторитетный итог — ответ сервера.
- Количество: **целое, шаг 1, от 1 до 99** (решение владельца). `/api/checkout` принимает и
  дробные `0.5–99`, но приложение отправляет только целые. Не более 50 уникальных позиций,
  без дублей `medicine_id`.
- Минимальная сумма заказа — **50 TJS**; кнопка оформления неактивна ниже порога.
- Доставку не считать и не показывать суммой. Обязательный текст:
  **«Стоимость доставки рассчитывается и оплачивается напрямую курьеру при доставке»**.
- Оплата только при получении; никаких полей карты и платёжных логотипов.
- Нет в наличии → нельзя добавить в корзину.
- Отслеживание только по номеру телефона (9 цифр или `+992…`).
- Не показывать `base_unit_price`, внутренние ID синхронизаций, медицинские советы и выдуманные
  описания — только поля, которые реально возвращает API.

## Сеть

- `URLSession` + `async/await`, явный timeout (≈15 с), отмена задач при уходе с экрана/вводе.
- Повторы — только для GET с ограниченным backoff. `POST /api/checkout` повторять только
  с **тем же** `Idempotency-Key`; новый ключ — только для нового заказа.
- Проверять HTTP-статус и форму JSON до декодирования; ошибки — по `error.code`
  (`VALIDATION_ERROR`, `MEDICINE_NOT_FOUND`, `ORDER_ITEMS_UNAVAILABLE`,
  `MINIMUM_ORDER_NOT_REACHED`, `IDEMPOTENCY_CONFLICT`, `429` и т.д.).
- Пользователю — человекочитаемые русские сообщения, без технических деталей.

## UI

- Язык интерфейса — русский. Цвета и тексты — из `UI_DESIGN_SPEC.md`
  (`brand-primary #E31E24` и т.д.), иконки — SF Symbols, без эмодзи.
- Минимальная зона нажатия 44×44 pt, поддержка Dynamic Type, VoiceOver-лейблы для иконок,
  статус не только цветом.

## Вход по SMS

- Вход: `+992` и 9 цифр → SMS-код из 5 цифр (`Views/Auth/LoginView.swift`, `App/AuthStore.swift`).
- Сейчас `MockPhoneAuthService`: SMS не отправляется, код всегда `12345`. **Заменить до релиза** на
  вызов `/api`-маршрута сайта (Lambda + SMS-провайдер, rate limit, хранение только хеша кода).
  Ключи SMS-провайдера никогда не попадают в приложение.
- Решение владельца (10/2026): вход **не** на старте. Номер спрашивается при оформлении заказа
  или по кнопке «Войти или зарегистрироваться» в «Профиле» (`loginSheet`).

## Панель «Дизайн» (только для разработки)

- `App/DesignPanel.swift` и все `*Gallery*`/`*Comparison*` экраны компилируются только в `DEBUG`.
  Открывается кнопкой 🎨 в навбаре или встряхиванием (⌃⌘Z в симуляторе).
- Выбор (главная, нижняя панель, поиск, карточка) хранится в `DesignSettings`; в Release всегда
  используется `DesignSettings.production` — обновить его, когда владелец утвердит дизайн.
- Перед релизом: удалить панель, галереи и неиспользуемые стили.
- Launch arguments для скриншотов: `-homeStyle N -tabBarStyle N -searchBarStyle N -cardStyle N
  -productStyle N -initialTab N -searchQuery TEXT -openDesignPanel YES -openMedicineId N
  -auth.phone +992XXXXXXXXX -showLogin YES -loginPhone 9ЦИФР`.

## Рабочий процесс

- Работать в ветке (сейчас `ios-app`), не коммитить в `main`.
- Не коммитить `xcuserdata/`, `DerivedData/`, `*.xcuserstate`, сборки и `.env*`.
- Проверка: `xcodebuild -project ios/AptekaV/AptekaV.xcodeproj -scheme AptekaV
  -destination 'platform=iOS Simulator,name=iPhone 14' build` (и `test` для unit-тестов).
  Сообщать, что именно было запущено.
- Не создавать реальные заказы на production при проверке; checkout тестировать на моках/stub.
- При изменении протокола взаимодействия с сайтом обновлять этот файл.
