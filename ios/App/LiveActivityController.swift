import ActivityKit
import Foundation
import Observation

/// Starts and ends the Live Activity, and hands iOS's push tokens to the server so it can update the
/// activity with the phone locked, and start one by itself when games kick off.
@MainActor
@Observable
final class LiveActivityController {
    private let api: HuddleAPI?
    private var observing = false
    private var watched = Set<String>()

    private(set) var status: LiveActivityStatus?
    private(set) var lastError: String?

    init(api: HuddleAPI?) { self.api = api }

    private(set) var isRunning = false
    var isEnabled: Bool { ActivityAuthorizationInfo().areActivitiesEnabled }
    /// Whether the open app should rotate the activity itself, because the server can't push.
    var appDrivesActivity: Bool { status?.push == false && isRunning }

    /// Call once at launch. iOS also launches the app in the background to hand over a new activity's token.
    func observe() {
        syncRunning()
        guard !observing, api != nil else { return }
        observing = true
        if #available(iOS 17.2, *) {
            Task {
                for await data in Activity<ScoresActivityAttributes>.pushToStartTokenUpdates {
                    await save(.init(pushToStart: data.hex))
                }
            }
        }
        Task {
            for activity in Activity<ScoresActivityAttributes>.activities { watch(activity) }
            for await activity in Activity<ScoresActivityAttributes>.activityUpdates { watch(activity) }
        }
    }

    private func watch(_ activity: Activity<ScoresActivityAttributes>) {
        guard watched.insert(activity.id).inserted else { return }
        Task {
            for await data in activity.pushTokenUpdates {
                await save(.init(activityId: activity.id, activityToken: data.hex))
            }
        }
        Task {
            for await state in activity.activityStateUpdates {
                syncRunning()
                if state == .dismissed || state == .ended {
                    await save(.init(ended: activity.id))
                    break
                }
            }
        }
    }

    func apply(_ status: LiveActivityStatus) { self.status = status }
    func report(_ message: String?) { lastError = message }

    func refreshStatus() async {
        guard let api else { return }
        do { status = try await api.liveStatus(); lastError = nil } catch { lastError = error.localizedDescription }
    }

    func setAuto(_ auto: Bool) async {
        guard let api else { return }
        do { status = try await api.setLiveAuto(auto); lastError = nil } catch { lastError = error.localizedDescription }
    }

    /// Starts the Live Activity showing `slide`. With push on the server it keeps rotating with the app closed.
    func start(week: Int, slide: LiveSlide) async {
        guard isEnabled else { lastError = "Live Activities are off for I Formation. Turn them on in Settings."; return }
        do {
            let content = ActivityContent(state: slide, staleDate: .now.addingTimeInterval(300))
            _ = try Activity.request(attributes: ScoresActivityAttributes(week: week), content: content,
                                     pushType: status?.push == false ? nil : .token)
            lastError = nil
            syncRunning()
        } catch {
            lastError = error.localizedDescription
        }
    }

    func update(_ slide: LiveSlide) async {
        let content = ActivityContent(state: slide, staleDate: .now.addingTimeInterval(300))
        for activity in Activity<ScoresActivityAttributes>.activities {
            await activity.update(content)
        }
    }

    func end() async {
        for activity in Activity<ScoresActivityAttributes>.activities {
            await activity.end(nil, dismissalPolicy: .immediate)
        }
        syncRunning()
    }

    private func syncRunning() {
        isRunning = Activity<ScoresActivityAttributes>.activities.contains { $0.activityState == .active || $0.activityState == .stale }
    }

    private func save(_ tokens: HuddleAPI.LiveTokens) async {
        guard let api else { return }
        do { status = try await api.saveLiveTokens(tokens) } catch { lastError = error.localizedDescription }
    }
}

private extension Data {
    var hex: String { map { String(format: "%02x", $0) }.joined() }
}
