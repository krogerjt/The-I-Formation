// The shared shape every provider returns, and helpers to identify the same NFL player across platforms.
//
// A matchup, as providers return it:
//   { platform, leagueId, leagueName, week, me: Side, opponent: Side | null }
// A side:
//   { teamName, owner, points, projected, players: Player[] }
// A player:
//   { name, position, nflTeam, points, starter, ids: { sleeper?, espn?, yahoo? } }
// The aggregator later adds `key` (a canonical player id) and `game` (the NFL game the player is in).

// Platforms disagree on a few team abbreviations; everything is stored in Sleeper's spelling.
const TEAM_ALIASES = { WSH: 'WAS', JAC: 'JAX', LA: 'LAR', OAK: 'LV', SD: 'LAC', STL: 'LAR' };

export function nflTeam(abbreviation) {
  if (!abbreviation) return null;
  const upper = String(abbreviation).trim().toUpperCase();
  if (!upper || upper === 'FA' || upper === 'NONE') return null;
  return TEAM_ALIASES[upper] || upper;
}

const POSITION_ALIASES = { 'D/ST': 'DEF', DST: 'DEF', 'DEF/ST': 'DEF', PK: 'K' };
export function position(value) {
  const upper = String(value || '').trim().toUpperCase();
  return POSITION_ALIASES[upper] || upper || null;
}

export function normalizeName(name) {
  return String(name || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, '')
    .replace(/[^a-z]/g, '');
}

export function round(points) {
  return points == null || Number.isNaN(Number(points)) ? null : Math.round(Number(points) * 100) / 100;
}

export function side({ teamName, owner = null, points = 0, projected = null, players = [] }) {
  return { teamName, owner, points: round(points) ?? 0, projected: round(projected), players };
}

export function player({ name, position: pos, nflTeam: team, points = null, starter = true, ids = {} }) {
  return { name, position: position(pos), nflTeam: nflTeam(team), points: round(points), starter: Boolean(starter), ids };
}
