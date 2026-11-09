import SwiftUI

/// Every player who matters to me this week, across every league, grouped by NFL game.
struct RootingView: View {
    @Environment(HuddleStore.self) private var store

    var body: some View {
        @Bindable var store = store
        NavigationStack {
            List {
                if let guide = store.rooting {
                    Section {
                        RootingSummary(summary: guide.summary)
                        Toggle("Show bench players", isOn: $store.includeBench)
                        IssueBanner(issues: guide.errors, error: store.lastError)
                    }
                    ForEach(guide.groups) { group in
                        Section {
                            ForEach(group.players) { RootingRow(player: $0) }
                        } header: {
                            GameHeader(game: group.game)
                        }
                    }
                } else if store.isLoading {
                    ProgressView("Adding up your rosters…").frame(maxWidth: .infinity)
                } else {
                    IssueBanner(issues: [], error: store.lastError)
                }
            }
            .navigationTitle("Root For")
            .toolbar { ToolbarItem(placement: .topBarTrailing) { WeekMenu() } }
            .refreshable { await store.refreshRooting() }
            .autoRefresh(key: [AnyHashable(store.selectedWeek), AnyHashable(store.includeBench)], isLive: { store.anyGameLive }) {
                await store.refreshRooting()
            }
        }
    }
}

private struct RootingSummary: View {
    let summary: RootingGuide.Summary

    var body: some View {
        HStack {
            stat(summary.rootFor, "root for", .green)
            Spacer()
            stat(summary.rootAgainst, "root against", .red)
            Spacer()
            stat(summary.conflicted, "torn", .orange)
        }
    }

    private func stat(_ value: Int, _ label: String, _ color: Color) -> some View {
        VStack {
            Text("\(value)").font(.title2.bold()).foregroundStyle(color)
            Text(label).font(.caption).foregroundStyle(.secondary)
        }
    }
}

private struct GameHeader: View {
    let game: NFLGame?

    var body: some View {
        if let game {
            HStack {
                Text(game.name)
                Spacer()
                switch game.state {
                case .scheduled: Text(game.kickoffDate?.formatted(.dateTime.weekday(.abbreviated).hour().minute()) ?? "")
                case .live: Text("\(game.scoreLine) · \(game.detail ?? "Live")").foregroundStyle(.red)
                case .final: Text("\(game.scoreLine) · Final")
                }
            }
        } else {
            Text("Bye or not scheduled")
        }
    }
}

struct RootingRow: View {
    let player: RootingPlayer
    @State private var expanded = false

    var body: some View {
        DisclosureGroup(isExpanded: $expanded) {
            ForEach(Array(player.leagues.enumerated()), id: \.offset) { _, league in
                HStack {
                    PlatformBadge(platform: league.platform)
                    Text(league.leagueName).font(.footnote).lineLimit(1)
                    Spacer()
                    Text(league.side == .me ? (league.starter ? "Your starter" : "Your bench") : (league.starter ? "Opponent's starter" : "Opponent's bench"))
                        .font(.caption)
                        .foregroundStyle(league.side == .me ? .green : .red)
                    if let points = league.points {
                        Text(points.points).font(.caption.monospacedDigit())
                    }
                }
            }
        } label: {
            HStack {
                NetBadge(player: player)
                VStack(alignment: .leading, spacing: 1) {
                    Text(player.name).font(.body.weight(.medium))
                    Text([player.position, player.nflTeam].compactMap { $0 }.joined(separator: " · "))
                        .font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 1) {
                    if let points = player.points { Text(points.points).font(.body.monospacedDigit()) }
                    Text(countsText).font(.caption2).foregroundStyle(.secondary)
                }
            }
        }
    }

    private var countsText: String {
        switch (player.rootFor, player.rootAgainst) {
        case (0, 0): "Bench only"
        case (let f, 0): "Yours in \(f)"
        case (0, let a): "Against you in \(a)"
        case (let f, let a): "Yours \(f), against \(a)"
        }
    }
}

private struct NetBadge: View {
    let player: RootingPlayer

    var body: some View {
        Text(player.net > 0 ? "+\(player.net)" : "\(player.net)")
            .font(.subheadline.monospacedDigit().bold())
            .frame(minWidth: 36, minHeight: 28)
            .background(color.opacity(0.18), in: RoundedRectangle(cornerRadius: 6))
            .foregroundStyle(color)
    }

    private var color: Color {
        switch player.verdict {
        case .for: .green
        case .against: .red
        case .conflicted: .orange
        case .bench: .gray
        }
    }
}
