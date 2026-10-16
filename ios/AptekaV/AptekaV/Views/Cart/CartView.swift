import SwiftUI

/// «Корзина» (UI spec §8.6, cart state). Totals are estimates; the server recalculates prices.
struct CartView: View {
    @EnvironmentObject private var design: DesignSettings
    @EnvironmentObject private var cart: CartStore
    @Environment(\.openRoute) private var openRoute
    @Environment(\.selectTab) private var selectTab
    @EnvironmentObject private var auth: AuthStore
    @State private var showCheckoutNotice = false
    @State private var showLogin = false

    private var canCheckout: Bool {
        !cart.items.isEmpty && cart.amountToMinimum == 0 && cart.items.allSatisfy(\.medicine.inStock)
    }

    var body: some View {
        ScrollView {
            if cart.items.isEmpty {
                StateMessageView(icon: "cart", title: "Ваша корзина пуста", actionTitle: "Перейти в каталог") {
                    selectTab(.catalog)
                }
                .padding(.top, 60)
            } else {
                VStack(alignment: .leading, spacing: 16) {
                    MedicineCollectionView(
                        medicines: cart.items.map(\.medicine),
                        style: design.rowCardStyle,
                        onOpen: { openRoute(.medicine($0)) }
                    )
                    summary
                }
                .padding(16)
            }
        }
        .background(AppBackground())
        .navigationTitle(cart.items.isEmpty ? "Корзина" : "Корзина · \(cart.totalQuantity)")
        .designPanelButton()
        .task { await refreshPrices() }
        .loginSheet(isPresented: $showLogin) {
            // Wait for the sheet to close; an alert presented during dismissal is dropped.
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.7) { showCheckoutNotice = true }
        }
        .alert("Оформление заказа", isPresented: $showCheckoutNotice) {
            Button("Понятно", role: .cancel) {}
        } message: {
            Text("Экран оформления заказа будет следующим этапом разработки.")
        }
    }

    private var summary: some View {
        VStack(alignment: .leading, spacing: 12) {
            row("Товары", PriceFormatter.string(cart.subtotal))
            Divider()
            row("Итого", PriceFormatter.string(cart.subtotal), bold: true)

            if cart.amountToMinimum > 0 {
                Label(
                    "Минимальная сумма заказа — 50 с. Добавьте товаров ещё на \(PriceFormatter.string(cart.amountToMinimum))",
                    systemImage: "info.circle"
                )
                .font(.system(size: 14))
                .foregroundColor(Theme.warningText)
            }

            Label("Стоимость доставки рассчитывается и оплачивается напрямую курьеру при доставке", systemImage: "shippingbox")
                .font(.system(size: 14))
                .foregroundColor(Theme.textSecondary)

            Button {
                // Ordering needs a verified phone number.
                if auth.isSignedIn {
                    showCheckoutNotice = true
                } else {
                    showLogin = true
                }
            } label: {
                Text("Перейти к оформлению")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundColor(.white)
                    .frame(maxWidth: .infinity, minHeight: 50)
                    .background(Capsule().fill(canCheckout ? Theme.brandPrimary : Theme.disabledFill))
            }
            .disabled(!canCheckout)
        }
        .padding(16)
        .background {
            if design.usesGlassBackdrop {
                GlassCardBackground(cornerRadius: 22)
            } else {
                RoundedRectangle(cornerRadius: 18, style: .continuous).fill(Theme.surfaceCard)
            }
        }
    }

    private func row(_ title: String, _ value: String, bold: Bool = false) -> some View {
        HStack {
            Text(title)
            Spacer()
            Text(value).monospacedDigit()
        }
        .font(.system(size: bold ? 18 : 15, weight: bold ? .bold : .regular))
        .foregroundColor(Theme.textPrimary)
    }

    /// Updates stored prices and availability from `/api/medicines/{id}` (max 50 items).
    private func refreshPrices() async {
        let ids = cart.items.map(\.id)
        guard !ids.isEmpty else { return }
        var fresh: [Medicine] = []
        await withTaskGroup(of: Medicine?.self) { group in
            for id in ids {
                group.addTask { try? await APIClient.shared.medicine(id: id) }
            }
            for await medicine in group {
                if let medicine = medicine { fresh.append(medicine) }
            }
        }
        cart.refresh(with: fresh)
    }
}

extension Theme {
    /// Readable warning text on light surfaces (orange #ED6C02 darkened for contrast).
    static let warningText = Color(hex: 0xB45309)
}
