import Foundation

/// The server's list of headshots (see server/src/headshots.js).
struct HeadshotList: Codable, Hashable {
    struct Player: Codable, Hashable {
        let id: String
        let name: String
        let nflTeam: String?
        /// Changes when the server has a new picture of the player.
        let version: String
    }
    let updatedAt: String?
    let players: [Player]
}

/// Copies the server's headshots into the shared App Group folder, ahead of time, so the Live Activity
/// has a face to show when a push names a player. Runs when the app opens (at most every few hours) and
/// whenever the feed names a player the phone doesn't have yet, such as a waiver pickup.
actor HeadshotSync {
    static let shared = HeadshotSync()
    /// How often it checks the list: every few hours, or every ten minutes while the feed names a player the
    /// phone has no picture of (the server may have none either, so it doesn't ask on every refresh).
    private static let usualGap: TimeInterval = 4 * 60 * 60
    private static let soonGap: TimeInterval = 10 * 60

    private var lastRun: Date = .distantPast
    private var running = false

    /// Downloads new and changed pictures and deletes ones for players no longer on a roster.
    func run(api: HuddleAPI, soon: Bool = false) async {
        guard !running, Date.now.timeIntervalSince(lastRun) > (soon ? Self.soonGap : Self.usualGap),
              let folder = PlayerHeadshots.folder else { return }
        running = true
        defer { running = false }
        lastRun = .now
        guard let list = try? await api.headshots() else { return }
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)

        let versionsFile = folder.appendingPathComponent("versions.json")
        var versions = (try? JSONDecoder().decode([String: String].self, from: Data(contentsOf: versionsFile))) ?? [:]
        let wanted = list.players.filter { PlayerHeadshots.validID($0.id) && (versions[$0.id] != $0.version || !PlayerHeadshots.has($0.id)) }

        // A few at a time; a full roster set is only a few dozen small pictures.
        for start in stride(from: 0, to: wanted.count, by: 4) {
            let batch = wanted[start..<min(start + 4, wanted.count)]
            let saved = await withTaskGroup(of: (String, String)?.self) { group in
                for player in batch {
                    group.addTask {
                        guard let data = try? await api.headshot(player.id),
                              let small = PlayerHeadshots.shrink(data),
                              let target = PlayerHeadshots.file(for: player.id),
                              (try? small.write(to: target, options: .atomic)) != nil else { return nil }
                        return (player.id, player.version)
                    }
                }
                var out: [(String, String)] = []
                for await result in group { if let result { out.append(result) } }
                return out
            }
            for (id, version) in saved { versions[id] = version }
        }

        // Players dropped from every roster.
        let current = Set(list.players.map(\.id))
        for id in versions.keys where !current.contains(id) {
            if let file = PlayerHeadshots.file(for: id) { try? FileManager.default.removeItem(at: file) }
            versions[id] = nil
        }
        if let data = try? JSONEncoder().encode(versions) { try? data.write(to: versionsFile, options: .atomic) }
    }
}
