import { player, side } from '../model.js';
import { getJSON, ProviderError } from './http.js';

// Yahoo's official Fantasy Sports API, over OAuth 2.0. The client secret stays on this server.
// https://developer.yahoo.com/fantasysports/guide/
export const YAHOO_API = 'https://fantasysports.yahooapis.com/fantasy/v2';
export const YAHOO_AUTHORIZE = 'https://api.login.yahoo.com/oauth2/request_auth';
export const YAHOO_TOKEN = 'https://api.login.yahoo.com/oauth2/get_token';
const BENCH = new Set(['BN', 'IR', 'IR+']);

// Yahoo's JSON wraps lists as {"0": ..., "1": ..., "count": n} and objects as arrays of one-key objects.
export const items = obj => obj ? Object.keys(obj).filter(k => k !== 'count').sort((a, b) => a - b).map(k => obj[k]) : [];
export const flat = arr => Array.isArray(arr) ? arr.reduce((acc, part) => Array.isArray(part) ? { ...acc, ...flat(part) } : (part && typeof part === 'object' ? { ...acc, ...part } : acc), {}) : (arr || {});

export class YahooProvider {
  constructor({ fetch = globalThis.fetch, clientId, clientSecret, redirectUri, now = Date.now }) {
    Object.assign(this, { fetch, clientId, clientSecret, redirectUri, now });
  }

  get configured() { return Boolean(this.clientId && this.clientSecret && this.redirectUri); }

  authorizeURL(state) {
    // fspt-r is Fantasy Sports read access. Without it Yahoo issues a sign-in-only token and every
    // Fantasy API call returns 403 "This application is not authorized to perform this action."
    const params = new URLSearchParams({ client_id: this.clientId, redirect_uri: this.redirectUri, response_type: 'code', scope: 'fspt-r', state });
    return `${YAHOO_AUTHORIZE}?${params}`;
  }

  async token(params) {
    const res = await this.fetch(YAHOO_TOKEN, {
      method: 'POST',
      headers: {
        authorization: `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64')}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ redirect_uri: this.redirectUri, ...params }).toString(),
      signal: AbortSignal.timeout(15000),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new ProviderError(`Yahoo sign-in failed: ${body.error_description || body.error || res.status}. Reconnect Yahoo in Settings.`, 401);
    return { accessToken: body.access_token, refreshToken: body.refresh_token, expiresAt: this.now() + (Number(body.expires_in) || 3600) * 1000 };
  }

  exchange(code) { return this.token({ grant_type: 'authorization_code', code }); }

  // Returns valid tokens, refreshing a minute before expiry. `save` persists refreshed tokens.
  async fresh(tokens, save) {
    if (!tokens?.refreshToken) throw new ProviderError('Yahoo is not connected. Connect it in Settings.', 401);
    if (tokens.expiresAt - this.now() > 60000) return tokens;
    const next = await this.token({ grant_type: 'refresh_token', refresh_token: tokens.refreshToken });
    next.refreshToken ||= tokens.refreshToken;
    await save(next);
    return next;
  }

  async get(tokens, path) {
    const sep = path.includes('?') ? '&' : '?';
    try {
      const data = await getJSON(this.fetch, `${YAHOO_API}${path}${sep}format=json`, 'Yahoo', { authorization: `Bearer ${tokens.accessToken}` });
      return data.fantasy_content;
    } catch (error) {
      // A fresh, consented token still gets 403 when Yahoo hasn't approved this developer app for the
      // Fantasy Sports API. Re-signing in can't fix that, so say what can.
      if (error instanceof ProviderError && error.status === 403) {
        throw new ProviderError('Yahoo hasn\'t approved this app for its Fantasy Sports API yet (403). Signing in again won\'t help; request Fantasy API access for the app at developer.yahoo.com.', 403);
      }
      throw error;
    }
  }

  async matchups({ tokens, save }, { week }) {
    const t = await this.fresh(tokens, save);
    const [teamsData, leaguesData] = await Promise.all([
      this.get(t, '/users;use_login=1/games;game_keys=nfl/teams'),
      this.get(t, '/users;use_login=1/games;game_keys=nfl/leagues'),
    ]);
    const games = content => items(flat(items(content.users)[0]?.user).games);
    const myTeams = games(teamsData).flatMap(game => items(flat(game.game).teams).map(t => flat(t.team)));
    const leagueNames = new Map(games(leaguesData).flatMap(game => items(flat(game.game).leagues).map(l => flat(l.league))).map(l => [l.league_key, l.name]));
    return Promise.all(myTeams.map(team => this.teamMatchup(t, team, leagueNames, week)));
  }

  async teamMatchup(tokens, team, leagueNames, week) {
    const leagueKey = team.team_key.split('.t.')[0];
    const base = { platform: 'yahoo', leagueId: leagueKey, leagueName: leagueNames.get(leagueKey) || team.name, week };
    const data = await this.get(tokens, `/team/${team.team_key}/matchups;weeks=${week}`);
    const matchup = items(flat(data.team).matchups)[0]?.matchup;
    const sides = matchup ? items(matchup['0']?.teams).map(t => flat(t.team)) : [];
    const mine = sides.find(s => s.team_key === team.team_key) || team;
    const theirs = sides.find(s => s.team_key !== team.team_key);
    const [myPlayers, theirPlayers] = await Promise.all([this.roster(tokens, team.team_key, week), theirs ? this.roster(tokens, theirs.team_key, week) : []]);
    return { ...base, me: this.side(mine, myPlayers), opponent: theirs ? this.side(theirs, theirPlayers) : null };
  }

  side(team, players) {
    const manager = flat(items(team.managers)[0]?.manager);
    return side({
      teamName: team.name,
      owner: manager.nickname || null,
      points: Number(team.team_points?.total) || 0,
      projected: team.team_projected_points?.total != null ? Number(team.team_projected_points.total) : null,
      players,
    });
  }

  async roster(tokens, teamKey, week) {
    const data = await this.get(tokens, `/team/${teamKey}/roster;week=${week}/players/stats;type=week;week=${week}`);
    const roster = flat(data.team).roster;
    const list = items(roster?.['0']?.players ?? flat(roster).players);
    return list.map(entry => {
      const p = flat(entry.player);
      const slot = flat(p.selected_position).position;
      return player({
        name: p.name?.full || 'Unknown player',
        position: p.display_position?.split(',')[0] || p.primary_position,
        nflTeam: p.editorial_team_abbr,
        points: p.player_points?.total != null ? Number(p.player_points.total) : null,
        starter: !BENCH.has(slot),
        ids: p.display_position === 'DEF' ? {} : { yahoo: String(p.player_id) },
      });
    });
  }
}
