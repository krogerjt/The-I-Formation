import { player, side } from '../model.js';
import { getJSON } from './http.js';

// Sleeper's public, read-only API. No auth: a user is found by username.
// https://docs.sleeper.com
export const SLEEPER_API = 'https://api.sleeper.app/v1';

export class SleeperProvider {
  constructor({ fetch = globalThis.fetch, players }) { this.fetch = fetch; this.players = players; this.users = new Map(); }

  get(path) { return getJSON(this.fetch, `${SLEEPER_API}${path}`, 'Sleeper'); }

  // { season, week } of the current NFL week. Used as the default week for every platform.
  async state() {
    const s = await this.get('/state/nfl');
    return { season: Number(s.league_season || s.season), week: Math.max(1, Number(s.display_week || s.week) || 1), seasonType: s.season_type };
  }

  async userId(username) {
    const key = username.toLowerCase();
    if (!this.users.has(key)) {
      const user = await this.get(`/user/${encodeURIComponent(username)}`);
      if (!user?.user_id) throw new Error(`No Sleeper user named "${username}".`);
      this.users.set(key, user.user_id);
    }
    return this.users.get(key);
  }

  async matchups({ username }, { season, week }) {
    const userId = await this.userId(username);
    const leagues = await this.get(`/user/${userId}/leagues/nfl/${season}`) || [];
    return Promise.all(leagues.map(league => this.leagueMatchup(league, userId, week)));
  }

  async leagueMatchup(league, userId, week) {
    const [rosters, users, matchups] = await Promise.all([
      this.get(`/league/${league.league_id}/rosters`),
      this.get(`/league/${league.league_id}/users`),
      this.get(`/league/${league.league_id}/matchups/${week}`),
    ]);
    const mine = rosters.find(r => r.owner_id === userId || (r.co_owners || []).includes(userId));
    const base = { platform: 'sleeper', leagueId: league.league_id, leagueName: league.name, week };
    if (!mine) return { ...base, me: null, opponent: null };
    const entries = matchups || [];
    const myEntry = entries.find(m => m.roster_id === mine.roster_id);
    const theirEntry = myEntry?.matchup_id != null && entries.find(m => m.matchup_id === myEntry.matchup_id && m.roster_id !== mine.roster_id);
    const teamSide = entry => {
      const roster = rosters.find(r => r.roster_id === entry.roster_id);
      const owner = users.find(u => u.user_id === roster?.owner_id);
      return side({
        teamName: owner?.metadata?.team_name || owner?.display_name || `Team ${entry.roster_id}`,
        owner: owner?.display_name || null,
        points: entry.custom_points ?? entry.points,
        players: this.sidePlayers(entry),
      });
    };
    return { ...base, me: myEntry ? teamSide(myEntry) : null, opponent: theirEntry ? teamSide(theirEntry) : null };
  }

  sidePlayers(entry) {
    const starters = (entry.starters || []).filter(id => id && id !== '0');
    const starterSet = new Set(starters);
    const bench = (entry.players || []).filter(id => !starterSet.has(id));
    return [...starters, ...bench].map(id => {
      const known = this.players.sleeperPlayer(id);
      return player({
        name: known?.name || id,
        position: known?.position,
        nflTeam: known?.nflTeam,
        points: entry.players_points?.[id] ?? null,
        starter: starterSet.has(id),
        ids: { sleeper: id },
      });
    });
  }
}
