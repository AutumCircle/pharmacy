import SwiftUI

/// «Мои заказы» (UI_DESIGN_SPEC §8.7): orders of the SMS-verified phone number, newest first.
struct OrdersView: View {
    @EnvironmentObject private var auth: AuthStore
    @Environment(\.openRoute) private var openRoute
    @StateObject private var model = OrdersViewModel()
    @State private var showLogin = false

    var body: some View {
        ScrollView {
            VStack(spacing: 12) {
                #if DEBUG
                if !OrderServiceFactory.sendsRealOrders {
                    Label("Тестовый режим: показаны только тестовые заказы с этого устройства", systemImage: "testtube.2")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundColor(Theme.warningText)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                #endif
                content
            }
            .padding(16)
        }
        .background(AppBackground())
        .navigationTitle("Мои заказы")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                if auth.isSignedIn {
                    Button {
                        Task { await model.load(phone: auth.phone) }
                    } label: {
                        Image(systemName: "arrow.clockwise")
                            .frame(minWidth: 44, minHeight: 44)
                    }
                    .disabled(model.state == .loading)
                    .accessibilityLabel("Обновить статус")
                }
            }
        }
        .refreshable { await model.load(phone: auth.phone) }
        .task(id: auth.phone) {
            await model.load(phone: auth.phone)
            #if DEBUG
            // Launch argument `-openFirstOrder YES` opens the newest order (simulator screenshots).
            if UserDefaults.standard.bool(forKey: "openFirstOrder"), let first = model.orders.first {
                openRoute(.order(first))
            }
            #endif
        }
        .loginSheet(isPresented: $showLogin)
    }

    @ViewBuilder
    private var content: some View {
        if !auth.isSignedIn {
            StateMessageView(
                icon: "person.crop.circle.badge.questionmark",
                title: "Войдите по номеру телефона",
                text: "Заказы показываются для номера, подтверждённого по SMS",
                actionTitle: "Войти"
            ) { showLogin = true }
        } else {
            switch model.state {
            case .loading where model.orders.isEmpty:
                ForEach(0..<3, id: \.self) { _ in OrderRowSkeleton() }
            case .failed(let message) where model.orders.isEmpty:
                ErrorStateView(kind: .failed(message: message), retry: { Task { await model.load(phone: auth.phone) } })
            default:
                if model.orders.isEmpty {
                    StateMessageView(icon: "shippingbox", title: "Заказы для этого номера не найдены")
                } else {
                    if case .failed(let message) = model.state {
                        Label(message, systemImage: "exclamationmark.triangle")
                            .font(.system(size: 13))
                            .foregroundColor(Theme.danger)
                    }
                    ForEach(model.orders) { order in
                        Button {
                            openRoute(.order(order))
                        } label: {
                            OrderRow(order: order)
                        }
                        .buttonStyle(PressDimButtonStyle())
                    }
                }
            }
        }
    }
}

@MainActor
final class OrdersViewModel: ObservableObject {
    @Published private(set) var orders: [PublicOrder] = []
    @Published private(set) var state: LoadState = .loading

    private let service: OrderTrackingService

    init(service: OrderTrackingService = OrderServiceFactory.makeTracking()) {
        self.service = service
    }

    func load(phone: String?) async {
        guard let phone = phone else {
            orders = []
            return
        }
        state = .loading
        do {
            let loaded = try await service.orders(forPhone: phone)
            orders = loaded.sorted { ($0.createdDate ?? .distantPast) > ($1.createdDate ?? .distantPast) }
            state = .loaded
        } catch is CancellationError {
            return
        } catch let error as APIError {
            if case .rateLimited(nil) = error {
                state = .failed("Слишком много запросов. Попробуйте позже")
            } else {
                // Includes the server's own rate-limit / block message.
                state = .failed(error.message)
            }
        } catch {
            state = .failed(APIError.server(code: nil).message)
        }
    }
}

// MARK: - Row

private struct OrderRow: View {
    let order: PublicOrder

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                Text("Заказ №\(order.orderReference)")
                    .font(.system(size: 17, weight: .bold).monospacedDigit())
                    .foregroundColor(Theme.textPrimary)
                Spacer()
                OrderStatusBadge(status: order.status)
            }
            Text(OrderDates.display(order.createdAt))
                .font(.system(size: 13))
                .foregroundColor(Theme.textSecondary)
            HStack {
                Text(itemsSummary)
                    .font(.system(size: 14))
                    .foregroundColor(Theme.textSecondary)
                    .lineLimit(1)
                Spacer(minLength: 8)
                Text(PriceFormatter.string(order.orderTotal))
                    .font(.system(size: 17, weight: .bold).monospacedDigit())
                    .foregroundColor(Theme.textPrimary)
                Image(systemName: "chevron.right")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(Theme.disabledFill)
            }
        }
        .padding(16)
        .background(OrderCardBackground())
        .accessibilityElement(children: .combine)
    }

    private var itemsSummary: String {
        let names = order.items.map(\.medicineName)
        guard let first = names.first else { return "" }
        return names.count == 1 ? first : "\(first) и ещё \(names.count - 1)"
    }
}

private struct OrderRowSkeleton: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            RoundedRectangle(cornerRadius: 6).fill(Theme.surfaceMuted).frame(width: 160, height: 18)
            RoundedRectangle(cornerRadius: 6).fill(Theme.surfaceMuted).frame(width: 120, height: 12)
            RoundedRectangle(cornerRadius: 6).fill(Theme.surfaceMuted).frame(height: 14)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(OrderCardBackground())
        .redacted(reason: .placeholder)
        .accessibilityHidden(true)
    }
}

/// White card, or glass when a glass design is selected.
struct OrderCardBackground: View {
    @EnvironmentObject private var design: DesignSettings

    var body: some View {
        if design.usesGlassBackdrop {
            GlassCardBackground(cornerRadius: 22)
        } else {
            RoundedRectangle(cornerRadius: 18, style: .continuous).fill(Theme.surfaceCard)
        }
    }
}

// MARK: - Status

/// Status with icon and text, never colour alone (UI spec §5, §7.4).
struct OrderStatusBadge: View {
    let status: String

    var body: some View {
        Label(OrderStatusStyle.title(status), systemImage: OrderStatusStyle.icon(status))
            .font(.system(size: 12, weight: .semibold))
            .foregroundColor(OrderStatusStyle.color(status))
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .background(Capsule().fill(OrderStatusStyle.color(status).opacity(0.12)))
    }
}

enum OrderStatusStyle {
    static let steps = ["pending", "confirmed", "delivering", "delivered"]

    static func title(_ status: String) -> String {
        switch status {
        case "pending": return "В обработке"
        case "confirmed": return "Подтверждён"
        case "delivering": return "В пути"
        case "delivered": return "Доставлен"
        case "cancelled": return "Отменён"
        default: return status
        }
    }

    static func icon(_ status: String) -> String {
        switch status {
        case "pending": return "clock"
        case "confirmed": return "checkmark.circle"
        case "delivering": return "car"
        case "delivered": return "shippingbox"
        case "cancelled": return "xmark.circle"
        default: return "questionmark.circle"
        }
    }

    static func color(_ status: String) -> Color {
        switch status {
        case "pending": return Theme.warningText
        case "confirmed": return Color(hex: 0x1565C0)
        case "delivering": return Theme.brandPrimary
        case "delivered": return Theme.success
        case "cancelled": return Theme.danger
        default: return Theme.textSecondary
        }
    }
}

// MARK: - Detail

struct OrderDetailView: View {
    @EnvironmentObject private var design: DesignSettings
    let order: PublicOrder

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Заказ №\(order.orderReference)")
                        .font(.system(size: 24, weight: .bold).monospacedDigit())
                        .foregroundColor(Theme.textPrimary)
                        .textSelection(.enabled)
                    Text("Оформлен: \(OrderDates.display(order.createdAt))")
                        .font(.system(size: 14))
                        .foregroundColor(Theme.textSecondary)
                }

                if order.status == "cancelled" {
                    Label("Заказ отменён", systemImage: "xmark.octagon.fill")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundColor(Theme.danger)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(16)
                        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Theme.danger.opacity(0.08)))
                } else {
                    OrderProgressView(status: order.status)
                        .padding(16)
                        .background(OrderCardBackground())
                }

                CheckoutSection(title: "Состав заказа") {
                    ForEach(order.items) { item in
                        HStack(alignment: .top, spacing: 10) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(item.medicineName)
                                    .font(.system(size: 14))
                                    .foregroundColor(Theme.textPrimary)
                                Text("\(PriceFormatter.quantity(item.quantity)) × \(PriceFormatter.string(item.sellingUnitPrice))")
                                    .font(.system(size: 12))
                                    .foregroundColor(Theme.textSecondary)
                            }
                            Spacer(minLength: 8)
                            Text(PriceFormatter.string(item.lineTotal))
                                .font(.system(size: 14, weight: .semibold).monospacedDigit())
                                .foregroundColor(Theme.textPrimary)
                        }
                    }
                    Divider()
                    HStack {
                        Text("Итого за лекарства")
                        Spacer()
                        Text(PriceFormatter.string(order.orderTotal)).monospacedDigit()
                    }
                    .font(.system(size: 18, weight: .bold))
                    .foregroundColor(Theme.textPrimary)
                    Label("Оплата лекарств при получении", systemImage: "banknote")
                        .font(.system(size: 13))
                        .foregroundColor(Theme.textSecondary)
                    Label("Стоимость доставки рассчитывается и оплачивается напрямую курьеру при доставке", systemImage: "shippingbox")
                        .font(.system(size: 13))
                        .foregroundColor(Theme.textSecondary)
                }
            }
            .padding(16)
            .padding(.bottom, 24)
        }
        .background(AppBackground())
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
    }
}

/// «В обработке → Подтверждён → В пути → Доставлен».
struct OrderProgressView: View {
    let status: String

    private var currentIndex: Int {
        OrderStatusStyle.steps.firstIndex(of: status) ?? 0
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(OrderStatusStyle.steps.enumerated()), id: \.offset) { index, step in
                let done = index <= currentIndex
                HStack(alignment: .top, spacing: 12) {
                    VStack(spacing: 0) {
                        Image(systemName: done ? "checkmark.circle.fill" : "circle")
                            .font(.system(size: 22))
                            .foregroundColor(done ? OrderStatusStyle.color(status) : Theme.disabledFill)
                        if index < OrderStatusStyle.steps.count - 1 {
                            Rectangle()
                                .fill(index < currentIndex ? OrderStatusStyle.color(status) : Theme.border)
                                .frame(width: 2, height: 26)
                        }
                    }
                    Text(OrderStatusStyle.title(step))
                        .font(.system(size: 15, weight: index == currentIndex ? .bold : .regular))
                        .foregroundColor(done ? Theme.textPrimary : Theme.textSecondary)
                        .padding(.top, 2)
                    Spacer()
                }
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Статус заказа: \(OrderStatusStyle.title(status))")
    }
}
