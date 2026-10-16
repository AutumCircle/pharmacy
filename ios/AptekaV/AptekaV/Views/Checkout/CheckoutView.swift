import SwiftUI

/// «Оформление заказа» (UI_DESIGN_SPEC §8.6, checkout and success states).
/// Opened from the cart once the phone number is verified by SMS.
struct CheckoutView: View {
    @EnvironmentObject private var cart: CartStore
    @EnvironmentObject private var auth: AuthStore
    @EnvironmentObject private var design: DesignSettings
    @StateObject private var model = CheckoutViewModel()
    @FocusState private var focused: CheckoutViewModel.Field?

    var body: some View {
        Group {
            if let order = model.placedOrder {
                OrderSuccessView(order: order, customerName: model.trimmedName, phone: auth.phone)
            } else {
                form
            }
        }
        .background(AppBackground())
        .navigationTitle(model.placedOrder == nil ? "Оформление заказа" : "")
        .navigationBarTitleDisplayMode(.inline)
        .navigationBarBackButtonHidden(model.placedOrder != nil || model.isSubmitting)
        // The page has its own bottom bar; the tab bar would cover it.
        .preference(key: HidesTabBarKey.self, value: true)
        .task {
            #if DEBUG
            // Launch argument `-autoSubmitCheckout YES` places a simulated order (screenshots).
            // Never runs when real orders are switched on.
            guard UserDefaults.standard.bool(forKey: "autoSubmitCheckout"), !OrderServiceFactory.sendsRealOrders else { return }
            if model.trimmedName.isEmpty { model.name = "Фируз" }
            if model.trimmedAddress.isEmpty { model.address = "Душанбе, ул. Айни 24" }
            try? await Task.sleep(nanoseconds: 800_000_000)
            await model.submit(cart: cart, verifiedPhone: auth.phone)
            #endif
        }
    }

    // MARK: Form

    private var form: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if let error = model.orderError {
                    errorBanner(error)
                }
                #if DEBUG
                if !OrderServiceFactory.sendsRealOrders {
                    Label("Тестовый режим: заказ не будет отправлен в аптеку", systemImage: "testtube.2")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundColor(Theme.warningText)
                }
                #endif
                recipientSection
                addressSection
                commentSection
                paymentSection
                summarySection
            }
            .padding(16)
            .padding(.bottom, 24)
        }
        .scrollDismissesKeyboard(.interactively)
        .safeAreaInset(edge: .bottom, spacing: 0) { submitBar }
        .disabled(model.isSubmitting)
    }

    private var recipientSection: some View {
        CheckoutSection(title: "Получатель") {
            LabeledField(title: "Имя", required: true, error: model.fieldErrors[.name]) {
                TextField("Как к вам обращаться", text: $model.name)
                    .textContentType(.name)
                    .submitLabel(.next)
                    .focused($focused, equals: .name)
                    .onSubmit { focused = .address }
                    .onChange(of: model.name) { _ in model.clearError(.name) }
            }
            LabeledField(title: "Телефон", required: true, error: nil) {
                HStack {
                    Text(auth.phone.map(TajikPhone.display) ?? "—")
                        .monospacedDigit()
                        .foregroundColor(Theme.textPrimary)
                    Spacer()
                    Label("Подтверждён", systemImage: "checkmark.seal.fill")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundColor(Theme.success)
                }
            }
        }
    }

    private var addressSection: some View {
        CheckoutSection(title: "Адрес доставки") {
            if model.savedAddresses.count > 1 {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(model.savedAddresses, id: \.self) { saved in
                            Button {
                                model.address = saved
                                model.clearError(.address)
                            } label: {
                                Text(saved)
                                    .font(.system(size: 13, weight: .medium))
                                    .lineLimit(1)
                                    .foregroundColor(model.trimmedAddress == saved ? Theme.brandPrimary : Theme.textPrimary)
                                    .padding(.horizontal, 12)
                                    .frame(height: 34)
                                    .background(Capsule().fill(model.trimmedAddress == saved ? Theme.brandSoft : Theme.surfaceMuted))
                            }
                        }
                    }
                }
            }
            LabeledField(title: "Адрес", required: true, error: model.fieldErrors[.address]) {
                TextField("Улица, дом, квартира, ориентир", text: $model.address, axis: .vertical)
                    .lineLimit(2...4)
                    .textContentType(.fullStreetAddress)
                    .focused($focused, equals: .address)
                    .onChange(of: model.address) { _ in model.clearError(.address) }
            }
        }
    }

    private var commentSection: some View {
        CheckoutSection(title: "Комментарий к заказу") {
            LabeledField(title: nil, required: false, error: model.fieldErrors[.comment]) {
                TextField("Например: позвоните перед доставкой", text: $model.comment, axis: .vertical)
                    .lineLimit(2...5)
                    .focused($focused, equals: .comment)
                    .onChange(of: model.comment) { _ in model.clearError(.comment) }
            }
            Text("\(model.trimmedComment.count)/\(CheckoutViewModel.commentMax)")
                .font(.system(size: 12).monospacedDigit())
                .foregroundColor(model.trimmedComment.count > CheckoutViewModel.commentMax ? Theme.danger : Theme.textSecondary)
                .frame(maxWidth: .infinity, alignment: .trailing)
        }
    }

    /// Non-interactive: the only MVP payment method.
    private var paymentSection: some View {
        CheckoutSection(title: "Оплата") {
            HStack(spacing: 12) {
                Image(systemName: "banknote")
                    .font(.system(size: 20))
                    .foregroundColor(Theme.brandPrimary)
                    .frame(width: 40, height: 40)
                    .background(Circle().fill(Theme.brandSoft))
                Text("Оплата лекарств при получении")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundColor(Theme.textPrimary)
                Spacer()
                Image(systemName: "checkmark.circle.fill")
                    .foregroundColor(Theme.brandPrimary)
            }
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.isSelected)
            Label("Стоимость доставки рассчитывается и оплачивается напрямую курьеру при доставке", systemImage: "shippingbox")
                .font(.system(size: 13))
                .foregroundColor(Theme.textSecondary)
        }
    }

    private var summarySection: some View {
        CheckoutSection(title: "Ваш заказ · \(cart.totalQuantity)") {
            ForEach(cart.items) { item in
                let unavailable = model.unavailableIds.contains(item.id)
                HStack(alignment: .top, spacing: 10) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(item.medicine.medicineName)
                            .font(.system(size: 14))
                            .foregroundColor(unavailable ? Theme.textSecondary : Theme.textPrimary)
                            .strikethrough(unavailable)
                            .lineLimit(2)
                        Text(unavailable ? "Нет в наличии" : "\(item.quantity) × \(PriceFormatter.string(item.medicine.sellingUnitPrice))")
                            .font(.system(size: 12, weight: unavailable ? .semibold : .regular))
                            .foregroundColor(unavailable ? Theme.danger : Theme.textSecondary)
                    }
                    Spacer(minLength: 8)
                    Text(PriceFormatter.string(item.lineTotal))
                        .font(.system(size: 14, weight: .semibold).monospacedDigit())
                        .foregroundColor(Theme.textPrimary)
                }
            }
            Divider()
            totalRow("Товары", cart.subtotal, bold: false)
            totalRow("Итого", cart.subtotal, bold: true)
            Text("Цены проверяются аптекой при оформлении")
                .font(.system(size: 12))
                .foregroundColor(Theme.textSecondary)
        }
    }

    private func totalRow(_ title: String, _ value: Decimal, bold: Bool) -> some View {
        HStack {
            Text(title)
            Spacer()
            Text(PriceFormatter.string(value)).monospacedDigit()
        }
        .font(.system(size: bold ? 18 : 15, weight: bold ? .bold : .regular))
        .foregroundColor(Theme.textPrimary)
    }

    @ViewBuilder
    private func errorBanner(_ error: OrderError) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Label(error.message, systemImage: "exclamationmark.triangle.fill")
                .font(.system(size: 14, weight: .semibold))
                .foregroundColor(Theme.danger)
            if model.isRefreshingCart {
                ProgressView("Проверяем наличие…").font(.system(size: 13))
            } else if !model.unavailableIds.isEmpty {
                Button("Убрать недоступные и обновить корзину") {
                    model.removeUnavailable(from: cart)
                }
                .font(.system(size: 14, weight: .semibold))
                .foregroundColor(Theme.brandPrimary)
                .frame(minHeight: 44)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Theme.danger.opacity(0.08)))
        .accessibilityElement(children: .contain)
    }

    // MARK: Bottom bar

    private var submitBar: some View {
        VStack(spacing: 6) {
            Button {
                focused = nil
                Task { await model.submit(cart: cart, verifiedPhone: auth.phone) }
            } label: {
                HStack(spacing: 10) {
                    if model.isSubmitting {
                        ProgressView().tint(.white)
                        Text("Оформляем…")
                    } else {
                        Text("Оформить заказ")
                        Text("· \(PriceFormatter.string(cart.subtotal))").monospacedDigit()
                    }
                }
                .font(.system(size: 17, weight: .semibold))
                .foregroundColor(.white)
                .frame(maxWidth: .infinity, minHeight: 54)
                .background {
                    if design.usesGlassBackdrop {
                        GlassCapsule(tint: canSubmit ? Theme.brandPrimary : Theme.textSecondary)
                    } else {
                        Capsule().fill(canSubmit ? Theme.brandPrimary : Theme.disabledFill)
                    }
                }
            }
            .disabled(!canSubmit)
            .accessibilityIdentifier("checkout.submit")
            Text("Мы позвоним вам для подтверждения заказа")
                .font(.system(size: 12))
                .foregroundColor(Theme.textSecondary)
        }
        .padding(.horizontal, 16)
        .padding(.top, 10)
        .padding(.bottom, 6)
        .background(.ultraThinMaterial)
    }

    private var canSubmit: Bool {
        !model.isSubmitting && !cart.items.isEmpty && cart.amountToMinimum == 0 && model.unavailableIds.isEmpty
    }
}

// MARK: - Success

/// «Заказ оформлен»: server reference and totals, no delivery amount.
struct OrderSuccessView: View {
    @Environment(\.popToRoot) private var popToRoot
    @Environment(\.selectTab) private var selectTab
    @Environment(\.openRoute) private var openRoute
    let order: PublicOrder
    let customerName: String
    let phone: String?

    @State private var deliveryPhone: String?

    var body: some View {
        ScrollView {
            VStack(spacing: 18) {
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 64))
                    .foregroundColor(Theme.success)
                    .padding(.top, 24)
                    .accessibilityHidden(true)
                Text("Заказ оформлен")
                    .font(.system(size: 26, weight: .bold))
                    .foregroundColor(Theme.textPrimary)

                VStack(spacing: 6) {
                    Text("Номер заказа")
                        .font(.system(size: 13))
                        .foregroundColor(Theme.textSecondary)
                    Text(order.orderReference)
                        .font(.system(size: 28, weight: .heavy).monospacedDigit())
                        .foregroundColor(Theme.textPrimary)
                        .textSelection(.enabled)
                    Label(order.statusTitle, systemImage: "clock")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundColor(Theme.warningText)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 6)
                        .background(Capsule().fill(Color(hex: 0xED6C02).opacity(0.12)))
                }

                Text(thanksText)
                    .font(.system(size: 15))
                    .foregroundColor(Theme.textSecondary)
                    .multilineTextAlignment(.center)

                CheckoutSection(title: "Состав заказа") {
                    ForEach(order.items) { item in
                        HStack(alignment: .top) {
                            Text("\(item.medicineName) × \(PriceFormatter.quantity(item.quantity))")
                                .font(.system(size: 14))
                                .foregroundColor(Theme.textPrimary)
                            Spacer(minLength: 8)
                            Text(PriceFormatter.string(item.lineTotal))
                                .font(.system(size: 14, weight: .semibold).monospacedDigit())
                        }
                    }
                    Divider()
                    HStack {
                        Text("Итого за лекарства")
                        Spacer()
                        Text(PriceFormatter.string(order.orderTotal)).monospacedDigit()
                    }
                    .font(.system(size: 18, weight: .bold))
                    Label("Стоимость доставки рассчитывается и оплачивается напрямую курьеру при доставке", systemImage: "shippingbox")
                        .font(.system(size: 13))
                        .foregroundColor(Theme.textSecondary)
                }

                if let deliveryPhone = deliveryPhone, let url = URL(string: "tel:\(deliveryPhone.filter { $0 == "+" || $0.isNumber })") {
                    Link(destination: url) {
                        Label("Вопросы по доставке: \(TajikPhone.display(deliveryPhone))", systemImage: "phone.fill")
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundColor(Theme.brandPrimary)
                            .frame(minHeight: 44)
                    }
                }

                VStack(spacing: 10) {
                    Button {
                        popToRoot()
                        // Open «Мои заказы» once the stack has popped back to the cart.
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.45) { openRoute(.orders) }
                    } label: {
                        Text("Отследить заказ")
                            .font(.system(size: 17, weight: .semibold))
                            .foregroundColor(.white)
                            .frame(maxWidth: .infinity, minHeight: 52)
                            .background(Capsule().fill(Theme.brandPrimary))
                    }
                    Button {
                        popToRoot()
                        selectTab(.home)
                    } label: {
                        Text("Вернуться на главную")
                            .font(.system(size: 17, weight: .semibold))
                            .foregroundColor(Theme.brandPrimary)
                            .frame(maxWidth: .infinity, minHeight: 52)
                            .background(Capsule().stroke(Theme.border, lineWidth: 1))
                    }
                }
                .padding(.top, 4)
            }
            .padding(16)
            .padding(.bottom, 24)
        }
        .task {
            deliveryPhone = try? await APIClient.shared.siteSettings().deliveryContactPhone
        }
    }

    private var thanksText: String {
        let greeting = customerName.isEmpty ? "Спасибо!" : "Спасибо, \(customerName)!"
        guard let phone = phone else { return greeting + " Мы позвоним вам для подтверждения заказа." }
        return "\(greeting) Сотрудник аптеки позвонит на \(TajikPhone.display(phone)), чтобы подтвердить заказ и уточнить доставку."
    }
}

// MARK: - Form building blocks

/// White card, or a glass card when a glass design is selected.
struct CheckoutSection<Content: View>: View {
    @EnvironmentObject private var design: DesignSettings
    let title: String
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title)
                .font(.system(size: 17, weight: .bold))
                .foregroundColor(Theme.textPrimary)
            content
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background {
            if design.usesGlassBackdrop {
                GlassCardBackground(cornerRadius: 22)
            } else {
                RoundedRectangle(cornerRadius: 18, style: .continuous).fill(Theme.surfaceCard)
            }
        }
    }
}

/// Visible label above the field, error below it (UI spec §5: labels never replaced by placeholders).
struct LabeledField<Field: View>: View {
    let title: String?
    let required: Bool
    let error: String?
    @ViewBuilder let field: Field

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let title = title {
                (Text(title) + Text(required ? " *" : "").foregroundColor(Theme.brandPrimary))
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(Theme.textSecondary)
            }
            field
                .font(.system(size: 16))
                .padding(.horizontal, 14)
                .padding(.vertical, 12)
                .frame(minHeight: 48)
                .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white.opacity(0.85)))
                .overlay(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .stroke(error == nil ? Theme.border : Theme.danger, lineWidth: error == nil ? 1 : 1.5)
                )
            if let error = error {
                Label(error, systemImage: "exclamationmark.circle.fill")
                    .font(.system(size: 13))
                    .foregroundColor(Theme.danger)
            }
        }
    }
}
