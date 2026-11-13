import SwiftUI

@main
struct HuddleApp: App {
    @State private var store: HuddleStore
    @State private var live: LiveActivityController
    @State private var feed: FeedModel

    init() {
        let store = HuddleStore()
        let live = LiveActivityController(api: store.api)
        // Observe right away: iOS launches the app in the background to hand over a new Live Activity's push token.
        live.observe()
        _store = State(initialValue: store)
        _live = State(initialValue: live)
        _feed = State(initialValue: FeedModel(api: store.api, live: live))
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(store)
                .environment(live)
                .environment(feed)
                .tint(Color.accentColor)
        }
    }
}

struct RootView: View {
    @Environment(HuddleStore.self) private var store
    @Environment(FeedModel.self) private var feed
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        TabView {
            ScoreboardView()
                .tabItem { Label("Scores", systemImage: "sportscourt") }
            FeedView()
                .tabItem { Label("Feed", systemImage: "dot.radiowaves.left.and.right") }
            RootingView()
                .tabItem { Label("Root For", systemImage: "hand.thumbsup") }
            SettingsView()
                .tabItem { Label("Accounts", systemImage: "person.crop.circle") }
        }
        .task { await store.refreshAccounts() }
        // The feed rotates whichever tab is showing, so the Live Activity keeps changing while the app is open.
        .task(id: scenePhase == .active) {
            guard scenePhase == .active else { return }
            await feed.run()
        }
    }
}

/// The week picker shared by the Scores and Root For screens.
struct WeekMenu: View {
    @Environment(HuddleStore.self) private var store

    var body: some View {
        @Bindable var store = store
        Menu {
            Picker("Week", selection: $store.selectedWeek) {
                Text("This week").tag(Int?.none)
                ForEach(1...18, id: \.self) { week in
                    Text("Week \(week)").tag(Int?.some(week))
                }
            }
        } label: {
            Label(title, systemImage: "calendar")
        }
    }

    private var title: String {
        if let week = store.selectedWeek { return "Week \(week)" }
        if let week = store.currentWeek { return "Week \(week)" }
        return "This week"
    }
}

/// A banner for platforms that failed this refresh, so one broken login doesn't look like no games.
struct IssueBanner: View {
    let issues: [ProviderIssue]
    let error: String?

    var body: some View {
        if let error {
            Label(error, systemImage: "exclamationmark.triangle.fill")
                .font(.footnote)
                .foregroundStyle(.orange)
        }
        ForEach(issues, id: \.self) { issue in
            Label("\(issue.platform.label): \(issue.message)", systemImage: "exclamationmark.triangle")
                .font(.footnote)
                .foregroundStyle(.orange)
        }
    }
}

/// Reloads every 60 seconds while games are live (and once a few minutes otherwise) while the screen is visible.
struct AutoRefresh: ViewModifier {
    let isLive: @MainActor () -> Bool
    let key: AnyHashable
    let action: @MainActor () async -> Void
    @Environment(\.scenePhase) private var scenePhase

    func body(content: Content) -> some View {
        content.task(id: TaskKey(key: key, active: scenePhase == .active)) {
            guard scenePhase == .active else { return }
            while !Task.isCancelled {
                await action()
                try? await Task.sleep(for: .seconds(isLive() ? 60 : 300))
            }
        }
    }

    private struct TaskKey: Hashable { let key: AnyHashable; let active: Bool }
}

extension View {
    func autoRefresh(key: AnyHashable, isLive: @escaping @MainActor () -> Bool, action: @escaping @MainActor () async -> Void) -> some View {
        modifier(AutoRefresh(isLive: isLive, key: key, action: action))
    }
}

extension Platform {
    var color: Color {
        switch self {
        case .sleeper: .indigo
        case .espn: .red
        case .yahoo: .purple
        }
    }
}

struct PlatformBadge: View {
    let platform: Platform
    var body: some View {
        Text(platform.label)
            .font(.caption2.weight(.semibold))
            .padding(.horizontal, 6).padding(.vertical, 2)
            .background(platform.color.opacity(0.15), in: Capsule())
            .foregroundStyle(platform.color)
    }
}
