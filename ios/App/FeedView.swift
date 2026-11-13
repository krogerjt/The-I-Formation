import SwiftUI
import Observation

/// The Feed tab's data: the server's live feed, the slide on show, and the rotation between slides.
/// While the app is open it also rotates the Live Activity itself if the server can't push.
@MainActor
@Observable
final class FeedModel {
    static let rotation: Duration = .seconds(30)

    let api: HuddleAPI?
    let live: LiveActivityController
    private(set) var feed: FeedSnapshot?
    private(set) var slide: LiveSlide?
    private(set) var lastError: String?
    private var rotator = SlideRotator()
    private var refreshedAt: Date = .distantPast
    private var fetchedLogos = false

    init(api: HuddleAPI?, live: LiveActivityController) {
        self.api = api
        self.live = live
    }

    func refresh() async {
        guard let api else { return }
        do {
            let feed = try await api.feed()
            self.feed = feed
            live.apply(feed.liveActivity)
            refreshedAt = .now
            lastError = nil
            if slide == nil { await advance() }
        } catch is CancellationError {
        } catch let error as URLError where error.code == .cancelled {
        } catch {
            lastError = error.localizedDescription
        }
    }

    /// Shows the next slide, and sends it to the Live Activity when the app is the one rotating it.
    func advance() async {
        guard let feed, let next = rotator.next(feed) else { return }
        slide = next
        if live.appDrivesActivity { await live.update(next) }
    }

    /// Runs while the app is open: refreshes every 30 seconds during my games (every 5 minutes otherwise)
    /// and rotates the slide every 30 seconds.
    func run() async {
        if !fetchedLogos { fetchedLogos = true; Task.detached(priority: .utility) { await TeamLogos.downloadMissing() } }
        while !Task.isCancelled {
            let stale = Date.now.timeIntervalSince(refreshedAt) > (feed?.window == "off" ? 300 : 25)
            if stale { await refresh() } else { await advance() }
            try? await Task.sleep(for: Self.rotation)
        }
    }

    func startActivity() async {
        if feed == nil { await refresh() }
        guard let first = slide ?? feed?.scores.first else {
            live.report("There's nothing to show yet. Connect a league first.")
            return
        }
        await live.start(week: feed?.week ?? 0, slide: first)
    }
}

struct FeedView: View {
    @Environment(FeedModel.self) private var model
    @Environment(LiveActivityController.self) private var live

    var body: some View {
        NavigationStack {
            List {
                Section {
                    if let slide = model.slide {
                        SlideCard(slide: slide)
                            .onTapGesture { Task { await model.advance() } }
                            .listRowInsets(EdgeInsets())
                            .listRowBackground(Color.clear)
                    } else if model.feed == nil, model.lastError == nil {
                        ProgressView().frame(maxWidth: .infinity)
                    } else {
                        Text("Plays and scores show up here once your games start.").foregroundStyle(.secondary)
                    }
                } footer: {
                    if model.slide != nil { Text("Changes every 30 seconds. Tap for the next one.") }
                }

                LiveActivitySection()

                if let error = model.lastError {
                    Section { Label(error, systemImage: "exclamationmark.triangle.fill").font(.footnote).foregroundStyle(.orange) }
                }

                if let feed = model.feed {
                    Section("Scoring plays") {
                        if feed.events.isEmpty {
                            Text(feed.window == "off" ? "None of your starters are playing right now." : "No scoring plays from your starters yet.")
                                .foregroundStyle(.secondary)
                        }
                        ForEach(feed.events) { event in
                            VStack(alignment: .leading, spacing: 4) {
                                LiveSlideView(slide: event.slide())
                                if let date = event.date {
                                    Text(date, style: .time).font(.caption2).foregroundStyle(.tertiary)
                                }
                            }
                            .padding(.vertical, 4)
                        }
                    }
                    if !feed.scores.isEmpty {
                        Section("Scores") {
                            ForEach(Array(feed.scores.enumerated()), id: \.offset) { _, slide in
                                LiveSlideView(slide: slide).padding(.vertical, 4)
                            }
                        }
                    }
                }
            }
            .animation(.default, value: model.slide)
            .navigationTitle("Feed")
            .refreshable { await model.refresh() }
        }
    }
}

/// The slide the way the lock screen shows it.
private struct SlideCard: View {
    let slide: LiveSlide
    var body: some View {
        LiveSlideView(slide: slide)
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.black.opacity(0.85), in: RoundedRectangle(cornerRadius: 22, style: .continuous))
            .environment(\.colorScheme, .dark)
            .id(slide)
            .transition(.push(from: .trailing))
    }
}

private struct LiveActivitySection: View {
    @Environment(FeedModel.self) private var model
    @Environment(LiveActivityController.self) private var live

    var body: some View {
        Section {
            if live.isRunning {
                Button("End Live Activity", role: .destructive) { Task { await live.end() } }
            } else {
                Button("Show on Lock Screen") { Task { await model.startActivity() } }
            }
            if live.status?.push == true {
                Toggle("Start automatically when my games kick off", isOn: Binding(
                    get: { live.status?.auto ?? true },
                    set: { value in Task { await live.setAuto(value) } }))
            }
            if let error = live.lastError {
                Text(error).font(.footnote).foregroundStyle(.orange)
            }
        } header: {
            Text("Live Activity")
        } footer: {
            Text(footer)
        }
    }

    private var footer: String {
        guard let status = live.status else { return "" }
        if !status.push { return "The server can't send push updates yet, so the Live Activity only changes while I Formation is open." }
        if status.auto && !status.canAutoStart { return "It will start on its own once iOS gives I Formation permission. Start it here in the meantime." }
        return "Keeps rotating with your phone locked, and pops up when one of your starters scores a touchdown."
    }
}
