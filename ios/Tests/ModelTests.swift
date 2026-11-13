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

    func testFeedDecodesAndMatchesTheServersSlides() throws {
        let feed: FeedSnapshot = try fixture("feed")
        XCTAssertEqual(feed.scores.map(\.leagueName), ["Dynasty Bros", "Work League", "Family League"])
        XCTAssertEqual(feed.scores[1].myTeam, "Allen Wrench")
        XCTAssertEqual(feed.scores[1].opponentScoreText, "55.4")
        let touchdown = try XCTUnwrap(feed.events.first)
        XCTAssertEqual(touchdown.kind, .touchdown)
        // The app builds the same slide from an event as the server pushes to the Live Activity.
        XCTAssertEqual(touchdown.slide(), feed.current)
        XCTAssertEqual(touchdown.slide(as: .play).pointsText, "+4.0")
        XCTAssertTrue(feed.liveActivity.push)
    }

    func testRotationAlternatesPlaysWithEachLeague() throws {
        let feed: FeedSnapshot = try fixture("feed")
        var rotator = SlideRotator()
        let shown = (0..<7).compactMap { _ in rotator.next(feed) }
            .map { $0.kind == .score ? $0.leagueName ?? "" : $0.kind.rawValue }
        // The fixture's touchdown was already there on the first load, so it isn't announced again.
        XCTAssertEqual(shown, ["play", "Dynasty Bros", "play", "Work League", "play", "Family League", "play"])
    }

    func testLiveSlideDecodesAMinimalPush() throws {
        let slide = try JSONDecoder().decode(LiveSlide.self, from: Data(#"{"kind":"score","myScore":100.3,"opponentScore":90.4,"future":1}"#.utf8))
        XCTAssertEqual(slide.myScoreText, "100.3")
        XCTAssertEqual(slide.opponentScoreText, "90.4")
    }
}
