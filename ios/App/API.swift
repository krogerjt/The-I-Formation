import Foundation

struct APIError: LocalizedError {
    let message: String
    var status: Int? = nil
    var errorDescription: String? { message }
}

private struct ErrorEnvelope: Decodable { let error: String }
private struct YahooStart: Decodable { let url: URL; let callbackScheme: String }

/// Talks to the Huddle server, which in turn talks to Sleeper, ESPN and Yahoo.
struct HuddleAPI {
    let baseURL: URL
    let token: String

    /// The server and token compiled in through ios/Local.xcconfig.
    static let bundled: HuddleAPI? = {
        guard let address = Bundle.main.object(forInfoDictionaryKey: "HuddleServerURL") as? String,
              let token = Bundle.main.object(forInfoDictionaryKey: "HuddleAppToken") as? String,
              !token.isEmpty else { return nil }
        return try? HuddleAPI(address: address, token: token)
    }()

    init(address: String, token: String) throws {
        guard let url = URL(string: address.trimmingCharacters(in: .whitespacesAndNewlines)),
              let host = url.host, !host.hasSuffix(".invalid"),
              url.scheme == "https" || (url.scheme == "http" && ["localhost", "127.0.0.1"].contains(host)) else {
            throw APIError(message: "Huddle's server address isn't set. Add it to ios/Local.xcconfig and rebuild.")
        }
        baseURL = url
        self.token = token
    }

    func scoreboard(week: Int?) async throws -> Scoreboard {
        try await get("v1/scoreboard", query: week.map { [URLQueryItem(name: "week", value: String($0))] } ?? [])
    }

    func rooting(week: Int?, includeBench: Bool) async throws -> RootingGuide {
        var query = week.map { [URLQueryItem(name: "week", value: String($0))] } ?? []
        if includeBench { query.append(URLQueryItem(name: "bench", value: "1")) }
        return try await get("v1/rooting", query: query)
    }

    func accounts() async throws -> Accounts { try await get("v1/accounts") }

    func setSleeper(username: String) async throws {
        try await send("PUT", "v1/accounts/sleeper", body: ["username": username])
    }

    struct ESPNLeagueInput: Encodable {
        let leagueId: String
        let teamId: Int?
        /// Leave both nil to keep the cookies already saved for this league.
        var espnS2: String? = nil
        var swid: String? = nil

        func encode(to encoder: Encoder) throws {
            var c = encoder.container(keyedBy: CodingKeys.self)
            try c.encode(leagueId, forKey: .leagueId)
            try c.encodeIfPresent(teamId, forKey: .teamId)
            try c.encodeIfPresent(espnS2, forKey: .espnS2)
            try c.encodeIfPresent(swid, forKey: .swid)
        }
        enum CodingKeys: String, CodingKey { case leagueId, teamId, espnS2, swid }
    }

    func setESPN(leagues: [ESPNLeagueInput]) async throws {
        struct Body: Encodable { let leagues: [ESPNLeagueInput] }
        try await send("PUT", "v1/accounts/espn", body: Body(leagues: leagues))
    }

    /// The Yahoo sign-in page to open, and the URL scheme it returns to.
    func startYahoo() async throws -> (url: URL, callbackScheme: String) {
        let start: YahooStart = try await request("POST", "v1/yahoo/start", body: Optional<[String: String]>.none)
        return (start.url, start.callbackScheme)
    }

    func disconnectYahoo() async throws { try await send("DELETE", "v1/yahoo", body: Optional<[String: String]>.none) }

    // MARK: - Plumbing

    private func get<T: Decodable>(_ path: String, query: [URLQueryItem] = []) async throws -> T {
        try await request("GET", path, query: query, body: Optional<[String: String]>.none)
    }

    private func send<B: Encodable>(_ method: String, _ path: String, body: B?) async throws {
        let _: Accounts = try await request(method, path, body: body)
    }

    private func request<T: Decodable, B: Encodable>(_ method: String, _ path: String, query: [URLQueryItem] = [], body: B?) async throws -> T {
        var components = URLComponents(url: baseURL.appendingPathComponent(path), resolvingAgainstBaseURL: false)!
        if !query.isEmpty { components.queryItems = query }
        var req = URLRequest(url: components.url!)
        req.httpMethod = method
        req.timeoutInterval = 30
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        if let body {
            req.httpBody = try JSONEncoder().encode(body)
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        let (data, response) = try await URLSession.shared.data(for: req)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            let message = (try? JSONDecoder().decode(ErrorEnvelope.self, from: data))?.error ?? "The server returned \(status)."
            throw APIError(message: message, status: status)
        }
        return try JSONDecoder().decode(T.self, from: data)
    }
}
