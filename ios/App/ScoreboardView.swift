import SwiftUI

struct ScoreboardView: View {
    @Environment(HuddleStore.self) private var store

    var body: some View {
        NavigationStack {
            List {
                if !store.hasAccounts {
                    ContentUnavailableView("No leagues yet", systemImage: "person.crop.circle.badge.plus",
                                           description: Text("Add your Sleeper, ESPN and Yahoo accounts on the Accounts tab."))
                }
                if let board = store.scoreboard {
                    Section {
                        RecordSummary(matchups: board.matchups)
                        if let fandom = board.fandom { FandomSummary(fandom: fandom) }
                        IssueBanner(issues: board.errors, error: store.lastError)
                    }
                    ForEach(board.matchups) { matchup in
                        NavigationLink(value: matchup) { MatchupCard(matchup: matchup) }
                    }
                } else if store.isLoading {
                    ProgressView("Loading your leagues…").frame(maxWidth: .infinity)
                } else {
                    IssueBanner(issues: [], error: store.lastError)
                }
            }
            .navigationTitle("Scores")
            .navigationDestination(for: Matchup.self) { matchup in
                MatchupDetailView(matchupID: matchup.id)
            }
            .toolbar { ToolbarItem(placement: .topBarTrailing) { WeekMenu() } }
            .refreshable { await store.refreshScoreboard() }
            .autoRefresh(key: store.selectedWeek, isLive: { store.anyGameLive }) { await store.refreshScoreboard() }
        }
    }
}

/// "Winning 2 of 3" across every league this week.
struct RecordSummary: View {
    let matchups: [Matchup]

    var body: some View {
        let playing = matchups.filter { $0.opponent != nil }
        let winning = playing.filter { $0.result.leading == .me }.count
        let losing = playing.filter { $0.result.leading == .opponent }.count
        HStack {
            VStack(alignment: .leading) {
                Text(playing.allSatisfy { $0.result.status == .final } ? "Final" : "Right now")
                    .font(.caption).foregroundStyle(.secondary)
                Text("Winning \(winning) of \(playing.count)")
                    .font(.title2.bold())
            }
            Spacer()
            if losing > 0 {
                Text("\(losing) behind").font(.subheadline).foregroundStyle(.secondary)
            }
        }
    }
}

/// "You're a big Green Bay Packers fan this week. You really want the Chicago Bears to lose."
struct FandomSummary: View {
    let fandom: Fandom

    var body: some View {
        if fandom.fanOf != nil || fandom.against != nil {
            VStack(alignment: .leading, spacing: 10) {
                if let team = fandom.fanOf {
                    line(icon: "hand.thumbsup.fill", color: .green,
                         title: team.net >= 3 ? "You're a big \(team.name) fan this week" : "You're pulling for the \(team.name) this week",
                         detail: detail(count: team.rootFor, mine: true, names: team.myPlayers))
                }
                if let team = fandom.against {
                    line(icon: "hand.thumbsdown.fill", color: .red,
                         title: team.net <= -3 ? "You really want the \(team.name) to lose" : "You'd like the \(team.name) to lose",
                         detail: detail(count: team.rootAgainst, mine: false, names: team.theirPlayers))
                }
            }
            .padding(.vertical, 2)
        }
    }

    private func line(icon: String, color: Color, title: String, detail: String) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: icon).foregroundStyle(color).frame(width: 22)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.subheadline.weight(.semibold))
                Text(detail).font(.caption).foregroundStyle(.secondary)
            }
        }
    }

    /// "4 of your starters: Jordan Love, Josh Jacobs and 1 more"
    private func detail(count: Int, mine: Bool, names: [String]) -> String {
        let who = mine ? "of your starters" : "starters against you"
        let shown = names.prefix(2).joined(separator: ", ")
        let rest = names.count > 2 ? " and \(names.count - 2) more" : ""
        return "\(count) \(who): \(shown)\(rest)"
    }
}

struct MatchupCard: View {
    let matchup: Matchup

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                PlatformBadge(platform: matchup.platform)
                Text(matchup.leagueName).font(.subheadline.weight(.medium)).lineLimit(1)
                Spacer()
                StatusText(result: matchup.result)
            }
            ScoreRow(side: matchup.me, isLeading: matchup.result.leading == .me, playersLeft: matchup.result.myPlayersLeft)
            if let opponent = matchup.opponent {
                ScoreRow(side: opponent, isLeading: matchup.result.leading == .opponent, playersLeft: matchup.result.theirPlayersLeft)
            } else {
                Text("Bye week").font(.footnote).foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 4)
    }
}

struct ScoreRow: View {
    let side: TeamSide
    let isLeading: Bool
    let playersLeft: Int

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 1) {
                Text(side.teamName).font(.body.weight(isLeading ? .semibold : .regular)).lineLimit(1)
                if playersLeft > 0 {
                    Text("\(playersLeft) yet to play").font(.caption2).foregroundStyle(.secondary)
                }
            }
            Spacer()
            if let projected = side.projected {
                Text("proj \(projected.points)").font(.caption).foregroundStyle(.secondary)
            }
            Text(side.points.points)
                .font(.title3.monospacedDigit().weight(isLeading ? .bold : .regular))
        }
    }
}

struct StatusText: View {
    let result: MatchResult

    var body: some View {
        switch result.status {
        case .live: Label("Live", systemImage: "dot.radiowaves.left.and.right").font(.caption.bold()).foregroundStyle(.red)
        case .final: Text(result.leading == .me ? "Won" : result.leading == .opponent ? "Lost" : "Tied").font(.caption.bold())
        case .scheduled: Text("Upcoming").font(.caption).foregroundStyle(.secondary)
        case .bye, .unknown: EmptyView()
        }
    }
}
