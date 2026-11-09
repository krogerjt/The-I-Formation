import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeFetch } from './fake-fetch.js';
import { allRoutes, players, yahooTokens } from './fixtures.js';
import { PlayerIndex } from '../src/players.js';
import { SleeperProvider } from '../src/providers/sleeper.js';
import { ESPNProvider } from '../src/providers/espn.js';
import { YahooProvider, YAHOO_TOKEN } from '../src/providers/yahoo.js';
import { NFLGames } from '../src/providers/nfl.js';
import { nflTeam, normalizeName } from '../src/model.js';

const now = () => Date.parse('2026-11-08T20:00:00Z');
async function index() { const p = new PlayerIndex({ fetch: fakeFetch(allRoutes), now }); await p.refresh(); return p; }

test('normalizes team abbreviations and names across platforms', () => {
  assert.equal(nflTeam('Wsh'), 'WAS');
  assert.equal(nflTeam('JAC'), 'JAX');
  assert.equal(nflTeam('FA'), null);
  assert.equal(normalizeName('Odell Beckham Jr.'), normalizeName('odell beckham'));
  assert.equal(normalizeName('Amon-Ra St. Brown'), 'amonrastbrown');
});

test('player index matches the same player by Sleeper, ESPN and Yahoo ids, and by name', async () => {
  const p = await index();
  const key = 'sleeper:4046';
  assert.equal(p.keyFor({ ids: { sleeper: '4046' } }), key);
  assert.equal(p.keyFor({ ids: { espn: '3139477' } }), key);
  assert.equal(p.keyFor({ ids: { yahoo: '30123' } }), key);
  assert.equal(p.keyFor({ ids: {}, name: 'Patrick Mahomes II', position: 'QB', nflTeam: 'KC' }), key);
  assert.equal(p.keyFor({ ids: {}, name: 'Kansas City Chiefs', position: 'DEF', nflTeam: 'KC' }), 'DEF:KC');
  assert.match(p.keyFor({ ids: {}, name: 'Rookie Guy', position: 'WR', nflTeam: 'NYJ' }), /^name:/);
});

test('player index fetches the Sleeper dump at most once a day', async () => {
  let t = now();
  const fetch = fakeFetch(allRoutes);
  const p = new PlayerIndex({ fetch, now: () => t });
  await p.refresh(); await p.refresh();
  t += 23 * 3600 * 1000; await p.refresh();
  assert.equal(fetch.calls.length, 1);
  t += 2 * 3600 * 1000; await p.refresh();
  assert.equal(fetch.calls.length, 2);
  assert.equal(Object.keys(players).length, p.bySleeper.size);
});

test('Sleeper: finds my roster, my opponent, starters and bench', async () => {
  const sleeper = new SleeperProvider({ fetch: fakeFetch(allRoutes), players: await index() });
  assert.deepEqual(await sleeper.state(), { season: 2026, week: 10, seasonType: 'regular' });
  const [m] = await sleeper.matchups({ username: 'jake' }, { season: 2026, week: 10 });
  assert.equal(m.leagueName, 'Dynasty Bros');
  assert.equal(m.me.teamName, 'Kroger Kings');
  assert.equal(m.me.points, 41.5);
  assert.equal(m.opponent.teamName, 'sam');
  assert.deepEqual(m.me.players.map(p => [p.name, p.starter, p.points]), [['Patrick Mahomes', true, 24.3], ['CeeDee Lamb', true, 17.2], ['Bijan Robinson', false, 9]]);
});

test('Sleeper: an unknown username is a clear error', async () => {
  const sleeper = new SleeperProvider({ fetch: fakeFetch({}), players: await index() });
  await assert.rejects(sleeper.matchups({ username: 'nobody' }, { season: 2026, week: 10 }), /returned 404/);
});

test('ESPN: picks this week, maps pro teams and lineup slots, and finds my team by SWID', async () => {
  const fetch = fakeFetch(allRoutes);
  const espn = new ESPNProvider({ fetch });
  const [m] = await espn.matchups([{ leagueId: '123', espnS2: 'abc', swid: '{aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa}' }], { season: 2026, week: 10 });
  assert.match(fetch.calls[0].options.headers.cookie, /espn_s2=abc; SWID=\{aaaa/);
  assert.match(fetch.calls[0].url, /scoringPeriodId=10/);
  assert.equal(m.leagueName, 'Work League');
  assert.equal(m.me.teamName, 'Allen Wrench');
  assert.equal(m.me.owner, 'jkroger');
  assert.equal(m.me.points, 30.1);
  assert.equal(m.me.projected, 98.7);
  assert.equal(m.opponent.teamName, 'Team Boss');
  assert.deepEqual(m.me.players.map(p => [p.name, p.nflTeam, p.starter]), [['Josh Allen', 'BUF', true], ['Bijan Robinson', 'ATL', false]]);
  assert.deepEqual(m.opponent.players.at(-1), { name: 'Chiefs D/ST', position: 'DEF', nflTeam: 'KC', points: 6, starter: true, ids: {} });
});

test('ESPN: a public league with a team ID needs no cookies', async () => {
  const fetch = fakeFetch(allRoutes);
  const [m] = await new ESPNProvider({ fetch }).matchups([{ leagueId: '123', teamId: 2 }], { season: 2026, week: 10 });
  assert.equal(fetch.calls[0].options.headers.cookie, undefined);
  assert.equal(m.me.teamName, 'Team Boss');
});

test('ESPN: a private league without cookies explains what to add', async () => {
  const espn = new ESPNProvider({ fetch: fakeFetch({ 'https://lm-api-reads': new Response('', { status: 401 }) }) });
  await assert.rejects(espn.matchups([{ leagueId: '123', teamId: 1 }], { season: 2026, week: 10 }), /private.*espn_s2 and SWID/);
});

test('Yahoo: reads teams, league names, matchup and rosters from Yahoo\'s nested JSON', async () => {
  const fetch = fakeFetch(allRoutes);
  const yahoo = new YahooProvider({ fetch, clientId: 'id', clientSecret: 'secret', redirectUri: 'https://h/cb', now });
  const [m] = await yahoo.matchups({ tokens: yahooTokens, save: () => assert.fail('no refresh needed') }, { week: 10 });
  assert.equal(fetch.calls[0].options.headers.authorization, 'Bearer access');
  assert.equal(m.leagueName, 'Family League');
  assert.equal(m.leagueId, '461.l.777');
  assert.equal(m.me.points, 24.3);
  assert.equal(m.me.projected, 110.5);
  assert.equal(m.opponent.teamName, 'Cousin Ed');
  assert.deepEqual(m.me.players.map(p => [p.name, p.nflTeam, p.starter, p.ids.yahoo]), [['Patrick Mahomes', 'KC', true, '30123'], ['Josh Allen', 'BUF', false, '30977']]);
  assert.deepEqual(m.opponent.players.map(p => p.name), ['Bijan Robinson']);
});

test('Yahoo: refreshes an expiring token and saves it', async () => {
  let saved;
  const fetch = fakeFetch({ ...allRoutes, [YAHOO_TOKEN]: (url, options) => {
    assert.equal(options.headers.authorization, `Basic ${Buffer.from('id:secret').toString('base64')}`);
    assert.match(options.body, /grant_type=refresh_token&refresh_token=refresh|refresh_token=refresh.*grant_type=refresh_token/);
    return { access_token: 'new', expires_in: 3600 };
  } });
  const yahoo = new YahooProvider({ fetch, clientId: 'id', clientSecret: 'secret', redirectUri: 'https://h/cb', now });
  const tokens = await yahoo.fresh({ ...yahooTokens, expiresAt: now() + 30000 }, t => { saved = t; });
  assert.deepEqual(tokens, { accessToken: 'new', refreshToken: 'refresh', expiresAt: now() + 3600000 });
  assert.deepEqual(saved, tokens);
});

test('Yahoo: builds the sign-in URL', () => {
  const yahoo = new YahooProvider({ clientId: 'id', clientSecret: 's', redirectUri: 'https://h/v1/yahoo/callback' });
  const url = new URL(yahoo.authorizeURL('xyz'));
  assert.equal(url.searchParams.get('redirect_uri'), 'https://h/v1/yahoo/callback');
  assert.equal(url.searchParams.get('state'), 'xyz');
  assert.equal(url.searchParams.get('response_type'), 'code');
});

test('NFL scoreboard: maps each team to its game and state', async () => {
  const games = await new NFLGames({ fetch: fakeFetch(allRoutes) }).week({ season: 2026, week: 10 });
  assert.equal(games.get('KC'), games.get('BUF'));
  assert.equal(games.get('KC').name, 'KC at BUF');
  assert.equal(games.get('KC').state, 'live');
  assert.equal(games.get('ATL').state, 'scheduled');
});
