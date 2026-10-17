# Аптека «Ватан» — iOS app (AptekaV)

SwiftUI app for aptekavatan.tj. It uses only the public `/api/*` routes of the website:
no API keys, passwords or AWS addresses are stored in the app.

## Requirements

- macOS with **Xcode 14.3.1** (Swift 5.8). Newer Xcode versions also open the project.
- iOS **16.4+** simulator or iPhone.
- No CocoaPods / Swift packages: nothing to install.

## Open and run on another Mac

```bash
git clone https://github.com/AutumCircle/pharmacy.git
cd pharmacy
git checkout ios-app
open ios/AptekaV/AptekaV.xcodeproj
```

In Xcode: choose the **AptekaV** scheme and a simulator (e.g. iPhone 14) → **⌘R**.

To run on your own iPhone: select the **AptekaV** target → *Signing & Capabilities* →
choose your Team (a free Apple ID works for testing). If Xcode says the bundle id is taken,
change `com.vatan.AptekaV` to something unique, e.g. `com.yourname.AptekaV`.

From the command line:

```bash
xcodebuild -project ios/AptekaV/AptekaV.xcodeproj -scheme AptekaV \
  -destination 'platform=iOS Simulator,name=iPhone 14' build
xcodebuild test -project ios/AptekaV/AptekaV.xcodeproj -scheme AptekaV \
  -destination 'platform=iOS Simulator,name=iPhone 14' -only-testing:AptekaVTests
```

## Development build vs App Store build

| | Debug (⌘R) | Release (App Store) |
|---|---|---|
| Design panel «Оформление приложения» (Профиль, or shake / ⌃⌘Z) | yes | no — fixed styles from `DesignSettings.production` |
| Orders | **simulated** (`TEST-…`) unless «Отправлять реальные заказы» is on in the panel | real |
| SMS login | test code **12345** (no SMS is sent yet) | same stand-in — must be replaced before release |
| «Сайт для данных» (Vercel preview address) | yes | always https://www.aptekavatan.tj |

## Project layout (`ios/AptekaV/AptekaV`)

- `App/` — app shell, tabs, navigation, stores (cart, favourites, sign-in), design settings and panel
- `Networking/APIClient.swift` — all calls to the website `/api/*`
- `Models/` — medicine, categories, banners, carousels, orders
- `Views/` — Home, Catalog, Product, Cart, Checkout, Orders, Favorites, Profile, About, Auth, cards, tab bar
- `Theme/` — brand colours

Rules for contributors (and AI agents) are in [`ios/CLAUDE.md`](CLAUDE.md).
