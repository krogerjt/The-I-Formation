import { describePlay, shortName } from './providers/plays.js';
import { round } from './model.js';

// The live feed behind the Feed tab and the Live Activity.
//
// Every poll compares each of my starters' points with the last poll. A player whose points went up made
// a play; ESPN's play-by-play says what it was. Touchdowns are queued so the Live Activity can show them
// next, out of turn. Between touchdowns it alternates the latest play with one league's score, moving to
// the next league each time:  play, league 1, play, league 2, play, league 3, ...
//
// Content sent to the phone (the Live Activity's ContentState, so it must stay well under 4 KB):
//   { kind: 'play', nflTeam, player, text, points, leagueName, platform, leagues }
//   { kind: 'touchdown', nflTeam, player, text, points, leagueName, platform, leagues }
//   { kind: 'score', platform, leagueName, myTeam, myScore, opponentTeam, opponentScore, leading, winChance }

const MAX_EVENTS = 60;
const TOUCHDOWN_SHOWN_FOR = 10 * 60 * 1000; // a touchdown that hasn't been shown in 10 minutes is old news

export class LiveFeed {
  constructor({ aggregator, plays, now = Date.now }) {
    Object.assign(this, { aggregator, plays, now });
    this.week = null;
    this.baseline = new Map();     // `${matchupId}|${playerKey}` -> points at the last poll
    this.events = [];              // newest first
    this.pendingTouchdowns = [];
    this.seenTouchdowns = new Set();
    this.board = null;
    this.polledAt = 0;
    this.turn = 'play';
    this.leagueIndex = 0;
    this.current = null;
  }

  // Polls at most once per `minAge`; concurrent callers share one poll.
  async refresh(minAge = 25000) {
    if (this.board && this.now() - this.polledAt < minAge) return;
    this.polling ||= this.poll().finally(() => { this.polling = null; });
    return this.polling;
  }

  async poll() {
    const board = await this.aggregator.scoreboard();
    this.board = board;
    this.polledAt = this.now();
    const weekKey = `${board.season}:${board.week}`;
    const first = this.week !== weekKey;
    if (first) { this.week = weekKey; this.baseline.clear(); this.events = []; this.pendingTouchdowns = []; this.seenTouchdowns.clear(); }

    // Players whose points went up since the last poll, merged across leagues.
    const gains = new Map();
    for (const m of board.matchups) {
      for (const p of m.me?.players || []) {
        if (!p.starter || p.points == null) continue;
        const key = `${m.id}|${p.key}`, before = this.baseline.get(key);
        this.baseline.set(key, p.points);
        if (first || before == null || p.points <= before) continue;
        let gain = gains.get(p.key);
        if (!gain) gains.set(p.key, gain = { player: p, points: 0, leagues: [] });
        gain.points = Math.max(gain.points, round(p.points - before));
        gain.leagues.push({ platform: m.platform, leagueName: m.leagueName });
      }
    }

    const found = await Promise.all([...gains.values()].map(async gain => {
      const play = gain.player.gameId ? await this.plays.latestFor(gain.player.gameId, gain.player.name).catch(() => null) : null;
      return { gain, play };
    }));
    const at = new Date(this.now()).toISOString();
    for (const { gain: { player, points, leagues }, play } of found) {
      const text = play ? describePlay(play.text, player.name) : `${shortName(player.name) || player.name} added ${points.toFixed(1)} points`;
      const tdKey = play?.touchdown ? `${play.id}|${player.key}` : null;
      const touchdown = Boolean(tdKey && !this.seenTouchdowns.has(tdKey));
      if (tdKey) this.seenTouchdowns.add(tdKey);
      const event = {
        id: `${this.now()}:${player.key}`, at, kind: touchdown ? 'touchdown' : 'play',
        player: player.name, nflTeam: player.nflTeam, text, points, leagues, playId: play?.id ?? null,
      };
      this.events.unshift(event);
      if (touchdown) this.pendingTouchdowns.push(event);
    }
    this.events.length = Math.min(this.events.length, MAX_EVENTS);
    return board;
  }

  scores() {
    return (this.board?.matchups || []).filter(m => m.opponent).map(scoreContent);
  }

  latestPlay() { return this.events[0] || null; }

  // The next slide for the Live Activity, advancing the rotation. Null when there's nothing to show.
  next() {
    while (this.pendingTouchdowns.length) {
      const td = this.pendingTouchdowns.shift();
      if (this.now() - Date.parse(td.at) < TOUCHDOWN_SHOWN_FOR) return this.current = eventContent(td, 'touchdown');
    }
    const scores = this.scores(), play = this.latestPlay();
    if (play && (this.turn === 'play' || !scores.length)) {
      this.turn = 'score';
      return this.current = eventContent(play, 'play');
    }
    if (!scores.length) return null;
    const slide = scores[this.leagueIndex % scores.length];
    this.leagueIndex = (this.leagueIndex + 1) % scores.length;
    this.turn = 'play';
    return this.current = slide;
  }

  // Whether any game with one of my starters is on: 'live', 'soon' (kicks off within 3 hours) or 'off'.
  gameWindow() {
    const board = this.board;
    if (!board) return 'off';
    const mine = new Set(board.matchups.flatMap(m => (m.me?.players || []).filter(p => p.starter && p.gameId).map(p => p.gameId)));
    const games = board.games.filter(g => mine.has(g.id));
    if (games.some(g => g.state === 'live')) return 'live';
    const soon = games.some(g => g.state === 'scheduled' && Date.parse(g.kickoff) - this.now() < 3 * 60 * 60 * 1000 && Date.parse(g.kickoff) > this.now() - 60 * 60 * 1000);
    return soon ? 'soon' : 'off';
  }

  snapshot() {
    return {
      season: this.board?.season ?? null, week: this.board?.week ?? null, updatedAt: this.board?.updatedAt ?? null,
      window: this.gameWindow(), scores: this.scores(), events: this.events, current: this.current,
      errors: this.board?.errors || [],
    };
  }
}

export function eventContent(event, kind = event.kind) {
  const first = event.leagues[0] || {};
  return {
    kind, nflTeam: event.nflTeam, player: event.player, text: event.text, points: event.points,
    platform: first.platform ?? null,
    leagueName: kind === 'touchdown' ? leagueList(event.leagues) : first.leagueName ?? null,
    leagues: event.leagues.length,
  };
}

export function scoreContent(m) {
  return {
    kind: 'score', platform: m.platform, leagueName: m.leagueName,
    myTeam: m.me.teamName, myScore: m.me.points, opponentTeam: m.opponent.teamName, opponentScore: m.opponent.points,
    leading: m.result?.leading ?? null,
    // None of the platforms' APIs report a win probability today; the app shows it when present.
    winChance: m.winChance ?? null,
  };
}

function leagueList(leagues) {
  const names = [...new Set(leagues.map(l => l.leagueName))];
  if (names.length <= 2) return names.join(' & ');
  return `${names[0]} + ${names.length - 1} more`;
}
