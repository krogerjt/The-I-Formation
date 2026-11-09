import { createServer } from 'node:http';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { Aggregator } from './aggregate.js';
import { PlayerIndex } from './players.js';
import { Store } from './store.js';
import { SleeperProvider } from './providers/sleeper.js';
import { ESPNProvider } from './providers/espn.js';
import { YahooProvider } from './providers/yahoo.js';
import { NFLGames } from './providers/nfl.js';

const APP_SCHEME = 'huddle';
const SLEEPER_USERNAME = /^[A-Za-z0-9_.-]{1,40}$/;
const SWID = /^\{[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}\}$/i;
const ESPN_S2 = /^[A-Za-z0-9%+/=_-]{20,1024}$/;
const MAX_ESPN_LEAGUES = 20;

async function body(req) {
  let result = '';
  for await (const chunk of req) { result += chunk; if (Buffer.byteLength(result) > 32768) throw new HTTPError(413, 'Request too large.'); }
  try { return JSON.parse(result || '{}'); } catch { throw new HTTPError(400, 'Send JSON.'); }
}
class HTTPError extends Error { constructor(status, message) { super(message); this.status = status; } }

const digest = value => createHash('sha256').update(String(value)).digest();
function authorized(req, appToken) {
  const match = /^Bearer (.+)$/.exec(req.headers.authorization || '');
  return Boolean(match && appToken) && timingSafeEqual(digest(match[1]), digest(appToken));
}

function weekParams(url) {
  const week = url.searchParams.get('week'), season = url.searchParams.get('season');
  const out = {};
  if (week != null) { out.week = Number(week); if (!Number.isInteger(out.week) || out.week < 1 || out.week > 22) throw new HTTPError(400, 'Week must be 1 to 22.'); }
  if (season != null) { out.season = Number(season); if (!Number.isInteger(out.season) || out.season < 2018 || out.season > 2100) throw new HTTPError(400, 'Season must be a year.'); }
  return out;
}

export function validESPNLeagues(leagues) {
  if (!Array.isArray(leagues) || leagues.length > MAX_ESPN_LEAGUES) throw new HTTPError(400, `Send up to ${MAX_ESPN_LEAGUES} ESPN leagues.`);
  return leagues.map(l => {
    const leagueId = String(l?.leagueId ?? '').trim();
    if (!/^\d{1,12}$/.test(leagueId)) throw new HTTPError(400, 'An ESPN league ID is the number after leagueId= in the league URL.');
    const teamId = l.teamId == null || l.teamId === '' ? null : Number(l.teamId);
    if (teamId != null && (!Number.isInteger(teamId) || teamId < 1 || teamId > 64)) throw new HTTPError(400, 'An ESPN team ID is the number after teamId= in your team URL.');
    const out = { leagueId, teamId };
    if (l.espnS2 !== undefined || l.swid !== undefined) {
      const espnS2 = l.espnS2 ? String(l.espnS2).trim() : null, swid = l.swid ? String(l.swid).trim() : null;
      if (Boolean(espnS2) !== Boolean(swid)) throw new HTTPError(400, 'Private ESPN leagues need both espn_s2 and SWID.');
      if (espnS2 && !ESPN_S2.test(espnS2)) throw new HTTPError(400, 'That espn_s2 value doesn\'t look right. Copy the whole cookie value.');
      if (swid && !SWID.test(swid)) throw new HTTPError(400, 'SWID looks like {XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX}, braces included.');
      Object.assign(out, { espnS2, swid: swid?.toUpperCase() ?? null });
    }
    return out;
  });
}

export function createApp({ aggregator, store, yahoo, appToken = process.env.APP_TOKEN, now = Date.now }) {
  const pendingYahoo = new Map(); // OAuth state -> expiry
  return createServer(async (req, res) => {
    const send = (status, value) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(value)); };
    const redirect = location => { res.writeHead(302, { location, 'cache-control': 'no-store' }); res.end(); };
    try {
      const url = new URL(req.url, 'http://localhost');
      const route = `${req.method} ${url.pathname}`;
      if (route === 'GET /health') return send(200, { ok: true });

      // Yahoo sends the browser here after sign-in; the one-time state proves the app started it.
      if (route === 'GET /v1/yahoo/callback') {
        const state = url.searchParams.get('state') || '', code = url.searchParams.get('code');
        const expires = pendingYahoo.get(state);
        pendingYahoo.delete(state);
        if (!expires || expires < now()) return redirect(`${APP_SCHEME}://yahoo?error=${encodeURIComponent('Sign-in expired. Try again.')}`);
        if (!code) return redirect(`${APP_SCHEME}://yahoo?error=${encodeURIComponent(url.searchParams.get('error') || 'Yahoo sign-in was cancelled.')}`);
        try { store.saveYahooTokens(await yahoo.exchange(code)); return redirect(`${APP_SCHEME}://yahoo?connected=1`); }
        catch (error) { return redirect(`${APP_SCHEME}://yahoo?error=${encodeURIComponent(error.message)}`); }
      }

      if (!url.pathname.startsWith('/v1/')) return send(404, { error: 'Not found.' });
      if (!authorized(req, appToken)) return send(401, { error: 'Missing or wrong app token.' });

      if (route === 'GET /v1/scoreboard') return send(200, await aggregator.scoreboard(weekParams(url)));
      if (route === 'GET /v1/rooting') return send(200, await aggregator.rooting({ ...weekParams(url), includeBench: url.searchParams.get('bench') === '1' }));
      if (route === 'GET /v1/accounts') return send(200, { ...store.publicAccounts(), yahooAvailable: yahoo.configured });
      if (route === 'PUT /v1/accounts/sleeper') {
        const { username } = await body(req);
        const name = username ? String(username).trim() : '';
        if (name && !SLEEPER_USERNAME.test(name)) throw new HTTPError(400, 'That isn\'t a Sleeper username.');
        store.setSleeper(name || null);
        return send(200, store.publicAccounts());
      }
      if (route === 'PUT /v1/accounts/espn') {
        const { leagues } = await body(req);
        store.setESPN(validESPNLeagues(leagues));
        return send(200, store.publicAccounts());
      }
      if (route === 'POST /v1/yahoo/start') {
        if (!yahoo.configured) throw new HTTPError(503, 'Yahoo isn\'t set up on the server. Set YAHOO_CLIENT_ID, YAHOO_CLIENT_SECRET and YAHOO_REDIRECT_URI.');
        for (const [s, exp] of pendingYahoo) if (exp < now()) pendingYahoo.delete(s);
        const state = randomBytes(24).toString('hex');
        pendingYahoo.set(state, now() + 10 * 60 * 1000);
        return send(200, { url: yahoo.authorizeURL(state), callbackScheme: APP_SCHEME });
      }
      if (route === 'DELETE /v1/yahoo') { store.saveYahooTokens(null); return send(200, store.publicAccounts()); }
      return send(404, { error: 'Not found.' });
    } catch (error) {
      if (error instanceof HTTPError) return send(error.status, { error: error.message });
      console.error(error);
      return send(500, { error: 'Something went wrong on the server.' });
    }
  });
}

export function createDefaultApp(env = process.env) {
  if (!env.APP_TOKEN || env.APP_TOKEN.length < 24) throw new Error('Set APP_TOKEN to a random string of at least 24 characters (for example `openssl rand -hex 32`).');
  const players = new PlayerIndex();
  const store = new Store({ path: env.DATA_PATH || 'data/state.bin', key: env.STATE_KEY });
  const yahoo = new YahooProvider({ clientId: env.YAHOO_CLIENT_ID, clientSecret: env.YAHOO_CLIENT_SECRET, redirectUri: env.YAHOO_REDIRECT_URI });
  const aggregator = new Aggregator({ sleeper: new SleeperProvider({ players }), espn: new ESPNProvider(), yahoo, nfl: new NFLGames(), players, store });
  return createApp({ aggregator, store, yahoo, appToken: env.APP_TOKEN });
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const port = Number(process.env.PORT) || 8787, host = process.env.HOST || '127.0.0.1';
  createDefaultApp().listen(port, host, () => console.log(`Huddle server on http://${host}:${port}`));
}
