import ActivityKit
import Foundation

/// The Live Activity. Its content is one slide at a time, pushed by the server every 30 seconds
/// (see server/src/live.js), or set by the app while it's open.
struct ScoresActivityAttributes: ActivityAttributes {
    typealias ContentState = LiveSlide
    /// The NFL week it follows. The server's push-to-start payload sends this as `attributes`.
    var week: Int
}

/// One slide of the rotation: a scoring play, a touchdown, or one league's score.
/// Every field but `kind` is optional so an older app still decodes a newer server's pushes.
struct LiveSlide: Codable, Hashable {
    enum Kind: String, Codable { case play, touchdown, score }

    var kind: Kind
    // Plays and touchdowns
    var nflTeam: String?
    var player: String?
    var text: String?
    var points: Double?
    /// How many of my leagues the play counted in.
    var leagues: Int?
    // Every kind
    var platform: Platform?
    var leagueName: String?
    // Scores: my team is always first.
    var myTeam: String?
    var myScore: Double?
    var opponentTeam: String?
    var opponentScore: Double?
    /// "me", "opponent" or "tied".
    var leading: String?
    /// 0...1, when a platform reports it.
    var winChance: Double?

    var pointsText: String {
        guard let points else { return "" }
        return (points >= 0 ? "+" : "") + points.formatted(.number.precision(.fractionLength(1)))
    }
    var myScoreText: String { (myScore ?? 0).formatted(.number.precision(.fractionLength(1))) }
    var opponentScoreText: String { (opponentScore ?? 0).formatted(.number.precision(.fractionLength(1))) }
}

/// What the server reports about the Live Activity.
struct LiveActivityStatus: Codable, Hashable {
    /// The server can push updates (it has an APNs key). Without it the app rotates the activity itself while open.
    let push: Bool
    /// Start automatically when my games kick off.
    let auto: Bool
    /// The phone has given the server a push-to-start token.
    let canAutoStart: Bool
    let active: Bool
}

/// A scoring play by one of my starters, newest first in the feed.
struct FeedEvent: Codable, Hashable, Identifiable {
    struct League: Codable, Hashable {
        let platform: Platform
        let leagueName: String
    }
    let id: String
    let at: String
    let kind: LiveSlide.Kind
    let player: String
    let nflTeam: String?
    let text: String
    let points: Double
    let leagues: [League]

    var date: Date? { ISO8601Parser.date(at) }

    /// The same slide the server builds in eventContent().
    func slide(as kind: LiveSlide.Kind? = nil) -> LiveSlide {
        let kind = kind ?? self.kind
        let names = leagues.map(\.leagueName).reduce(into: [String]()) { if !$0.contains($1) { $0.append($1) } }
        let leagueName = kind == .touchdown
            ? (names.count <= 2 ? names.joined(separator: " & ") : "\(names[0]) + \(names.count - 1) more")
            : names.first
        return LiveSlide(kind: kind, nflTeam: nflTeam, player: player, text: text, points: points, leagues: leagues.count,
                         platform: leagues.first?.platform, leagueName: leagueName)
    }
}

struct FeedSnapshot: Codable, Hashable {
    let season: Int?
    let week: Int?
    let updatedAt: String?
    /// "live", "soon" or "off": whether one of my starters' games is on.
    let window: String
    let scores: [LiveSlide]
    let events: [FeedEvent]
    let current: LiveSlide?
    let errors: [ProviderIssue]
    let liveActivity: LiveActivityStatus
}

/// The rotation, as on the server: a new touchdown first, then the latest play and one league's score in turn,
/// moving to the next league each time. Used by the Feed tab, and for the Live Activity when the server can't push.
struct SlideRotator {
    private var showPlay = true
    private var leagueIndex = 0
    private var shownTouchdowns = Set<String>()
    private var primed = false

    mutating func next(_ feed: FeedSnapshot, now: Date = .now) -> LiveSlide? {
        // Touchdowns that were already in the first feed are history, not news.
        if !primed {
            primed = true
            shownTouchdowns.formUnion(feed.events.filter { $0.kind == .touchdown }.map(\.id))
        }
        if let td = feed.events.last(where: { $0.kind == .touchdown && !shownTouchdowns.contains($0.id)
                                              && now.timeIntervalSince($0.date ?? now) < 600 }) {
            shownTouchdowns.insert(td.id)
            return td.slide(as: .touchdown)
        }
        let play = feed.events.first
        if let play, showPlay || feed.scores.isEmpty {
            showPlay = false
            return play.slide(as: .play)
        }
        guard !feed.scores.isEmpty else { return nil }
        let slide = feed.scores[leagueIndex % feed.scores.count]
        leagueIndex = (leagueIndex + 1) % feed.scores.count
        showPlay = true
        return slide
    }
}
