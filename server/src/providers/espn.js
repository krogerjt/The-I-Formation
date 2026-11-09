import { player, side } from '../model.js';
import { getJSON, ProviderError } from './http.js';

// ESPN has no official API. These are the undocumented v3 endpoints ESPN's own site uses, so expect them
// to change without notice. Public leagues need no auth; private leagues need the espn_s2 and SWID cookies
// from a signed-in browser.
export const ESPN_API = 'https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl';

const PRO_TEAMS = {
  1: 'ATL', 2: 'BUF', 3: 'CHI', 4: 'CIN', 5: 'CLE', 6: 'DAL', 7: 'DEN', 8: 'DET', 9: 'GB', 10: 'TEN', 11: 'IND',
  12: 'KC', 13: 'LV', 14: 'LAR', 15: 'MIA', 16: 'MIN', 17: 'NE', 18: 'NO', 19: 'NYG', 20: 'NYJ', 21: 'PHI',
  22: 'ARI', 23: 'PIT', 24: 'LAC', 25: 'SF', 26: 'SEA', 27: 'TB', 28: 'WAS', 29: 'CAR', 30: 'JAX', 33: 'BAL', 34: 'HOU',
};
const POSITIONS = { 1: 'QB', 2: 'RB', 3: 'WR', 4: 'TE', 5: 'K', 16: 'DEF' };
const BENCH_SLOTS = new Set([20, 21]); // bench, injured reserve

export class ESPNProvider {
  constructor({ fetch = globalThis.fetch } = {}) { this.fetch = fetch; }

  async matchups(leagues, { season, week }) {
    return Promise.all(leagues.map(league => this.leagueMatchup(league, season, week)));
  }

  async leagueMatchup({ leagueId, teamId, espnS2, swid }, season, week) {
    const views = ['mMatchupScore', 'mBoxscore', 'mTeam', 'mSettings'].map(v => `view=${v}`).join('&');
    const url = `${ESPN_API}/seasons/${season}/segments/0/leagues/${encodeURIComponent(leagueId)}?${views}&scoringPeriodId=${week}`;
    const headers = espnS2 && swid ? { cookie: `espn_s2=${espnS2}; SWID=${swid}` } : {};
    let data;
    try { data = await getJSON(this.fetch, url, 'ESPN', headers); }
    catch (error) {
      if (error.status === 401 || error.status === 403) throw new ProviderError(`ESPN league ${leagueId} is private. Add its espn_s2 and SWID cookies in Settings.`, error.status);
      throw error;
    }
    const teams = data.teams || [];
    const myTeam = teamId != null ? teams.find(t => String(t.id) === String(teamId))
      : swid ? teams.find(t => (t.owners || []).some(o => o.toUpperCase() === swid.toUpperCase())) : null;
    const base = { platform: 'espn', leagueId: String(leagueId), leagueName: data.settings?.name || `ESPN league ${leagueId}`, week };
    if (!myTeam) throw new ProviderError(`Couldn't tell which team is yours in ESPN league ${leagueId}. Set your team ID in Settings.`);
    const game = (data.schedule || []).find(g => g.matchupPeriodId === week && (g.home?.teamId === myTeam.id || g.away?.teamId === myTeam.id));
    if (!game) return { ...base, me: this.side(myTeam, null, data.members), opponent: null };
    const [mine, theirs] = game.home?.teamId === myTeam.id ? [game.home, game.away] : [game.away, game.home];
    return {
      ...base,
      me: this.side(myTeam, mine, data.members),
      opponent: theirs ? this.side(teams.find(t => t.id === theirs.teamId), theirs, data.members) : null,
    };
  }

  side(team, entry, members = []) {
    const owner = members.find(m => (team?.owners || []).includes(m.id));
    const roster = entry?.rosterForCurrentScoringPeriod?.entries || entry?.rosterForMatchupPeriod?.entries || [];
    return side({
      teamName: team?.name || [team?.location, team?.nickname].filter(Boolean).join(' ') || team?.abbrev || 'ESPN team',
      owner: owner ? owner.displayName || [owner.firstName, owner.lastName].filter(Boolean).join(' ') : null,
      points: entry?.totalPointsLive ?? entry?.totalPoints ?? 0,
      projected: entry?.totalProjectedPointsLive ?? null,
      players: roster.map(e => {
        const p = e.playerPoolEntry?.player || {};
        const pos = POSITIONS[p.defaultPositionId];
        return player({
          name: p.fullName || 'Unknown player',
          position: pos,
          nflTeam: PRO_TEAMS[p.proTeamId],
          points: e.playerPoolEntry?.appliedStatTotal ?? null,
          starter: !BENCH_SLOTS.has(e.lineupSlotId),
          ids: pos === 'DEF' ? {} : { espn: String(e.playerId ?? p.id) },
        });
      }),
    });
  }
}
