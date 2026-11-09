import Foundation

// The server's JSON, as decoded by the app. See server/src/aggregate.js for how each field is built.

enum Platform: String, Codable, CaseIterable {
    case sleeper, espn, yahoo

    var label: String {
        switch self {
        case .sleeper: "Sleeper"
        case .espn: "ESPN"
        case .yahoo: "Yahoo"
        }
    }
}

struct ProviderIssue: Codable, Hashable {
    let platform: Platform
    let message: String
}

struct NFLGame: Codable, Hashable, Identifiable {
    struct Team: Codable, Hashable {
        let team: String
        let score: Int
    }
    enum State: String, Codable { case scheduled, live, final }

    let id: String
    let name: String
    let kickoff: String?
    let state: State
    let detail: String?
    let home: Team
    let away: Team

    var scoreLine: String { "\(away.team) \(away.score) – \(home.team) \(home.score)" }
    var kickoffDate: Date? { kickoff.flatMap(ISO8601Parser.date) }
}

struct Player: Codable, Hashable, Identifiable {
    let name: String
    let position: String?
    let nflTeam: String?
    let points: Double?
    let starter: Bool
    let key: String
    let gameId: String?

    var id: String { key }
}

struct TeamSide: Codable, Hashable {
    let teamName: String
    let owner: String?
    let points: Double
    let projected: Double?
    let players: [Player]

    var starters: [Player] { players.filter(\.starter) }
    var bench: [Player] { players.filter { !$0.starter } }
}

struct MatchResult: Codable, Hashable {
    enum Status: String, Codable { case scheduled, live, final, bye, unknown }
    enum Leader: String, Codable { case me, opponent, tied }

    let status: Status
    let margin: Double
    let leading: Leader
    let myPlayersLeft: Int
    let theirPlayersLeft: Int
}

struct Matchup: Codable, Hashable, Identifiable {
    let id: String
    let platform: Platform
    let leagueId: String
    let leagueName: String
    let week: Int
    let me: TeamSide
    let opponent: TeamSide?
    let result: MatchResult
}

struct Scoreboard: Codable, Hashable {
    let season: Int
    let week: Int
    let updatedAt: String
    let errors: [ProviderIssue]
    let games: [NFLGame]
    let matchups: [Matchup]

    func game(for player: Player) -> NFLGame? { games.first { $0.id == player.gameId } }
}

struct RootingPlayer: Codable, Hashable, Identifiable {
    struct League: Codable, Hashable {
        enum Side: String, Codable { case me, opponent }
        let platform: Platform
        let leagueName: String
        let side: Side
        let starter: Bool
        let points: Double?
    }
    enum Verdict: String, Codable { case `for`, against, conflicted, bench }

    let key: String
    let name: String
    let position: String?
    let nflTeam: String?
    let gameId: String?
    let rootFor: Int
    let rootAgainst: Int
    let net: Int
    let verdict: Verdict
    let leagues: [League]

    var id: String { key }
    /// The best points figure to show: leagues score differently, so this is the first one reported.
    var points: Double? { leagues.compactMap(\.points).first }
}

struct RootingGroup: Codable, Hashable, Identifiable {
    let game: NFLGame?
    let players: [RootingPlayer]
    var id: String { game?.id ?? "unscheduled" }
}

struct RootingGuide: Codable, Hashable {
    struct Summary: Codable, Hashable {
        let rootFor: Int
        let rootAgainst: Int
        let conflicted: Int
    }
    let season: Int
    let week: Int
    let updatedAt: String
    let errors: [ProviderIssue]
    let groups: [RootingGroup]
    let summary: Summary
}

struct Accounts: Codable, Hashable {
    struct Sleeper: Codable, Hashable { let username: String }
    struct ESPNLeague: Codable, Hashable, Identifiable {
        let leagueId: String
        let teamId: Int?
        let hasCookies: Bool
        var id: String { leagueId }
    }
    struct Yahoo: Codable, Hashable { let connected: Bool }

    let sleeper: Sleeper?
    let espn: [ESPNLeague]
    let yahoo: Yahoo
    let yahooAvailable: Bool?
}

enum ISO8601Parser {
    private static let withFraction: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
    private static let plain = ISO8601DateFormatter()
    private static let minutes: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "UTC")
        f.dateFormat = "yyyy-MM-dd'T'HH:mm'Z'"
        return f
    }()

    /// ESPN writes kickoffs as "2026-11-08T18:00Z", without seconds; the server writes full timestamps.
    static func date(_ text: String) -> Date? {
        withFraction.date(from: text) ?? plain.date(from: text) ?? minutes.date(from: text)
    }
}

extension Double {
    var points: String { formatted(.number.precision(.fractionLength(0...2))) }
}
