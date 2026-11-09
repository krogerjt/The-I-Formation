// Trimmed responses in each platform's real shape, for week 10 of 2026.
// Mahomes, Allen, Lamb and Robinson appear in several leagues under each platform's own ids.
import { SLEEPER_API } from '../src/providers/sleeper.js';
import { ESPN_API } from '../src/providers/espn.js';
import { YAHOO_API } from '../src/providers/yahoo.js';
import { NFL_SCOREBOARD } from '../src/providers/nfl.js';
import { PLAYERS_URL } from '../src/players.js';

export const players = {
  4046: { full_name: 'Patrick Mahomes', position: 'QB', team: 'KC', espn_id: 3139477, yahoo_id: 30123 },
  4984: { full_name: 'Josh Allen', position: 'QB', team: 'BUF', espn_id: 3918298, yahoo_id: 30977 },
  6786: { full_name: 'CeeDee Lamb', position: 'WR', team: 'DAL', espn_id: 4241389, yahoo_id: 32703 },
  9509: { full_name: 'Bijan Robinson', position: 'RB', team: 'ATL', espn_id: 4430807, yahoo_id: 33393 },
  KC: { first_name: 'Kansas City', last_name: 'Chiefs', position: 'DEF', team: 'KC' },
};

export const sleeper = {
  [`${SLEEPER_API}/state/nfl`]: { season: '2026', league_season: '2026', week: 10, display_week: 10, season_type: 'regular' },
  [`${SLEEPER_API}/user/jake`]: { user_id: 'u1', display_name: 'jake' },
  [`${SLEEPER_API}/user/u1/leagues/nfl/2026`]: [{ league_id: 'L1', name: 'Dynasty Bros' }],
  [`${SLEEPER_API}/league/L1/rosters`]: [{ roster_id: 1, owner_id: 'u1' }, { roster_id: 2, owner_id: 'u2' }, { roster_id: 3, owner_id: 'u3' }],
  [`${SLEEPER_API}/league/L1/users`]: [
    { user_id: 'u1', display_name: 'jake', metadata: { team_name: 'Kroger Kings' } },
    { user_id: 'u2', display_name: 'sam' },
    { user_id: 'u3', display_name: 'alex' },
  ],
  [`${SLEEPER_API}/league/L1/matchups/10`]: [
    { roster_id: 1, matchup_id: 1, points: 41.5, starters: ['4046', '6786', '0'], players: ['4046', '6786', '9509'], players_points: { 4046: 24.3, 6786: 17.2, 9509: 9 } },
    { roster_id: 2, matchup_id: 1, points: 30.1, starters: ['4984'], players: ['4984'], players_points: { 4984: 30.1 } },
    { roster_id: 3, matchup_id: 2, points: 0, starters: [], players: [] },
  ],
};

export const espnLeague = {
  settings: { name: 'Work League' },
  members: [{ id: '{AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA}', displayName: 'jkroger' }, { id: '{BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB}', displayName: 'boss' }],
  teams: [
    { id: 1, name: 'Allen Wrench', owners: ['{AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA}'] },
    { id: 2, location: 'Team', nickname: 'Boss', owners: ['{BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB}'] },
  ],
  schedule: [
    { matchupPeriodId: 9, home: { teamId: 1, totalPoints: 100 }, away: { teamId: 2, totalPoints: 90 } },
    {
      matchupPeriodId: 10,
      home: { teamId: 2, totalPoints: 50, totalPointsLive: 55.4, totalProjectedPointsLive: 101.2, rosterForCurrentScoringPeriod: { entries: [
        { playerId: 3139477, lineupSlotId: 0, playerPoolEntry: { appliedStatTotal: 24.3, player: { fullName: 'Patrick Mahomes', proTeamId: 12, defaultPositionId: 1 } } },
        { playerId: 4241389, lineupSlotId: 4, playerPoolEntry: { appliedStatTotal: 17.2, player: { fullName: 'CeeDee Lamb', proTeamId: 6, defaultPositionId: 3 } } },
        { playerId: -16012, lineupSlotId: 16, playerPoolEntry: { appliedStatTotal: 6, player: { fullName: 'Chiefs D/ST', proTeamId: 12, defaultPositionId: 16 } } },
      ] } },
      away: { teamId: 1, totalPoints: 28, totalPointsLive: 30.1, totalProjectedPointsLive: 98.7, rosterForCurrentScoringPeriod: { entries: [
        { playerId: 3918298, lineupSlotId: 0, playerPoolEntry: { appliedStatTotal: 30.1, player: { fullName: 'Josh Allen', proTeamId: 2, defaultPositionId: 1 } } },
        { playerId: 4430807, lineupSlotId: 20, playerPoolEntry: { appliedStatTotal: 9, player: { fullName: 'Bijan Robinson', proTeamId: 1, defaultPositionId: 2 } } },
      ] } },
    },
  ],
};

const yTeam = (key, name, extra = []) => [[{ team_key: key }, { team_id: key.split('.t.')[1] }, { name }, [], { managers: [{ manager: { nickname: name.split(' ')[0] } }] }], ...extra];
const yPlayer = (id, name, team, pos, slot, points) => ({ player: [
  [{ player_key: `461.p.${id}` }, { player_id: String(id) }, { name: { full: name } }, { editorial_team_abbr: team }, { display_position: pos }],
  { selected_position: [{ coverage_type: 'week' }, { week: '10' }, { position: slot }] },
  { player_points: { coverage_type: 'week', week: '10', total: String(points) } },
] });
export const yahoo = {
  [`${YAHOO_API}/users;use_login=1/games;game_keys=nfl/teams`]: { fantasy_content: { users: { 0: { user: [{ guid: 'G' }, { games: { 0: { game: [{ game_key: '461' }, { teams: { 0: { team: [[{ team_key: '461.l.777.t.4' }, { name: 'Yahoo Jake' }]] }, count: 1 } }] }, count: 1 } }] }, count: 1 } } },
  [`${YAHOO_API}/users;use_login=1/games;game_keys=nfl/leagues`]: { fantasy_content: { users: { 0: { user: [{ guid: 'G' }, { games: { 0: { game: [{ game_key: '461' }, { leagues: { 0: { league: [{ league_key: '461.l.777', name: 'Family League' }] }, count: 1 } }] }, count: 1 } }] }, count: 1 } } },
  [`${YAHOO_API}/team/461.l.777.t.4/matchups;weeks=10`]: { fantasy_content: { team: [[{ team_key: '461.l.777.t.4' }], { matchups: { 0: { matchup: { week: '10', status: 'midevent', 0: { teams: {
    0: { team: yTeam('461.l.777.t.4', 'Yahoo Jake', [{ team_points: { total: '24.30' } }, { team_projected_points: { total: '110.5' } }]) },
    1: { team: yTeam('461.l.777.t.9', 'Cousin Ed', [{ team_points: { total: '9.00' } }, { team_projected_points: { total: '95' } }]) },
    count: 2 } } } }, count: 1 } }] } },
  [`${YAHOO_API}/team/461.l.777.t.4/roster;week=10`]: { fantasy_content: { team: [[{ team_key: '461.l.777.t.4' }], { roster: { 0: { players: { 0: yPlayer(30123, 'Patrick Mahomes', 'KC', 'QB', 'QB', 24.3), 1: yPlayer(30977, 'Josh Allen', 'Buf', 'QB', 'BN', 30.1), count: 2 } }, week: '10' } }] } },
  [`${YAHOO_API}/team/461.l.777.t.9/roster;week=10`]: { fantasy_content: { team: [[{ team_key: '461.l.777.t.9' }], { roster: { 0: { players: { 0: yPlayer(33393, 'Bijan Robinson', 'Atl', 'RB', 'RB', 9), count: 1 } }, week: '10' } }] } },
};

const competitor = (homeAway, abbreviation, score) => ({ homeAway, score: String(score), team: { abbreviation } });
export const nfl = {
  [NFL_SCOREBOARD]: { events: [
    { id: '401', date: '2026-11-08T18:00Z', status: { type: { state: 'in', shortDetail: '10:12 - 3rd' } }, competitions: [{ competitors: [competitor('home', 'BUF', 17), competitor('away', 'KC', 21)] }] },
    { id: '402', date: '2026-11-08T21:25Z', status: { type: { state: 'pre', shortDetail: '4:25 PM' } }, competitions: [{ competitors: [competitor('home', 'DAL', 0), competitor('away', 'ATL', 0)] }] },
  ] },
};

export const allRoutes = { ...sleeper, [`${ESPN_API}/seasons/2026/segments/0/leagues/123`]: espnLeague, ...yahoo, ...nfl, [PLAYERS_URL]: players };
export const yahooTokens = { accessToken: 'access', refreshToken: 'refresh', expiresAt: Date.parse('2026-11-08T22:00:00Z') };
