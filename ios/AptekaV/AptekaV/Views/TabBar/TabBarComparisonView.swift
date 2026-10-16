import SwiftUI

#if DEBUG
/// All bars stacked on one canvas for side-by-side comparison in Xcode previews.
struct TabBarComparisonView: View {
    @State private var selections: [TabBarStyle: AppTab] = [:]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 28) {
                ForEach(TabBarStyle.allCases) { style in
                    VStack(alignment: .leading, spacing: 10) {
                        Text("\(style.rawValue). \(style.title)")
                            .font(.system(size: 15, weight: .bold))
                            .foregroundColor(Theme.textPrimary)
                            .padding(.horizontal, 16)
                        AppTabBar(
                            style: style,
                            selection: Binding(
                                get: { selections[style] ?? .home },
                                set: { selections[style] = $0 }
                            ),
                            cartCount: 3
                        )
                        .padding(.top, style == .centerCart || style == .bubble ? 26 : 0)
                    }
                }
            }
            .padding(.vertical, 20)
        }
        .background(GlassBackdrop())
    }
}

struct TabBarComparisonView_Previews: PreviewProvider {
    static var previews: some View {
        TabBarComparisonView()
    }
}
#endif
