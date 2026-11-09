// Turns every platform's matchups into the two things the app shows: a scoreboard and a rooting guide.

export class Aggregator {
  constructor({ sleeper, espn, yahoo, nfl, players, store, ttl = 30000, now = Date.now }) {
    Object.assign(this, { sleeper, espn, yahoo, nfl, players, store, ttl, now });
    this.cache = new Map();
  }

  async currentWeek() {
    if (this.week && this.now() - this.week.at < 10 * 60 * 1000) return this.week.value;
    try { this.week = { at: this.now(), value: await this.sleeper.state() }; return this.week.value; }
    catch { return this.week?.value || { season: seasonFor(new Date(this.now())), week: 1 }; }
  }

  // Every connected league's matchup for one week, with each player tagged with a canonical key and game.
  async collect({ season, week } = {}) {
    if (!season || !week) {
      const current = await this.currentWeek();
      season ||= current.season; week ||= current.week;
    }
    const key = `${season}:${week}:${this.store.version}`;
    const cached = this.cache.get(key);
    if (cached && this.now() - cached.at < this.ttl) return cached.value;

    const accounts = this.store.accounts();
    const jobs = [];
    if (accounts.sleeper?.username) jobs.push(['sleeper', () => this.sleeper.matchups(accounts.sleeper, { season, week })]);
    if (accounts.espn?.length) jobs.push(['espn', () => this.espn.matchups(accounts.espn, { season, week })]);
    if (accounts.yahoo?.tokens) jobs.push(['yahoo', () => this.yahoo.matchups({ tokens: accounts.yahoo.tokens, save: tokens => this.store.saveYahooTokens(tokens) }, { season, week })]);

    const [, games, results] = await Promise.all([
      this.players.refresh().catch(() => {}),
      this.nfl.week({ season, week }).catch(() => new Map()),
      Promise.allSettled(jobs.map(([, run]) => run())),
    ]);
    const matchups = [], errors = [];
    results.forEach((result, i) => {
      if (result.status === 'fulfilled') matchups.push(...result.value.filter(m => m.me));
      else errors.push({ platform: jobs[i][0], message: result.reason?.message || 'Request failed.' });
    });
    for (const m of matchups) for (const s of [m.me, m.opponent]) for (const p of s?.players || []) {
      p.key = this.players.keyFor(p);
      p.gameId = games.get(p.nflTeam)?.id || null;
    }
    const value = { season, week, updatedAt: new Date(this.now()).toISOString(), matchups, games: [...new Map([...games.values()].map(g => [g.id, g])).values()], errors };
    this.cache.set(key, { at: this.now(), value });
    if (this.cache.size > 20) this.cache.delete(this.cache.keys().next().value);
    return value;
  }

  async scoreboard(options) {
    const data = await this.collect(options);
    return {
      season: data.season, week: data.week, updatedAt: data.updatedAt, errors: data.errors, games: data.games,
      matchups: data.matchups.map(m => ({
        id: `${m.platform}:${m.leagueId}`,
        ...m,
        result: matchResult(m, data.games),
      })),
    };
  }

  async rooting({ includeBench = false, ...options } = {}) {
    const data = await this.collect(options);
    return { season: data.season, week: data.week, updatedAt: data.updatedAt, errors: data.errors, ...rootingGuide(data, { includeBench }) };
  }
}

// "winning", "losing" or "tied", and whether it's over: final once every rostered starter's game is final.
export function matchResult(m, games) {
  const diff = (m.me?.points ?? 0) - (m.opponent?.points ?? 0);
  const byId = new Map(games.map(g => [g.id, g]));
  const starters = [m.me, m.opponent].flatMap(s => s?.players || []).filter(p => p.starter);
  const states = starters.map(p => byId.get(p.gameId)?.state).filter(Boolean);
  const status = !m.opponent ? 'bye' : !states.length ? 'unknown' : states.every(s => s === 'final') ? 'final' : states.some(s => s !== 'scheduled') ? 'live' : 'scheduled';
  const yetToPlay = side => (side?.players || []).filter(p => p.starter && byId.get(p.gameId)?.state === 'scheduled').length;
  return { status, margin: Math.round(diff * 100) / 100, leading: diff > 0 ? 'me' : diff < 0 ? 'opponent' : 'tied', myPlayersLeft: yetToPlay(m.me), theirPlayersLeft: yetToPlay(m.opponent) };
}

// For each real player: how many of my matchups he helps (my starter) and hurts (an opponent's starter).
export function rootingGuide({ matchups, games }, { includeBench = false } = {}) {
  const byKey = new Map();
  for (const m of matchups) {
    for (const [role, s] of [['me', m.me], ['opponent', m.opponent]]) {
      for (const p of s?.players || []) {
        if (!p.starter && !includeBench) continue;
        let entry = byKey.get(p.key);
        if (!entry) byKey.set(p.key, entry = { key: p.key, name: p.name, position: p.position, nflTeam: p.nflTeam, gameId: p.gameId, rootFor: 0, rootAgainst: 0, net: 0, leagues: [] });
        if (p.starter) role === 'me' ? entry.rootFor++ : entry.rootAgainst++;
        entry.leagues.push({ platform: m.platform, leagueName: m.leagueName, side: role, starter: p.starter, points: p.points });
      }
    }
  }
  const players = [...byKey.values()].map(e => ({ ...e, net: e.rootFor - e.rootAgainst, verdict: verdict(e) }));
  const order = (a, b) => Math.abs(b.net) - Math.abs(a.net) || (b.rootFor + b.rootAgainst) - (a.rootFor + a.rootAgainst) || a.name.localeCompare(b.name);
  const gameList = [...games].sort((a, b) => String(a.kickoff).localeCompare(String(b.kickoff)) || a.name.localeCompare(b.name));
  const groups = gameList.map(game => ({ game, players: players.filter(p => p.gameId === game.id).sort(order) })).filter(g => g.players.length);
  const unscheduled = players.filter(p => !p.gameId).sort(order);
  if (unscheduled.length) groups.push({ game: null, players: unscheduled });
  return {
    groups,
    summary: {
      rootFor: players.filter(p => p.verdict === 'for').length,
      rootAgainst: players.filter(p => p.verdict === 'against').length,
      conflicted: players.filter(p => p.verdict === 'conflicted').length,
    },
  };
}

function verdict({ rootFor, rootAgainst }) {
  if (rootFor && rootAgainst) return rootFor > rootAgainst ? 'for' : rootFor < rootAgainst ? 'against' : 'conflicted';
  return rootFor ? 'for' : rootAgainst ? 'against' : 'bench';
}

// The NFL season is named for the year it starts; January and February games belong to the previous year.
export function seasonFor(date) { return date.getUTCMonth() < 2 ? date.getUTCFullYear() - 1 : date.getUTCFullYear(); }
