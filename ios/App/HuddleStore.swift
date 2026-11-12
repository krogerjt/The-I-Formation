import Foundation
import Observation

/// Shared state for every screen: the selected week, the latest scoreboard and rooting guide.
@MainActor
@Observable
final class HuddleStore {
    let api: HuddleAPI?

    /// nil means "the current NFL week", which the server works out.
    var selectedWeek: Int?
    var includeBench = false

    private(set) var scoreboard: Scoreboard?
    private(set) var rooting: RootingGuide?
    private(set) var accounts: Accounts?
    private(set) var lastError: String?
    private(set) var isLoading = false

    init(api: HuddleAPI? = .bundled) {
        self.api = api
        if api == nil { lastError = "I Formation's server isn't configured. Add HUDDLE_SERVER_URL and HUDDLE_APP_TOKEN to ios/Local.xcconfig and rebuild." }
    }

    var currentWeek: Int? { scoreboard?.week ?? rooting?.week }
    var hasAccounts: Bool {
        guard let accounts else { return true }
        return accounts.sleeper != nil || !accounts.espn.isEmpty || accounts.yahoo.connected
    }
    /// Whether any NFL game this week is in progress, which is when auto refresh is worth it.
    var anyGameLive: Bool { (scoreboard?.games ?? []).contains { $0.state == .live } }

    func refreshScoreboard() async {
        await run { [self] api in scoreboard = try await api.scoreboard(week: selectedWeek) }
    }

    func refreshRooting() async {
        await run { [self] api in rooting = try await api.rooting(week: selectedWeek, includeBench: includeBench) }
    }

    func refreshAccounts() async {
        await run { [self] api in accounts = try await api.accounts() }
    }

    func setSleeper(_ username: String) async -> Bool {
        await run { [self] api in
            try await api.setSleeper(username: username.trimmingCharacters(in: .whitespaces))
            accounts = try await api.accounts()
        }
    }

    func setESPN(_ leagues: [HuddleAPI.ESPNLeagueInput]) async -> Bool {
        await run { [self] api in
            try await api.setESPN(leagues: leagues)
            accounts = try await api.accounts()
        }
    }

    func disconnectYahoo() async {
        await run { [self] api in
            try await api.disconnectYahoo()
            accounts = try await api.accounts()
        }
    }

    func yahooSignInURL() async -> (url: URL, callbackScheme: String)? {
        guard let api else { return nil }
        do { return try await api.startYahoo() } catch { lastError = error.localizedDescription; return nil }
    }

    func report(_ message: String?) { lastError = message }

    @discardableResult
    private func run(_ work: (HuddleAPI) async throws -> Void) async -> Bool {
        guard let api else { return false }
        isLoading = true
        defer { isLoading = false }
        do {
            try await work(api)
            lastError = nil
            return true
        } catch is CancellationError {
            return false
        } catch let error as URLError where error.code == .cancelled {
            return false
        } catch {
            lastError = error.localizedDescription
            return false
        }
    }
}
