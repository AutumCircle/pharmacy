import SwiftUI

// Search bar options for review. Every style edits the same text binding, so the chosen one
// can replace the others without touching the search logic in `SearchViewModel`.

/// Search bar design options under review. Once the owner picks one, the others can be removed.
enum SearchBarStyle: Int, CaseIterable, Identifiable {
    case system = 1
    case filled
    case brandHeader
    case floating
    case outlined
    case liquidGlass
    case underline

    var id: Int { rawValue }

    var title: String {
        switch self {
        case .system: return "Системный"
        case .filled: return "Серое поле"
        case .brandHeader: return "Красная шапка"
        case .floating: return "Парящая капсула"
        case .outlined: return "Контур"
        case .liquidGlass: return "Liquid Glass"
        case .underline: return "Подчёркивание"
        }
    }

    var summary: String {
        switch self {
        case .system:
            return "Стандартное поле поиска iOS под заголовком навигации"
        case .filled:
            return "Серое скруглённое поле на всю ширину, кнопка «Отмена» при вводе"
        case .brandHeader:
            return "Красная шапка с белым полем поиска, как на сайте аптеки"
        case .floating:
            return "Белая капсула с мягкой тенью, красная иконка лупы"
        case .outlined:
            return "Белое поле с рамкой, рамка становится красной при вводе"
        case .liquidGlass:
            return "Стеклянная капсула и отдельная круглая кнопка закрытия, как в iOS 26 (имитация для iOS 16)"
        case .underline:
            return "Без фона: крупный текст и линия, которая краснеет при вводе"
        }
    }

    /// Glass styles need a colourful backdrop to read as glass.
    var isGlass: Bool { self == .liquidGlass }

    /// Toolbar items sit on a red navigation bar and must be drawn in white.
    var hasBrandNavigationBar: Bool { self == .brandHeader }
}

extension View {
    /// Attaches the search field in the given style. `.system` uses the native `.searchable`;
    /// the custom styles are pinned under the navigation bar while results scroll beneath.
    func appSearchBar(style: SearchBarStyle, text: Binding<String>, prompt: String) -> some View {
        modifier(AppSearchBarModifier(style: style, text: text, prompt: prompt))
    }
}

private struct AppSearchBarModifier: ViewModifier {
    let style: SearchBarStyle
    @Binding var text: String
    let prompt: String

    @ViewBuilder
    func body(content: Content) -> some View {
        switch style {
        case .system:
            content.searchable(
                text: $text,
                placement: .navigationBarDrawer(displayMode: .always),
                prompt: Text(prompt)
            )
        case .brandHeader:
            pinned(content)
                .toolbarBackground(Theme.brandPrimary, for: .navigationBar)
                .toolbarBackground(.visible, for: .navigationBar)
                .toolbarColorScheme(.dark, for: .navigationBar)
        default:
            pinned(content)
        }
    }

    private func pinned(_ content: Content) -> some View {
        content.safeAreaInset(edge: .top, spacing: 0) {
            AppSearchBar(style: style, text: $text, prompt: prompt)
        }
    }
}

/// A custom search bar in one of the non-system styles.
struct AppSearchBar: View {
    let style: SearchBarStyle
    @Binding var text: String
    let prompt: String

    var body: some View {
        switch style {
        case .system, .filled:
            FilledSearchBar(text: $text, prompt: prompt)
        case .brandHeader:
            BrandHeaderSearchBar(text: $text, prompt: prompt)
        case .floating:
            FloatingSearchBar(text: $text, prompt: prompt)
        case .outlined:
            OutlinedSearchBar(text: $text, prompt: prompt)
        case .liquidGlass:
            LiquidGlassSearchBar(text: $text, prompt: prompt)
        case .underline:
            UnderlineSearchBar(text: $text, prompt: prompt)
        }
    }
}

// MARK: - Shared parts

/// Magnifier, text field and clear button. Each style wraps it in its own surface.
private struct SearchTextField: View {
    @Binding var text: String
    let prompt: String
    var isFocused: FocusState<Bool>.Binding
    var iconColor: Color = Theme.textSecondary
    var font: Font = .body

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass")
                .font(font.weight(.medium))
                .foregroundColor(iconColor)
                .accessibilityHidden(true)
            TextField("", text: $text, prompt: Text(prompt).foregroundColor(Theme.textSecondary))
                .font(font)
                .foregroundColor(Theme.textPrimary)
                .focused(isFocused)
                .submitLabel(.search)
                .accessibilityLabel(prompt)
            if !text.isEmpty {
                Button {
                    text = ""
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundColor(Theme.textSecondary.opacity(0.7))
                        .frame(minWidth: 32, minHeight: 44)
                        .contentShape(Rectangle())
                }
                .accessibilityLabel("Очистить поиск")
            }
        }
        .frame(minHeight: 44)
    }
}

/// «Отмена» next to the field while it is focused: clears the query and hides the keyboard.
private struct CancelSearchButton: View {
    var color: Color = Theme.brandPrimary
    let action: () -> Void

    var body: some View {
        Button("Отмена", action: action)
            .font(.body)
            .foregroundColor(color)
            .frame(minHeight: 44)
            .transition(.move(edge: .trailing).combined(with: .opacity))
    }
}

private extension View {
    /// Animates the cancel button sliding in and out as focus changes.
    func focusAnimation(_ isFocused: Bool) -> some View {
        animation(.easeInOut(duration: 0.2), value: isFocused)
    }
}

// MARK: - 2. Filled

struct FilledSearchBar: View {
    @Binding var text: String
    let prompt: String
    @FocusState private var isFocused: Bool

    var body: some View {
        HStack(spacing: 10) {
            SearchTextField(text: $text, prompt: prompt, isFocused: $isFocused)
                .padding(.leading, 10)
                .padding(.trailing, text.isEmpty ? 10 : 2)
                .background(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .fill(Color(hex: 0x767680, opacity: 0.12))
                )
            if isFocused {
                CancelSearchButton {
                    text = ""
                    isFocused = false
                }
            }
        }
        .focusAnimation(isFocused)
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        .background(Theme.surfacePage)
    }
}

// MARK: - 3. Brand header

struct BrandHeaderSearchBar: View {
    @Binding var text: String
    let prompt: String
    @FocusState private var isFocused: Bool

    var body: some View {
        HStack(spacing: 10) {
            SearchTextField(text: $text, prompt: prompt, isFocused: $isFocused, iconColor: Theme.brandPrimary)
                .padding(.leading, 12)
                .padding(.trailing, text.isEmpty ? 12 : 4)
                .background(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .fill(Theme.surfaceCard)
                )
            if isFocused {
                CancelSearchButton(color: .white) {
                    text = ""
                    isFocused = false
                }
            }
        }
        .focusAnimation(isFocused)
        .padding(.horizontal, 16)
        .padding(.top, 4)
        .padding(.bottom, 14)
        .background(Theme.brandPrimary)
    }
}

// MARK: - 4. Floating capsule

struct FloatingSearchBar: View {
    @Binding var text: String
    let prompt: String
    @FocusState private var isFocused: Bool

    var body: some View {
        HStack(spacing: 10) {
            SearchTextField(text: $text, prompt: prompt, isFocused: $isFocused, iconColor: Theme.brandPrimary)
                .padding(.leading, 18)
                .padding(.trailing, text.isEmpty ? 18 : 8)
                .padding(.vertical, 4)
                .background(
                    Capsule()
                        .fill(Theme.surfaceCard)
                        .shadow(color: .black.opacity(isFocused ? 0.14 : 0.08), radius: 14, x: 0, y: 4)
                )
            if isFocused {
                CancelSearchButton {
                    text = ""
                    isFocused = false
                }
            }
        }
        .focusAnimation(isFocused)
        .padding(.horizontal, 16)
        .padding(.top, 8)
        .padding(.bottom, 14)
        // Results fade out under the capsule instead of ending at a hard edge.
        .background(
            LinearGradient(
                colors: [Theme.surfacePage, Theme.surfacePage, Theme.surfacePage.opacity(0)],
                startPoint: .top,
                endPoint: .bottom
            )
        )
    }
}

// MARK: - 5. Outlined

struct OutlinedSearchBar: View {
    @Binding var text: String
    let prompt: String
    @FocusState private var isFocused: Bool

    var body: some View {
        HStack(spacing: 10) {
            SearchTextField(
                text: $text,
                prompt: prompt,
                isFocused: $isFocused,
                iconColor: isFocused ? Theme.brandPrimary : Theme.textSecondary
            )
            .padding(.leading, 12)
            .padding(.trailing, text.isEmpty ? 12 : 4)
            .background(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(Theme.surfaceCard)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .strokeBorder(isFocused ? Theme.brandPrimary : Theme.border, lineWidth: isFocused ? 2 : 1)
            )
            if isFocused {
                CancelSearchButton {
                    text = ""
                    isFocused = false
                }
            }
        }
        .focusAnimation(isFocused)
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        .background(Theme.surfacePage)
    }
}

// MARK: - 6. Liquid Glass
// iOS 26 Liquid Glass is not available on iOS 16; like the tab bar, the glass is built from
// `.ultraThinMaterial`, a specular highlight and a light rim.

struct LiquidGlassSearchBar: View {
    @Binding var text: String
    let prompt: String
    @FocusState private var isFocused: Bool

    var body: some View {
        HStack(spacing: 10) {
            SearchTextField(text: $text, prompt: prompt, isFocused: $isFocused, iconColor: Theme.textPrimary)
                .padding(.leading, 18)
                .padding(.trailing, text.isEmpty ? 18 : 8)
                .padding(.vertical, 4)
                .background(glass(Capsule()))
            if isFocused {
                Button {
                    text = ""
                    isFocused = false
                } label: {
                    Image(systemName: "xmark")
                        .font(.body.weight(.semibold))
                        .foregroundColor(Theme.textPrimary)
                        .frame(width: 52, height: 52)
                        .background(glass(Circle()))
                }
                .accessibilityLabel("Закрыть поиск")
                .transition(.scale.combined(with: .opacity))
            }
        }
        .focusAnimation(isFocused)
        .padding(.horizontal, 16)
        .padding(.top, 8)
        .padding(.bottom, 10)
    }

    private func glass<S: Shape>(_ shape: S) -> some View {
        shape
            .fill(.ultraThinMaterial)
            .overlay(
                shape.fill(
                    LinearGradient(
                        colors: [.white.opacity(0.45), .white.opacity(0.05)],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                )
            )
            .overlay(shape.stroke(Color.white.opacity(0.7), lineWidth: 1))
            .shadow(color: .black.opacity(0.12), radius: 16, x: 0, y: 6)
    }
}

// MARK: - 7. Underline

struct UnderlineSearchBar: View {
    @Binding var text: String
    let prompt: String
    @FocusState private var isFocused: Bool

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                SearchTextField(
                    text: $text,
                    prompt: prompt,
                    isFocused: $isFocused,
                    iconColor: isFocused ? Theme.brandPrimary : Theme.textSecondary,
                    font: .title3
                )
                if isFocused {
                    CancelSearchButton {
                        text = ""
                        isFocused = false
                    }
                }
            }
            Rectangle()
                .fill(isFocused ? Theme.brandPrimary : Theme.border)
                .frame(height: isFocused ? 2 : 1)
        }
        .focusAnimation(isFocused)
        .padding(.horizontal, 20)
        .padding(.vertical, 6)
        .background(Theme.surfacePage)
    }
}

#if DEBUG
/// All custom bars stacked on one canvas for side-by-side comparison.
/// The system style only exists inside a navigation bar, so it is shown on the home screen.
struct SearchBarComparisonView: View {
    @State private var texts: [SearchBarStyle: String] = [.outlined: "нурофен"]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                ForEach(SearchBarStyle.allCases.filter { $0 != .system }) { style in
                    VStack(alignment: .leading, spacing: 8) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("\(style.rawValue). \(style.title)")
                                .font(.system(size: 15, weight: .bold))
                                .foregroundColor(Theme.textPrimary)
                            Text(style.summary)
                                .font(.system(size: 13))
                                .foregroundColor(Theme.textSecondary)
                        }
                        .padding(.horizontal, 16)
                        AppSearchBar(
                            style: style,
                            text: Binding(
                                get: { texts[style] ?? "" },
                                set: { texts[style] = $0 }
                            ),
                            prompt: "Поиск лекарств"
                        )
                        .background(style.isGlass ? AnyView(GlassBackdrop()) : AnyView(Color.clear))
                    }
                }
            }
            .padding(.vertical, 20)
        }
        .background(Theme.surfacePage.ignoresSafeArea())
    }
}

struct SearchBarStyles_Previews: PreviewProvider {
    static var previews: some View {
        SearchBarComparisonView()
    }
}
#endif
