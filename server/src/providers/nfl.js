import { nflTeam } from '../model.js';
import { getJSON } from './http.js';

// The NFL schedule and live game state, from ESPN's public scoreboard (no auth). Used to tell whether a
// player's game hasn't started, is live, or is final, and to group the rooting guide by game.
export const NFL_SCOREBOARD = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard';

export class NFLGames {
  constructor({ fetch = globalThis.fetch } = {}) { this.fetch = fetch; }

  // Map of team abbreviation -> game, for one week of the regular season (seasontype 2).
  async week({ season, week, seasonType = 2 }) {
    const data = await getJSON(this.fetch, `${NFL_SCOREBOARD}?dates=${season}&seasontype=${seasonType}&week=${week}`, 'NFL scoreboard');
    const byTeam = new Map();
    for (const event of data.events || []) {
      const competition = event.competitions?.[0];
      const teams = competition?.competitors || [];
      const home = teams.find(t => t.homeAway === 'home'), away = teams.find(t => t.homeAway === 'away');
      if (!home || !away) continue;
      const state = event.status?.type?.state;
      const game = {
        id: String(event.id),
        name: `${nflTeam(away.team.abbreviation)} at ${nflTeam(home.team.abbreviation)}`,
        kickoff: event.date,
        state: state === 'in' ? 'live' : state === 'post' ? 'final' : 'scheduled',
        detail: event.status?.type?.shortDetail || null,
        home: { team: nflTeam(home.team.abbreviation), score: Number(home.score) || 0 },
        away: { team: nflTeam(away.team.abbreviation), score: Number(away.score) || 0 },
      };
      byTeam.set(game.home.team, game);
      byTeam.set(game.away.team, game);
    }
    return byTeam;
  }
}
