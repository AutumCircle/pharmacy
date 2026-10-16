import SwiftUI

/// Pharmacy contacts and ordering terms. Static values mirror the website footer
/// (src/config/site-footer.ts); the delivery phone is loaded live from `/api/site-settings`.
enum PharmacyInfo {
    static let name = "Аптека «Ватан»"
    static let description = "Лекарства и товары для здоровья в одном месте."
    static let address = "Душанбе, ул. Айни 29"
    static let phones = ["+992446250077", "+992710500500", "+992715500500"]
    static let workingDays = "Ежедневно"
    static let workingHours = "07:00–01:00"
    static let instagram = URL(string: "https://www.instagram.com/aptekavatan/")!
    static let website = URL(string: "https://www.aptekavatan.tj")!

    static var mapsURL: URL? {
        var components = URLComponents(string: "http://maps.apple.com/")
        components?.queryItems = [URLQueryItem(name: "q", value: "Аптека Ватан, \(address)")]
        return components?.url
    }

    static func telURL(_ phone: String) -> URL? {
        URL(string: "tel:\(phone.filter { $0 == "+" || $0.isNumber })")
    }
}

/// «О аптеке»: contacts, hours, how to order and ordering terms.
struct AboutView: View {
    @State private var deliveryPhone: String?

    var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                VStack(spacing: 10) {
                    Image("VatanLogoName")
                        .resizable()
                        .interpolation(.high)
                        .scaledToFit()
                        .frame(height: 56)
                        .accessibilityLabel(PharmacyInfo.name)
                    Text(PharmacyInfo.description)
                        .font(.system(size: 15))
                        .foregroundColor(Theme.textSecondary)
                        .multilineTextAlignment(.center)
                }
                .padding(.vertical, 12)

                CheckoutSection(title: "Контакты") {
                    if let maps = PharmacyInfo.mapsURL {
                        contactRow(icon: "mappin.and.ellipse", title: PharmacyInfo.address, subtitle: "Открыть на карте", url: maps)
                    }
                    contactRow(
                        icon: "clock.fill",
                        title: "\(PharmacyInfo.workingDays), \(PharmacyInfo.workingHours)",
                        subtitle: "Часы работы",
                        url: nil
                    )
                    ForEach(PharmacyInfo.phones, id: \.self) { phone in
                        contactRow(icon: "phone.fill", title: TajikPhone.display(phone), subtitle: "Позвонить в аптеку", url: PharmacyInfo.telURL(phone))
                    }
                    if let deliveryPhone = deliveryPhone {
                        contactRow(icon: "shippingbox.fill", title: TajikPhone.display(deliveryPhone), subtitle: "Вопросы по доставке", url: PharmacyInfo.telURL(deliveryPhone))
                    }
                    contactRow(icon: "camera.fill", title: "@aptekavatan", subtitle: "Instagram", url: PharmacyInfo.instagram)
                    contactRow(icon: "globe", title: "aptekavatan.tj", subtitle: "Сайт аптеки", url: PharmacyInfo.website)
                }

                CheckoutSection(title: "Как заказать") {
                    step(1, "Найдите лекарство через поиск или в каталоге.")
                    step(2, "Откройте товар: там указаны цена, производитель и наличие.")
                    step(3, "Нажмите «В корзину», затем оформите заказ: имя, телефон и адрес доставки.")
                    step(4, "Аптека позвонит, подтвердит заказ и доставит его. Статус — в «Мои заказы».")
                }

                CheckoutSection(title: "Условия заказа") {
                    term("banknote", "Оплата лекарств при получении. Онлайн-оплаты нет.")
                    term("shippingbox", "Стоимость доставки рассчитывается и оплачивается напрямую курьеру при доставке.")
                    term("cart", "Минимальная сумма заказа — 50 с.")
                    term("phone.arrow.down.left", "Мы позвоним для подтверждения заказа.")
                    term("checkmark.seal", "Цены и наличие проверяются аптекой при оформлении.")
                }

                Text("Версия приложения \(Self.appVersion)")
                    .font(.system(size: 12))
                    .foregroundColor(Theme.textSecondary)
                    .padding(.top, 4)
            }
            .padding(16)
            .padding(.bottom, 24)
        }
        .background(AppBackground())
        .navigationTitle("О аптеке")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            deliveryPhone = try? await APIClient.shared.siteSettings().deliveryContactPhone
        }
    }

    private static var appVersion: String {
        let info = Bundle.main.infoDictionary
        let version = info?["CFBundleShortVersionString"] as? String ?? "1.0"
        let build = info?["CFBundleVersion"] as? String ?? "1"
        return "\(version) (\(build))"
    }

    @ViewBuilder
    private func contactRow(icon: String, title: String, subtitle: String, url: URL?) -> some View {
        let row = HStack(spacing: 12) {
            Image(systemName: icon)
                .font(.system(size: 15, weight: .semibold))
                .foregroundColor(.white)
                .frame(width: 34, height: 34)
                .background(RoundedRectangle(cornerRadius: 9, style: .continuous).fill(Theme.brandPrimary))
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.system(size: 16).monospacedDigit())
                    .foregroundColor(Theme.textPrimary)
                Text(subtitle)
                    .font(.system(size: 12))
                    .foregroundColor(Theme.textSecondary)
            }
            Spacer(minLength: 0)
            if url != nil {
                Image(systemName: "chevron.right")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(Theme.disabledFill)
            }
        }
        .frame(minHeight: 44)
        .contentShape(Rectangle())

        if let url = url {
            Link(destination: url) { row }
        } else {
            row.accessibilityElement(children: .combine)
        }
    }

    private func step(_ number: Int, _ text: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Text("\(number)")
                .font(.system(size: 14, weight: .bold))
                .foregroundColor(.white)
                .frame(width: 26, height: 26)
                .background(Circle().fill(Theme.brandPrimary))
            Text(text)
                .font(.system(size: 15))
                .foregroundColor(Theme.textPrimary)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
    }

    private func term(_ icon: String, _ text: String) -> some View {
        Label {
            Text(text)
                .font(.system(size: 15))
                .foregroundColor(Theme.textPrimary)
                .fixedSize(horizontal: false, vertical: true)
        } icon: {
            Image(systemName: icon).foregroundColor(Theme.brandPrimary)
        }
    }
}
