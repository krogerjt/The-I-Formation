import SwiftUI
import UIKit

// The slide views, shared by the Live Activity (lock screen and Dynamic Island) and the Feed tab.

/// The full slide: what the lock screen, the expanded Dynamic Island and the Feed tab show.
struct LiveSlideView: View {
    let slide: LiveSlide

    var body: some View {
        switch slide.kind {
        case .play: PlaySlide(slide: slide)
        case .touchdown: TouchdownSlide(slide: slide)
        case .score: ScoreSlide(slide: slide)
        }
    }
}

private struct LeagueLine: View {
    let slide: LiveSlide
    var body: some View {
        HStack(spacing: 4) {
            if let platform = slide.platform {
                Text(platform.label).fontWeight(.semibold).foregroundStyle(platform.tint)
            }
            if let name = slide.leagueName {
                if slide.platform != nil { Text("·").foregroundStyle(.secondary) }
                Text(name).foregroundStyle(.secondary)
            }
            if slide.kind == .play, let count = slide.leagues, count > 1 {
                Text("+ \(count - 1) more").foregroundStyle(.secondary)
            }
        }
        .font(.caption)
        .lineLimit(1)
    }
}

private struct PlaySlide: View {
    let slide: LiveSlide
    var body: some View {
        HStack(spacing: 12) {
            TeamLogo(team: slide.nflTeam, size: 44)
            VStack(alignment: .leading, spacing: 3) {
                LeagueLine(slide: slide)
                Text(slide.text ?? "")
                    .font(.headline)
                    .lineLimit(2)
                    .minimumScaleFactor(0.8)
                Text("\(slide.pointsText) points")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.green)
                    .contentTransition(.numericText())
            }
            Spacer(minLength: 0)
        }
    }
}

private struct TouchdownSlide: View {
    let slide: LiveSlide
    var body: some View {
        HStack(spacing: 12) {
            TeamLogo(team: slide.nflTeam, size: 44)
            VStack(alignment: .leading, spacing: 3) {
                Text("Touchdown!")
                    .font(.title3.weight(.heavy))
                    .foregroundStyle(.yellow)
                if let name = slide.leagueName { Text(name).font(.caption).foregroundStyle(.secondary).lineLimit(1) }
                Text(slide.text ?? "")
                    .font(.subheadline.weight(.semibold))
                    .lineLimit(2)
                    .minimumScaleFactor(0.8)
            }
            Spacer(minLength: 0)
        }
    }
}

private struct ScoreSlide: View {
    let slide: LiveSlide
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            LeagueLine(slide: slide)
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 1) {
                    Text(slide.myTeam ?? "Me").font(.caption.weight(.semibold)).lineLimit(1)
                    Text(slide.myScoreText)
                        .font(.title.weight(.bold).monospacedDigit())
                        .foregroundStyle(slide.leading == "me" ? .green : .primary)
                        .contentTransition(.numericText())
                }
                Spacer(minLength: 8)
                Text("vs").font(.caption).foregroundStyle(.secondary)
                Spacer(minLength: 8)
                VStack(alignment: .trailing, spacing: 1) {
                    Text(slide.opponentTeam ?? "Opponent").font(.caption.weight(.semibold)).lineLimit(1)
                    Text(slide.opponentScoreText)
                        .font(.title.weight(.bold).monospacedDigit())
                        .foregroundStyle(slide.leading == "opponent" ? .red : .primary)
                        .contentTransition(.numericText())
                }
            }
            if let chance = slide.winChance {
                Text("\(chance.formatted(.percent.precision(.fractionLength(0)))) chance to win")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }
}

// MARK: - Dynamic Island

/// Left of the camera: the team logo for a play, my score, or a football for a touchdown.
struct IslandLeading: View {
    let slide: LiveSlide
    var body: some View {
        switch slide.kind {
        case .play: TeamLogo(team: slide.nflTeam, size: 22)
        case .touchdown: Image(systemName: "football.fill").foregroundStyle(.yellow)
        case .score:
            Text(slide.myScoreText)
                .font(.caption.weight(.bold).monospacedDigit())
                .foregroundStyle(slide.leading == "me" ? .green : .white)
        }
    }
}

/// Right of the camera: "+3.0", the opponent's score, or "Touchdown!".
struct IslandTrailing: View {
    let slide: LiveSlide
    var body: some View {
        switch slide.kind {
        case .play: Text(slide.pointsText).font(.caption.weight(.bold).monospacedDigit()).foregroundStyle(.green)
        case .touchdown: Text("Touchdown!").font(.caption.weight(.heavy)).foregroundStyle(.yellow)
        case .score:
            Text(slide.opponentScoreText)
                .font(.caption.weight(.bold).monospacedDigit())
                .foregroundStyle(slide.leading == "opponent" ? .red : .white)
        }
    }
}

/// The smallest form, when another app shares the island.
struct IslandMinimal: View {
    let slide: LiveSlide
    var body: some View {
        switch slide.kind {
        case .play: Text(slide.pointsText).font(.caption2.weight(.bold)).foregroundStyle(.green).minimumScaleFactor(0.6)
        case .touchdown: Image(systemName: "football.fill").foregroundStyle(.yellow)
        case .score:
            Text((slide.myScore ?? 0).formatted(.number.precision(.fractionLength(0))))
                .font(.caption2.weight(.bold))
                .foregroundStyle(slide.leading == "me" ? .green : slide.leading == "opponent" ? .red : .white)
                .minimumScaleFactor(0.6)
        }
    }
}

// MARK: - Team logos

/// An NFL team's logo, from the copy the app saved in the shared App Group folder (widgets can't download),
/// or a badge in the team's color.
struct TeamLogo: View {
    let team: String?
    let size: CGFloat

    var body: some View {
        if let team, let image = TeamLogos.image(for: team) {
            Image(uiImage: image).resizable().scaledToFit().frame(width: size, height: size)
        } else {
            Circle()
                .fill(TeamLogos.color(for: team))
                .overlay(Text(team ?? "NFL").font(.system(size: size * 0.32, weight: .bold)).foregroundStyle(.white).minimumScaleFactor(0.5))
                .frame(width: size, height: size)
        }
    }
}

enum TeamLogos {
    static let appGroup = "group.com.krogerjt.huddle"
    static let teams = ["ARI", "ATL", "BAL", "BUF", "CAR", "CHI", "CIN", "CLE", "DAL", "DEN", "DET", "GB", "HOU", "IND", "JAX", "KC",
                        "LV", "LAC", "LAR", "MIA", "MIN", "NE", "NO", "NYG", "NYJ", "PHI", "PIT", "SF", "SEA", "TB", "TEN", "WAS"]

    static var folder: URL? {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup)?.appendingPathComponent("TeamLogos", isDirectory: true)
    }

    static func file(for team: String) -> URL? { folder?.appendingPathComponent("\(team).png") }

    static func image(for team: String) -> UIImage? {
        guard let url = file(for: team) else { return nil }
        return UIImage(contentsOfFile: url.path)
    }

    /// Saves any missing logos, shrunk to 96 points square, so the Live Activity can show them. Runs in the app.
    static func downloadMissing() async {
        guard let folder else { return }
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        await withTaskGroup(of: Void.self) { group in
            for team in teams {
                guard let target = file(for: team), !FileManager.default.fileExists(atPath: target.path) else { continue }
                let espn = team == "WAS" ? "wsh" : team.lowercased()
                guard let source = URL(string: "https://a.espncdn.com/i/teamlogos/nfl/500/\(espn).png") else { continue }
                group.addTask {
                    guard let (data, response) = try? await URLSession.shared.data(from: source),
                          (response as? HTTPURLResponse)?.statusCode == 200,
                          let image = UIImage(data: data) else { return }
                    let format = UIGraphicsImageRendererFormat()
                    format.scale = 1
                    let small = UIGraphicsImageRenderer(size: CGSize(width: 96, height: 96), format: format).pngData { _ in
                        image.draw(in: CGRect(x: 0, y: 0, width: 96, height: 96))
                    }
                    try? small.write(to: target, options: .atomic)
                }
            }
        }
    }

    private static let colors: [String: UInt32] = [
        "ARI": 0x97233F, "ATL": 0xA71930, "BAL": 0x241773, "BUF": 0x00338D, "CAR": 0x0085CA, "CHI": 0x0B162A, "CIN": 0xFB4F14, "CLE": 0x311D00,
        "DAL": 0x041E42, "DEN": 0xFB4F14, "DET": 0x0076B6, "GB": 0x203731, "HOU": 0x03202F, "IND": 0x002C5F, "JAX": 0x006778, "KC": 0xE31837,
        "LV": 0x000000, "LAC": 0x0080C6, "LAR": 0x003594, "MIA": 0x008E97, "MIN": 0x4F2683, "NE": 0x002244, "NO": 0xD3BC8D, "NYG": 0x0B2265,
        "NYJ": 0x125740, "PHI": 0x004C54, "PIT": 0xFFB612, "SF": 0xAA0000, "SEA": 0x002244, "TB": 0xD50A0A, "TEN": 0x0C2340, "WAS": 0x5A1414,
    ]

    static func color(for team: String?) -> Color {
        guard let team, let hex = colors[team] else { return .gray }
        return Color(red: Double((hex >> 16) & 0xFF) / 255, green: Double((hex >> 8) & 0xFF) / 255, blue: Double(hex & 0xFF) / 255)
    }
}

extension Platform {
    /// The platform's color on slides. The app's PlatformBadge uses the same hues.
    var tint: Color {
        switch self {
        case .sleeper: .indigo
        case .espn: .red
        case .yahoo: .purple
        }
    }
}
