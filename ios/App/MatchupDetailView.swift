import SwiftUI

/// Both lineups for one league, starters first. Reads the matchup from the store so it updates live.
struct MatchupDetailView: View {
    @Environment(HuddleStore.self) private var store
    let matchupID: String

    var body: some View {
        if let board = store.scoreboard, let matchup = board.matchups.first(where: { $0.id == matchupID }) {
            List {
                Section {
                    MatchupCard(matchup: matchup)
                }
                Section("Starters") {
                    LineupRows(mine: matchup.me.starters, theirs: matchup.opponent?.starters ?? [], board: board)
                }
                if !matchup.me.bench.isEmpty || !(matchup.opponent?.bench.isEmpty ?? true) {
                    Section("Bench") {
                        LineupRows(mine: matchup.me.bench, theirs: matchup.opponent?.bench ?? [], board: board)
                    }
                }
            }
            .navigationTitle(matchup.leagueName)
            .navigationBarTitleDisplayMode(.inline)
            .refreshable { await store.refreshScoreboard() }
        } else {
            ContentUnavailableView("Matchup unavailable", systemImage: "questionmark.circle")
        }
    }
}

private struct LineupRows: View {
    let mine: [Player]
    let theirs: [Player]
    let board: Scoreboard

    var body: some View {
        ForEach(0..<max(mine.count, theirs.count), id: \.self) { i in
            HStack(alignment: .top) {
                PlayerCell(player: mine[safe: i], game: mine[safe: i].flatMap(board.game(for:)), alignment: .leading)
                Divider()
                PlayerCell(player: theirs[safe: i], game: theirs[safe: i].flatMap(board.game(for:)), alignment: .trailing)
            }
        }
    }
}

private struct PlayerCell: View {
    let player: Player?
    let game: NFLGame?
    let alignment: HorizontalAlignment

    var body: some View {
        VStack(alignment: alignment, spacing: 2) {
            if let player {
                HStack {
                    if alignment == .trailing { points(player) }
                    Text(player.name).font(.subheadline).lineLimit(1)
                    if alignment == .leading { points(player) }
                }
                Text([player.position, player.nflTeam, gameText].compactMap { $0 }.joined(separator: " · "))
                    .font(.caption2).foregroundStyle(.secondary).lineLimit(1)
            }
        }
        .frame(maxWidth: .infinity, alignment: Alignment(horizontal: alignment, vertical: .center))
    }

    private func points(_ player: Player) -> some View {
        Text(player.points?.points ?? "–").font(.subheadline.monospacedDigit().bold())
    }

    private var gameText: String? {
        guard let game else { return player?.nflTeam == nil ? nil : "Bye" }
        switch game.state {
        case .scheduled: return game.kickoffDate?.formatted(.dateTime.weekday(.abbreviated).hour().minute()) ?? game.detail
        case .live: return game.detail ?? "Live"
        case .final: return "Final"
        }
    }
}

extension Array {
    subscript(safe index: Int) -> Element? { indices.contains(index) ? self[index] : nil }
}
