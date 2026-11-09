import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/server.js';
import { Store } from '../src/store.js';
import { setup } from './setup.js';

const TOKEN = 'test-token-0123456789abcdef';
async function serve(t, options = {}) {
  const { aggregator, store, yahoo } = setup();
  const app = createApp({ aggregator, store, yahoo, appToken: TOKEN, ...options });
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.address().port}`;
  const call = (path, { method = 'GET', body, token = TOKEN } = {}) => fetch(base + path, {
    method, redirect: 'manual',
    headers: { ...(token && { authorization: `Bearer ${token}` }), ...(body && { 'content-type': 'application/json' }) },
    body: body && JSON.stringify(body),
  });
  return { call, store, yahoo };
}

test('health is public; everything else needs the app token', async t => {
  const { call } = await serve(t);
  assert.equal((await call('/health', { token: null })).status, 200);
  assert.equal((await call('/v1/scoreboard', { token: null })).status, 401);
  assert.equal((await call('/v1/scoreboard', { token: 'wrong' })).status, 401);
});

test('scoreboard and rooting guide', async t => {
  const { call } = await serve(t);
  const board = await (await call('/v1/scoreboard?week=10')).json();
  assert.equal(board.matchups.length, 3);
  const guide = await (await call('/v1/rooting?week=10&bench=1')).json();
  assert.ok(guide.groups.length >= 2);
  assert.equal((await call('/v1/scoreboard?week=99')).status, 400);
});

test('accounts never return cookies or tokens', async t => {
  const { call } = await serve(t);
  const swid = '{AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA}', espnS2 = 'AEB'.repeat(20);
  let res = await call('/v1/accounts/espn', { method: 'PUT', body: { leagues: [{ leagueId: '123', espnS2, swid }] } });
  assert.equal(res.status, 200);
  const text = await (await call('/v1/accounts')).text();
  assert.ok(!text.includes(espnS2) && !text.includes('refresh'));
  assert.deepEqual(JSON.parse(text).espn, [{ leagueId: '123', teamId: null, hasCookies: true }]);
  assert.deepEqual(JSON.parse(text).yahoo, { connected: true });
});

test('ESPN settings are validated, and saving without cookies keeps the stored ones', async t => {
  const { call, store } = await serve(t);
  const swid = '{AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA}', espnS2 = 'x'.repeat(40);
  await call('/v1/accounts/espn', { method: 'PUT', body: { leagues: [{ leagueId: '123', espnS2, swid }] } });
  await call('/v1/accounts/espn', { method: 'PUT', body: { leagues: [{ leagueId: '123', teamId: 3 }] } });
  assert.deepEqual(store.accounts().espn, [{ leagueId: '123', teamId: 3, espnS2, swid }]);
  for (const bad of [{ leagueId: 'abc' }, { leagueId: '1', swid }, { leagueId: '1', espnS2, swid: 'nope' }, { leagueId: '1', espnS2: 'a;b\r\nX: y'.padEnd(30, 'z'), swid }]) {
    assert.equal((await call('/v1/accounts/espn', { method: 'PUT', body: { leagues: [bad] } })).status, 400, JSON.stringify(bad));
  }
  assert.equal((await call('/v1/accounts/sleeper', { method: 'PUT', body: { username: 'bad name!' } })).status, 400);
  assert.equal((await call('/v1/accounts/sleeper', { method: 'PUT', body: { username: 'jake' } })).status, 200);
});

test('Yahoo sign-in: start, callback with the right state, then back to the app', async t => {
  const { call, store, yahoo } = await serve(t);
  yahoo.exchange = async code => ({ accessToken: `a-${code}`, refreshToken: 'r', expiresAt: 1 });
  const { url } = await (await call('/v1/yahoo/start', { method: 'POST' })).json();
  const state = new URL(url).searchParams.get('state');
  let res = await call(`/v1/yahoo/callback?state=wrong&code=c`, { token: null });
  assert.match(res.headers.get('location'), /^huddle:\/\/yahoo\?error=/);
  res = await call(`/v1/yahoo/callback?state=${state}&code=c`, { token: null });
  assert.equal(res.headers.get('location'), 'huddle://yahoo?connected=1');
  assert.equal(store.accounts().yahoo.tokens.accessToken, 'a-c');
  res = await call(`/v1/yahoo/callback?state=${state}&code=c`, { token: null });
  assert.match(res.headers.get('location'), /error=/, 'a state works only once');
});

test('the store is encrypted at rest and reads back', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'huddle-')), 'state.bin');
  const store = new Store({ path, key: 'k'.repeat(32) });
  store.setESPN([{ leagueId: '9', teamId: 1, espnS2: 'secret-cookie-value', swid: '{X}' }]);
  assert.ok(!readFileSync(path).toString('latin1').includes('secret-cookie-value'));
  assert.equal(new Store({ path, key: 'k'.repeat(32) }).accounts().espn[0].espnS2, 'secret-cookie-value');
  assert.throws(() => new Store({ path, key: 'wrong-key' }));
  assert.throws(() => new Store({ path }), /STATE_KEY/);
});
