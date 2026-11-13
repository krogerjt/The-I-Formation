import XCTest
@testable import Huddle

/// Decodes responses the real server produced (server/test/export-fixtures.js), so the app and server
/// can't drift apart unnoticed.
final class ModelTests: XCTestCase {
    private func fixture<T: Decodable>(_ name: String) throws -> T {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: name, withExtension: "json"))
        return try JSONDecoder().decode(T.self, from: Data(contentsOf: url))
    }

    func testScoreboardDecodes() throws {
        let board: Scoreboard = try fixture("scoreboard")
        XCTAssertEqual(board.week, 10)
        XCTAssertEqual(board.matchups.map(\.platform), [.sleeper, .espn, .yahoo])
        let espn = try XCTUnwrap(board.matchups.first { $0.platform == .espn })
        XCTAssertEqual(espn.result.leading, .opponent)
        XCTAssertEqual(espn.result.status, .live)
        XCTAssertEqual(espn.me.starters.map(\.name), ["Josh Allen"])
        XCTAssertEqual(espn.me.bench.map(\.name), ["Bijan Robinson"])
        let allen = espn.me.starters[0]
        XCTAssertEqual(board.game(for: allen)?.name, "KC at BUF")
        let fandom = try XCTUnwrap(board.fandom)
        XCTAssertNil(fandom.fanOf)
        XCTAssertEqual(fandom.against?.name, "Atlanta Falcons")
        XCTAssertEqual(fandom.against?.theirPlayers, ["Bijan Robinson"])
    }

    func testRootingGuideDecodes() throws {
        let guide: RootingGuide = try fixture("rooting")
        XCTAssertEqual(guide.groups.first?.game?.name, "KC at BUF")
        let mahomes = try XCTUnwrap(guide.groups.flatMap(\.players).first { $0.name == "Patrick Mahomes" })
        XCTAssertEqual(mahomes.net, 1)
        XCTAssertEqual(mahomes.verdict, .for)
        XCTAssertEqual(mahomes.leagues.count, 3)
        XCTAssertEqual(mahomes.points, 24.3)
    }

    func testAccountsDecode() throws {
        let accounts: Accounts = try fixture("accounts")
        XCTAssertEqual(accounts.sleeper?.username, "jake")
        XCTAssertEqual(accounts.espn.first?.leagueId, "123")
        XCTAssertTrue(accounts.yahoo.connected)
    }

    func testKickoffWithoutSeconds() {
        XCTAssertNotNil(ISO8601Parser.date("2026-11-08T18:00Z"))
        XCTAssertNotNil(ISO8601Parser.date("2026-11-08T20:00:00.000Z"))
    }

    func testESPNInputOmitsUnsetCookies() throws {
        let json = try String(decoding: JSONEncoder().encode(HuddleAPI.ESPNLeagueInput(leagueId: "1", teamId: nil)), as: UTF8.self)
        XCTAssertEqual(json, #"{"leagueId":"1"}"#)
    }
}
